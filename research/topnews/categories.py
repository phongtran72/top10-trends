"""Topic categories: one per trend, drafted by the local model (topnews.llm) and checked by a person.

RQ1 asks for lifecycles by category and RQ4 for news by kind; rules alone
(RQ4's) find only calendar moments. Each trend gets a category from
llm.CATEGORIES and whether a news event drives it. The model sees where the
trend was listed and, for Google Trends and Hacker News, the site and the
words of the article it linked to, because a bare name ("jorge kahwagi") is
a guess without them.

Labels are kept per trend (source and key, as in rhythms) in the gitignored
research/data/categories.csv, so a later run only asks about new trends. A
person's corrections go in `reviewed_category` and `reviewed_news`, and win.
`checked` says whether a draft has been checked at all: a checked label with
no correction is one the check agreed with, and only checked labels may score
a model (topnews.category_model).
"""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import unquote, urlsplit

import pandas as pd

from . import echo, llm, rhythms
from .db import REPO_ROOT

STORE = REPO_ROOT / "research" / "data" / "categories.csv"
PLATFORM = {
    "google_trends": "Google search trend (US)",
    "x": "X trend",
    "bluesky": "Bluesky trending topic",
    "mastodon": "Mastodon hashtag",
    "hacker_news": "Hacker News story",
    "reddit": "Reddit post from r/popular",
    "twitch": "Twitch streaming category",
    "tiktok": "TikTok hashtag (US)",
    "instagram": "Instagram trending topic",
    "pinterest": "Pinterest trending search (US)",
}
LINKED = frozenset({"google_trends", "hacker_news"})  # their url is the article itself
COLUMNS = ["source_id", "key", "title", "context", "llm_category", "llm_news", "reviewed_category", "reviewed_news", "checked"]


def link_words(url: str, limit: int = 12) -> str:
    """An article link as "site: words from its path", ids and file endings dropped:
    "https://www.mlb.com/news/phillies-vs-braves-game-2" → "mlb.com: news phillies vs braves game"."""
    parts = urlsplit(url)
    host = parts.netloc.lower().removeprefix("www.")
    path = re.sub(r"\.(html?|php|aspx?)$", "", unquote(parts.path))
    words = [w for w in re.split(r"[^A-Za-z]+", path) if len(w) > 1][:limit]
    return f"{host}: {' '.join(words)}".strip().rstrip(":")


def context(source_id: str, url: str | None, match_text=None) -> str:
    """Where a trend was listed, plus what says what it's about: its stored match text (Google's headlines,
    Bluesky's description) when the lists kept one, else its article's site and words for Google Trends and
    Hacker News."""
    parts = [PLATFORM.get(source_id, source_id)]
    texts = [str(t).strip() for t in match_text if str(t).strip()] if echo.has_text(match_text) else []
    if texts:
        parts.append(" / ".join(texts[:2])[:300])
    elif source_id in LINKED and isinstance(url, str) and url.startswith("http"):
        parts.append(link_words(url))
    return "; ".join(parts)


def trend_table(items: pd.DataFrame) -> pd.DataFrame:
    """RQ6's trends (one per platform and item) with their latest url and the context the model sees."""
    trends = echo.trends(items)
    latest = rhythms.keyed(items).sort_values("fetched_at").drop_duplicates(["source_id", "key"], keep="last")
    trends = trends.merge(latest[["source_id", "key", "url"]], on=["source_id", "key"], how="left")
    return trends.assign(context=[context(s, u, m) for s, u, m in zip(trends["source_id"], trends["url"], trends["match_text"])])


def _read(store: Path) -> pd.DataFrame:
    if store.exists():
        known = pd.read_csv(store, dtype={"reviewed_category": "object", "reviewed_news": "object"})
        if "checked" not in known:
            known["checked"] = False
        return known.assign(checked=known["checked"].fillna(False).astype(bool))
    return pd.DataFrame(columns=COLUMNS)


def read(store: Path = STORE) -> pd.DataFrame:
    """The label store as it is: one row per labeled trend."""
    return _read(store)


def mark_checked(
    rows, corrections: dict[int, str] | None = None, news: dict[int, bool] | None = None, store: Path = STORE
) -> pd.DataFrame:
    """Records a check of the store's `rows` (their positions): each becomes checked, `corrections` gives
    the category for those the check disagreed with, and `news` any corrected news flags. A calendar
    correction also sets news to False."""
    table = _read(store)
    corrections, news = corrections or {}, news or {}
    rows = list(rows)
    outside = (set(corrections) | set(news)) - set(rows)
    if outside:
        raise ValueError(f"corrections outside the checked rows: {sorted(outside)}")
    unknown = set(corrections.values()) - set(llm.CATEGORIES)
    if unknown:
        raise ValueError(f"not a category: {sorted(unknown)}")
    table.loc[rows, "checked"] = True
    for row, category in corrections.items():
        table.loc[row, "reviewed_category"] = category
        if category == "calendar":
            table.loc[row, "reviewed_news"] = "False"
    for row, flag in news.items():
        table.loc[row, "reviewed_news"] = str(flag)
    table.to_csv(store, index=False)
    return table


def label(trends: pd.DataFrame, store: Path = STORE, post: llm.Post = llm.post_json, cache_dir: Path | None = llm.CACHE_DIR) -> pd.DataFrame:
    """Every trend with its labels: those already in `store` are kept, new ones are drafted by the model and
    added. Returns the trends with llm_* and reviewed_* columns."""
    known = _read(store)
    have = set(zip(known["source_id"], known["key"]))
    todo = trends[[(s, k) not in have for s, k in zip(trends["source_id"], trends["key"])]].reset_index(drop=True)
    if len(todo):
        answers = llm.categorize(
            [{"id": i, "title": t, "context": c} for i, t, c in zip(todo.index, todo["title"], todo["context"])], post, cache_dir
        )
        new = todo[["source_id", "key", "title", "context"]].assign(
            llm_category=[a["category"] for a in answers], llm_news=[a["news"] for a in answers],
            reviewed_category=pd.NA, reviewed_news=pd.NA, checked=False,
        )
        known = pd.concat([known, new], ignore_index=True)
        store.parent.mkdir(parents=True, exist_ok=True)
        known.to_csv(store, index=False)
    labels = known.drop(columns=["title", "context"])
    return trends.merge(labels, on=["source_id", "key"], how="left")


def final(table: pd.DataFrame) -> pd.DataFrame:
    """`category` and `news`: a person's correction where there is one, else the model's draft."""
    category = table["reviewed_category"].where(table["reviewed_category"].notna(), table["llm_category"])
    news = table["reviewed_news"].where(table["reviewed_news"].notna(), table["llm_news"])
    return table.assign(category=category, news=news.map(lambda v: str(v).lower() == "true" if pd.notna(v) else pd.NA))
