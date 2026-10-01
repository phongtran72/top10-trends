import numpy as np
import pandas as pd
import pytest

from topnews import echo, news

T0 = pd.Timestamp("2026-10-01T12:07", tz="UTC")


@pytest.mark.parametrize(
    "title",
    ["#WIPWednesday", "#SeaWednesday", "#internationalpodcastday", "national coffee day", "#nationalcoffeeday",
     "World Mental Health Day", "#firstdayoffall", "happy first day of fall"],
)
def test_calendar_moments(title):
    assert news.is_calendar(title)


@pytest.mark.parametrize(
    "title", ["Astros", "Deadlock releases major update", "#jacksmith", "Fat Bear Week 2026", "today", "World Series today"]
)
def test_not_calendar_moments(title):
    assert not news.is_calendar(title)


def unit(*values):
    v = np.zeros(echo.DIMENSIONS, dtype=np.float32)
    v[: len(values)] = values
    return v / np.linalg.norm(v)


def matched():
    rows = [
        ("google_trends", "astros"),
        ("x", "Astros"),
        ("mastodon", "#WIPWednesday"),
        ("bluesky", "Fat Bear Week 2026"),
    ]
    table = pd.DataFrame(
        [
            {"trend_id": f"t{i}", "source_id": s, "key": t.lower(), "title": t, "first_seen": T0, "last_seen": T0,
             "best_rank": 1, "fetches": 1}
            for i, (s, t) in enumerate(rows)
        ]
    )
    return echo.cross_platform(table, np.stack([unit(1), unit(1), unit(0, 1), unit(0, 0, 1)]))


def test_categorize_puts_google_first_then_calendar_then_news_links():
    c = news.categorize(matched()).set_index("source_id")["category"]
    assert c["google_trends"] == "google"
    assert c["x"] == "news-linked"  # matches Google's "astros"
    assert c["mastodon"] == "calendar"
    assert c["bluesky"] == "other"


def test_lifespans_and_spread_by_category():
    categorized = news.categorize(matched())
    spells = pd.DataFrame(
        {
            "source_id": ["x", "mastodon", "mastodon", "bluesky"],
            "key": ["astros", "#wipwednesday", "#wipwednesday", "fat bear week 2026"],
            "hours": [2.0, 5.0, 3.0, 1.0],
            "left_censored": [False, False, True, False],
            "right_censored": [False, False, False, False],
        }
    )
    life = news.lifespans(news.with_spells(spells, categorized)).set_index(["source_id", "category"])
    assert life.loc[("mastodon", "calendar"), "spells"] == 1  # the left-censored spell is left out
    assert life.loc[("mastodon", "calendar"), "median_hours"] == pytest.approx(5.0)
    spread = news.spread_by_category(categorized).set_index("category")["spread"]
    assert spread["news-linked"] == 0.0  # X's "Astros" matches only Google, which doesn't count here
    assert spread["google"] == 1.0  # Google's "astros" is also on X


def test_spread_counts_lists_besides_google():
    rows = [("mastodon", "#nationalcoffeeday"), ("instagram", "national coffee day"), ("x", "Astros"), ("google_trends", "astros")]
    table = pd.DataFrame(
        [
            {"trend_id": f"t{i}", "source_id": s, "key": t.lower(), "title": t, "first_seen": T0, "last_seen": T0,
             "best_rank": 1, "fetches": 1}
            for i, (s, t) in enumerate(rows)
        ]
    )
    cp = echo.cross_platform(table, np.stack([unit(1), unit(1), unit(0, 1), unit(0, 1)]))
    spread = news.spread_by_category(news.categorize(cp)).set_index("category")["spread"]
    assert spread["calendar"] == 1.0  # Mastodon's and Instagram's coffee day match each other
