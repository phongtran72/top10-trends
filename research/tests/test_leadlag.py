import numpy as np
import pandas as pd
import pytest

from topnews import echo, leadlag

T0 = pd.Timestamp("2026-10-01T12:07", tz="UTC")


def unit(*values):
    v = np.zeros(echo.DIMENSIONS, dtype=np.float32)
    v[: len(values)] = values
    return v / np.linalg.norm(v)


def matches(rows, vectors):
    """rows: (source, title, first hours after T0); each seen for 2 hours."""
    table = pd.DataFrame(
        [
            {
                "trend_id": f"t{i}",
                "source_id": source,
                "key": title.lower(),
                "title": title,
                "first_seen": T0 + pd.to_timedelta(first, unit="h"),
                "last_seen": T0 + pd.to_timedelta(first + 2, unit="h"),
                "best_rank": 1,
                "fetches": 3,
            }
            for i, (source, title, first) in enumerate(rows)
        ]
    )
    return echo.cross_platform(table, np.stack(vectors))


# Every source's data starts at T0 - 5 h, so nothing here is censored unless a test says so.
STARTS = pd.Series({s: T0 - pd.to_timedelta(5, unit="h") for s in ["bluesky", "google_trends", "x", "tiktok", "mastodon"]})


def test_lead_pairs_measure_who_had_it_first_once_per_pair():
    cp = matches(
        [("google_trends", "astros", 0), ("x", "Astros", 2), ("bluesky", "Astros win", 0.2)],
        [unit(1), unit(1), unit(1, 0.2)],
    )
    pairs = leadlag.lead_pairs(cp, STARTS).set_index(["platform_a", "platform_b"])
    assert len(pairs) == 3  # each pair once, whichever side found it
    assert pairs.loc[("google_trends", "x"), "lead_hours"] == pytest.approx(2)
    assert pairs.loc[("google_trends", "x"), "first"] == "google_trends"
    assert pairs.loc[("bluesky", "google_trends"), "first"] == "tie"  # 12 minutes apart
    assert pairs.loc[("bluesky", "x"), "first"] == "bluesky"


def test_pairs_below_the_threshold_are_left_out():
    cp = matches([("google_trends", "a", 0), ("x", "b", 1)], [unit(1, 1), unit(1, 0)])  # about 0.71 alike
    assert len(leadlag.lead_pairs(cp, STARTS, threshold=0.75)) == 0
    assert len(leadlag.lead_pairs(cp, STARTS, threshold=0.70)) == 1


def test_trends_from_a_sources_first_fetch_are_censored():
    starts = STARTS.copy()
    starts["x"] = T0 + pd.to_timedelta(2, unit="h")  # X's data starts with the fetch that saw "Astros"
    cp = matches([("google_trends", "astros", 0), ("x", "Astros", 2)], [unit(1), unit(1)])
    pairs = leadlag.lead_pairs(cp, starts)
    assert pairs["censored"].tolist() == [True]
    assert leadlag.usable(pairs).empty


def test_slow_sources_are_left_out_unless_asked():
    cp = matches([("google_trends", "fall", 0), ("tiktok", "#fall", 3)], [unit(1), unit(1)])
    pairs = leadlag.lead_pairs(cp, STARTS)
    assert pairs["slow"].tolist() == [True]
    assert leadlag.usable(pairs).empty
    assert len(leadlag.usable(pairs, include_slow=True)) == 1


def test_story_pairs_count_a_story_once_and_use_each_platforms_earliest_sighting():
    cp = matches(
        [
            ("google_trends", "phillies - braves", 0),
            ("google_trends", "phillies", 1),
            ("x", "Phillies", 3),
            ("bluesky", "Phillies force Game 3", 4),
        ],
        [unit(1, 0.1), unit(1), unit(1), unit(1, 0.2)],
    )
    pairs = leadlag.lead_pairs(cp, STARTS)
    assert len(pairs) > 3  # the variants make several trend pairs
    stories = leadlag.story_pairs(pairs).set_index(["platform_a", "platform_b"])
    assert stories["story"].nunique() == 1
    assert len(stories) == 3  # one per pair of platforms
    assert stories.loc[("google_trends", "x"), "lead_hours"] == pytest.approx(3)  # from Google's earliest variant
    assert stories.loc[("bluesky", "x"), "first"] == "x"
    assert stories["label"].iloc[0] == "phillies - braves"


def test_story_pairs_mark_a_platform_censored_when_its_earliest_trend_is():
    starts = STARTS.copy()
    starts["x"] = T0 + pd.to_timedelta(3, unit="h")
    cp = matches([("google_trends", "a", 0), ("x", "a", 3), ("bluesky", "a", 5)], [unit(1), unit(1), unit(1)])
    stories = leadlag.story_pairs(leadlag.lead_pairs(cp, starts)).set_index(["platform_a", "platform_b"])
    assert stories.loc[("google_trends", "x"), "censored"]
    assert not stories.loc[("bluesky", "google_trends"), "censored"]


def test_summaries_by_pair_and_by_platform():
    cp = matches(
        [("google_trends", "a", 0), ("x", "a", 2), ("google_trends", "b", 5), ("x", "b", 4), ("google_trends", "c", 1), ("x", "c", 1)],
        [unit(1), unit(1), unit(0, 1), unit(0, 1), unit(0, 0, 1), unit(0, 0, 1)],
    )
    pairs = leadlag.usable(leadlag.lead_pairs(cp, STARTS))
    summary = leadlag.pair_summary(pairs).iloc[0]
    assert (summary["pairs"], summary["a_first"], summary["ties"], summary["b_first"]) == (3, 1, 1, 1)
    assert summary["median_lead_hours"] == pytest.approx(0)
    board = leadlag.leaders(pairs)
    assert board.loc["google_trends", "first"] == pytest.approx(1 / 3)
    assert board.loc["x", "later"] == pytest.approx(1 / 3)
    assert board.loc["google_trends", "median_hours_ahead"] == pytest.approx(0)
