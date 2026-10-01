"""Wikipedia pageviews (task 5.8, first source): how big a topic got, and when it comes back.

Read-only research code, no key: Wikipedia's search links a topic to an
English article, and the Wikimedia pageviews API gives that article's daily
views by people (bots and crawlers left out) since July 2015. Used for:

- how big a topic got: views on a day against the 28 days before (`spike`);
- seasons and calendar moments: which months an article peaks in, across
  years (`monthly_profile`), for RQ5's seasons and the weeks horizon.

Wikimedia asks every client for a descriptive User-Agent with a way to reach
its owner, and for serial requests; this sends the repository's URL (no
personal details), one request at a time. Responses are cached under the
gitignored research/data/wiki/, so a re-run fetches nothing twice.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pandas as pd

from . import rhythms
from .db import REPO_ROOT

USER_AGENT = "top10-trends-research/0.1 (https://github.com/phongtran72/top10-trends; research notebooks)"
SEARCH_API = "https://en.wikipedia.org/w/api.php"
PAGEVIEWS_API = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user"
CACHE_DIR = REPO_ROOT / "research" / "data" / "wiki"
FIRST_DAY = pd.Timestamp("2015-07-01")  # the pageviews API's history starts here
TIMEOUT_SECONDS = 10
PAUSE_SECONDS = 0.2

GetJson = Callable[[str], dict]


def get_json(url: str) -> dict:
    """GET a JSON document with Wikimedia's User-Agent, a 10-second timeout and one retry. A 404 (no views
    recorded for that article and range) comes back as an empty dict."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    for attempt in (1, 2):
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return {}
            if attempt == 2 or error.code < 500:
                raise
        except urllib.error.URLError:
            if attempt == 2:
                raise
        time.sleep(1)
    return {}


def cached(get: GetJson = get_json, cache_dir: Path = CACHE_DIR, pause: float = PAUSE_SECONDS) -> GetJson:
    """`get`, with each URL's answer kept on disk and a short pause before every real request."""
    def fetch(url: str) -> dict:
        path = cache_dir / f"{hashlib.sha256(url.encode()).hexdigest()[:24]}.json"
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        time.sleep(pause)
        data = get(url)
        cache_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")
        return data

    return fetch


# Words that say when or how a trend was searched, not what it's about ("strait of hormuz news",
# "phillies game today"), and small words; left out of searches and of link checks.
FILLER = frozenset(
    "news today tonight live update updates latest the a an of and or on in at to for with vs v by from".split()
)


def _words(text: str, singular: bool = True) -> list[str]:
    """Lowercase words without punctuation or filler. With `singular`, a trailing plural "s" is dropped, so
    "accounts" and "account" agree when comparing (but not when searching: "flyers" isn't "flyer")."""
    text = re.sub(r"\([^)]*\)", " ", text.lower())  # "Jack Smith (lawyer)": the disambiguator isn't the topic
    text = text.replace("'", "").replace("’", "")
    words = [w for w in re.split(r"[^\w]+", text) if w and w not in FILLER]
    return [w[:-1] if singular and len(w) > 3 and w.endswith("s") else w for w in words]


def clean_query(text: str) -> str:
    """A trend's title as a search: hashtags split like the pipeline's titles, filler dropped."""
    return " ".join(_words(rhythms.title_key(text), singular=False))


def link_quality(query: str, title: str) -> str:
    """How well an article's title matches the trend it was found for:
    - "exact": the trend's words are all in the title ("astros" → "Houston Astros"), or the title's words
      are in the trend and cover at least half of it ("strait of hormuz news" → "Strait of Hormuz"): right
      for nearly every name and place;
    - "partial": some words shared ("phillies - braves" → "Philadelphia Phillies", "eritrea vs south
      africa" → "Eritrea", but also "Reported Pentagon data breach" → "Ashley Madison data breach"), so
      check by eye;
    - "none": nothing shared; search guessed from the text around it."""
    q, t = set(_words(rhythms.title_key(query))), set(_words(title))
    if not q or not t or not q & t:
        return "none"
    return "exact" if q <= t or (t <= q and len(t) * 2 >= len(q)) else "partial"


