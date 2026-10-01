import json
import urllib.parse

import numpy as np
import pandas as pd
import pytest

from topnews import wiki

# Small invented responses, shaped like Wikipedia's and Wikimedia's.
SEARCH = {"query": {"pages": [{"pageid": 1, "ns": 0, "title": "Houston Astros"}]}}
DISAMBIGUATION = {"query": {"pages": [{"pageid": 2, "ns": 0, "title": "Mercury", "pageprops": {"disambiguation": ""}}]}}
VIEWS = {
    "items": [
        {"article": "Houston_Astros", "timestamp": "2026092800", "views": 100},
        {"article": "Houston_Astros", "timestamp": "2026093000", "views": 900},
    ]
}


def fake(responses):
    calls = []

    def get(url):
        calls.append(url)
        for fragment, response in responses.items():
            if fragment in url:
                return response
        return {}

    get.calls = calls
    return get


def test_find_article_follows_search_grades_the_link_and_flags_disambiguation():
    get = fake({"gsrsearch=astro": SEARCH, "gsrsearch=mercury": DISAMBIGUATION})
    assert wiki.find_article("astros", get) == {"title": "Houston Astros", "disambiguation": False, "quality": "exact"}
    assert wiki.find_article("mercury", get)["disambiguation"]
    assert wiki.find_article("nothing", get) is None
    params = urllib.parse.parse_qs(urllib.parse.urlsplit(get.calls[0]).query)
    assert params["redirects"] == ["1"] and params["gsrnamespace"] == ["0"]


def test_searches_drop_filler_and_split_hashtags_but_keep_plurals():
    assert wiki.clean_query("strait of hormuz news") == "strait hormuz"
    assert wiki.clean_query("#NationalCoffeeDay") == "national coffee day"
    assert wiki.clean_query("flyers") == "flyers"  # "flyer" would find a disambiguation page


@pytest.mark.parametrize(
    "query, title, quality",
    [
        ("astros", "Houston Astros", "exact"),
        ("strait of hormuz news", "Strait of Hormuz", "exact"),
        ("Flydubai flight diverts to Saudi Arabia", "Flydubai", "partial"),  # one word of five
        ("eritrea vs south africa", "Eritrea", "partial"),  # a match, not the country
        ("jack smith", "Jack Smith (lawyer)", "exact"),
        ("trump accounts", "Trump account", "exact"),
        ("d'angelo russell", "D'Angelo Russell", "exact"),
        ("phillies - braves", "Philadelphia Phillies", "partial"),
        ("Reported Pentagon data breach", "Ashley Madison data breach", "partial"),
        ("Schmitt confuses Hawks with Hawkeyes", "Gulf War", "none"),
    ],
)
def test_link_quality(query, title, quality):
    assert wiki.link_quality(query, title) == quality


def test_article_titles_are_escaped_for_the_pageviews_api():
    assert wiki.article_url_title("Houston Astros") == "Houston_Astros"
    assert wiki.article_url_title("AC/DC") == "AC%2FDC"


def test_daily_views_fill_missing_days_with_zero_and_start_no_earlier_than_2015():
    get = fake({"Houston_Astros/daily/20260928": VIEWS})
    now = pd.Timestamp("2026-10-05T12:00", tz="UTC")
    views = wiki.daily_views("Houston Astros", pd.Timestamp("2026-09-28"), pd.Timestamp("2026-09-30"), get, now=now)
    assert views.tolist() == [100.0, 0.0, 900.0]
    get_old = fake({})
    wiki.daily_views("X", pd.Timestamp("2010-01-01"), pd.Timestamp("2015-07-03"), get_old, now=now)
    assert "/daily/2015070100/" in get_old.calls[0]


def test_days_not_published_yet_are_unknown_not_zero():
    early = {"items": [{"article": "Iraq", "timestamp": d, "views": 3500} for d in ("2026092800", "2026092900")]}
    get = fake({"Iraq/daily": early})
    views = wiki.daily_views("Iraq", pd.Timestamp("2026-09-28"), pd.Timestamp("2026-09-30"), get,
                             now=pd.Timestamp("2026-10-01T02:00", tz="UTC"))
    assert views.iloc[:2].tolist() == [3500.0, 3500.0]
    assert np.isnan(views.iloc[2])  # Sep 30 isn't out yet at 02:00 on Oct 1
    assert np.isnan(wiki.spike(views, pd.Timestamp("2026-09-30"))["ratio"])


def test_days_before_an_article_existed_are_unknown_and_seasons_ignore_them():
    created = {"items": [{"article": "Fat_Bear_Week", "timestamp": f"2025{m:02d}0100", "views": 50 if m == 10 else 10}
                         for m in range(6, 13)]}
    get = fake({"Fat_Bear_Week/daily": created})
    views = wiki.daily_views("Fat Bear Week", pd.Timestamp("2025-01-01"), pd.Timestamp("2025-12-31"), get,
                             now=pd.Timestamp("2026-10-01", tz="UTC"))
    assert views[: "2025-05-31"].isna().all()  # no article before June
    assert views["2025-06-02"] == 0.0  # existed, nobody read it that day
    profile = wiki.monthly_profile(views).set_index("month")
    assert 1 not in profile.index  # January has no known days


def test_spike_compares_a_day_with_its_baseline():
    days = pd.date_range("2026-09-01", "2026-09-30", freq="D")
    views = pd.Series(100.0, index=days)
    views[pd.Timestamp("2026-09-30")] = 1500.0
    result = wiki.spike(views, pd.Timestamp("2026-09-30"))
    assert result == {"views": 1500.0, "baseline": 100.0, "ratio": 15.0}


def test_monthly_profile_finds_the_month_an_article_comes_back_in():
    days = pd.date_range("2024-01-01", "2025-12-31", freq="D")
    views = pd.Series(10.0, index=days)
    views[views.index.month == 9] = 50.0  # autumn's article every September
    profile = wiki.monthly_profile(views).set_index("month")
    assert profile.loc[9, "vs_overall"] == pytest.approx(5.0)
    assert profile.loc[3, "vs_overall"] == pytest.approx(1.0)


def test_cached_fetches_each_url_once(tmp_path):
    get = fake({"a": {"x": 1}})
    fetch = wiki.cached(get, cache_dir=tmp_path, pause=0)
    assert fetch("https://example.org/a") == {"x": 1}
    assert fetch("https://example.org/a") == {"x": 1}
    assert len(get.calls) == 1
    assert len(list(tmp_path.glob("*.json"))) == 1
    assert json.loads(next(tmp_path.glob("*.json")).read_text()) == {"x": 1}
