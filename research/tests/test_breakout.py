import numpy as np
import pandas as pd
import pytest

from topnews import breakout, echo

T0 = pd.Timestamp("2026-10-01T12:07", tz="UTC")


def unit(*values):
    v = np.zeros(echo.DIMENSIONS, dtype=np.float32)
    v[: len(values)] = values
    return v / np.linalg.norm(v)


def matched(rows, vectors):
    """rows: (source, title, first hours after T0)."""
    table = pd.DataFrame(
        [
            {
                "trend_id": f"t{i}",
                "source_id": source,
                "key": title.lower(),
                "title": title,
                "first_seen": T0 + pd.to_timedelta(first, unit="h"),
                "last_seen": T0 + pd.to_timedelta(first + 1, unit="h"),
                "best_rank": 1,
                "fetches": 2,
            }
            for i, (source, title, first) in enumerate(rows)
        ]
    )
    return echo.cross_platform(table, np.stack(vectors))


def test_label_counts_platforms_including_the_trends_own():
    cp = matched(
        [("google_trends", "astros", 1), ("x", "Astros", 1), ("bluesky", "Astros win", 1), ("twitch", "Minecraft", 1)],
        [unit(1), unit(1), unit(1, 0.1), unit(0, 1)],
    )
    labelled = breakout.label(cp, threshold=0.9).set_index("source_id")
    assert labelled.loc["google_trends", "platforms"] == 3
    assert labelled.loc["google_trends", "breakout"]
    assert not labelled.loc["twitch", "spread"]


def test_features_come_from_the_first_sighting():
    cp = matched([("hacker_news", "Show HN: A thing", 1)], [unit(1)])
    items = pd.DataFrame(
        {
            "run_id": [1, 2, 3],
            "source_id": "hacker_news",
            "region": "global",
            "rank": [9, 4, 2],
            "title": "Show HN: A thing",
            "url": "https://example.com/thing",
            "metric_value": [10.0, 40.0, 80.0],
            "fetched_at": [T0 + pd.to_timedelta(h, unit="h") for h in (1, 2, 3)],
        }
    )
    cp = cp.assign(key="https://example.com/thing")  # Hacker News is keyed by url
    row = breakout.features(cp, items).iloc[0]
    assert row["entry_rank"] == 9
    assert row["metric_vs_median"] == pytest.approx(10 / 40)
    assert row["words"] == 4 and not row["hashtag"]
    assert row["hour_local"] == 9  # 13:07 UTC is 9:07 US Eastern


def test_observable_needs_a_seen_entry_and_time_to_spread():
    table = pd.DataFrame(
        {
            "source_id": ["x", "x", "x"],
            "first_seen": [T0, T0 + pd.to_timedelta(2, unit="h"), T0 + pd.to_timedelta(9, unit="h")],
        }
    )
    items = pd.DataFrame({"source_id": "x", "fetched_at": [T0, T0 + pd.to_timedelta(10, unit="h")]})
    kept = breakout.observable(table, items, window_hours=6)
    assert kept["first_seen"].tolist() == [T0 + pd.to_timedelta(2, unit="h")]  # not the first fetch, not the last hours


def test_wilson_interval_behaves_at_the_edges():
    low, high = breakout.wilson(0, 20)
    assert low == 0.0 and 0.1 < high < 0.2
    low, high = breakout.wilson(10, 20)
    assert low < 0.5 < high
    assert all(np.isnan(breakout.wilson(0, 0)))


def test_rates_by_bucket():
    table = pd.DataFrame({"entry_rank": [1, 2, 8, 19], "spread": [True, False, False, False]})
    r = breakout.rates(breakout.buckets(table.assign(metric_vs_median=1.0, hour_local=12, words=2)), "entry").set_index("entry")
    assert (r.loc["1–3", "trends"], r.loc["1–3", "spread"], r.loc["1–3", "rate"]) == (2, 1, 0.5)
    assert r.loc["11+", "trends"] == 1  # deep entries on the 25-item lists are counted too