def find_article(query: str, get: GetJson) -> dict | None:
    """The English Wikipedia article Wikipedia's search ranks first for `query` (cleaned of filler),
    following redirects: {"title", "disambiguation", "quality"}, or None when nothing matches."""
    search = clean_query(query) or query
    params = {
        "action": "query", "format": "json", "formatversion": "2", "redirects": "1",
        "generator": "search", "gsrsearch": search, "gsrlimit": "1", "gsrnamespace": "0",
        "prop": "pageprops", "ppprop": "disambiguation",
    }
    pages = get(f"{SEARCH_API}?{urllib.parse.urlencode(params)}").get("query", {}).get("pages", [])
    if not pages:
        return None
    page = pages[0]
    return {
        "title": page["title"],
        "disambiguation": "disambiguation" in page.get("pageprops", {}),
        "quality": link_quality(query, page["title"]),
    }


def article_url_title(title: str) -> str:
    """An article title as the pageviews API wants it: spaces as underscores, everything else escaped
    (a slash in "AC/DC" too)."""
    return urllib.parse.quote(title.replace(" ", "_"), safe="")


def daily_views(
    title: str, start: pd.Timestamp, end: pd.Timestamp, get: GetJson, now: pd.Timestamp | None = None
) -> pd.Series:
    """Daily views of an article by people, from `start` to `end` (dates, UTC), indexed by day. Days with
    no views recorded are 0, except two kinds that are NaN, unknown: days before the article's first
    figures (it didn't exist yet: Fat Bear Week's starts in October 2022), and days Wikimedia hasn't
    published yet (from yesterday on, with no figures in the answer). Nothing before July 2015 exists."""
    start = max(pd.Timestamp(start).normalize(), FIRST_DAY)
    end = pd.Timestamp(end).normalize()
    url = f"{PAGEVIEWS_API}/{article_url_title(title)}/daily/{start:%Y%m%d}00/{end:%Y%m%d}00"
    items = get(url).get("items", [])
    days = pd.date_range(start, end, freq="D")
    views = pd.Series({pd.Timestamp(i["timestamp"][:8]): i["views"] for i in items}, dtype=float)
    views = views.reindex(days, fill_value=0.0)
    now = pd.Timestamp.now(tz="UTC") if now is None else pd.Timestamp(now)
    today = (now.tz_convert("UTC").tz_localize(None) if now.tzinfo else now).normalize()
    last_published = views.index[views > 0].max() if (views > 0).any() else start - pd.to_timedelta(1, unit="D")
    unpublished = (views.index > last_published) & (views.index >= today - pd.to_timedelta(1, unit="D"))
    before_article = views.index < views.index[views > 0].min() if (views > 0).any() else np.ones(len(views), bool)
    return views.mask(unpublished | before_article)


def spike(views: pd.Series, day: pd.Timestamp, baseline_days: int = 28) -> dict:
    """Views on `day` against the median of the `baseline_days` before it: how big the topic got that day,
    relative to its normal."""
    day = pd.Timestamp(day).normalize()
    before = views[(views.index < day) & (views.index >= day - pd.to_timedelta(baseline_days, unit="D"))]
    on_day = float(views.get(day, float("nan")))
    baseline = float(before.median()) if len(before) else float("nan")
    return {"views": on_day, "baseline": baseline, "ratio": on_day / baseline if baseline > 0 else float("nan")}


def monthly_profile(views: pd.Series) -> pd.DataFrame:
    """Per calendar month, the article's median daily views across years, against its overall median:
    which months it comes back in. Unknown days are left out. Needs at least a full year of history."""
    views = views.dropna()
    by_month = views.groupby(views.index.month).median()
    overall = float(views.median())
    return pd.DataFrame(
        {"month": by_month.index, "median_views": by_month.values, "vs_overall": by_month.values / overall if overall > 0 else float("nan")}
    )
