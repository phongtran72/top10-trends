import numpy as np
import pandas as pd
import pytest

from topnews import dataset

T0 = pd.Timestamp("2026-10-01T12:07", tz="UTC")


def at(hours):
    return T0 + pd.to_timedelta(hours, unit="h")


def snaps(rows, version="m/t0.60/r1"):
    """rows: (hour, topic, position, score, ranks dict, news_count)."""
    out = []
    for hour, topic, position, score, ranks, news in rows:
        row = {
            "taken_at": at(hour), "region": "global", "topic_id": topic, "position": position, "score": score,
            "platform_count": len(ranks), "news_count": news, "algo_version": version,
        }
        row.update({f"rank_{s}": r for s, r in ranks.items()})
        out.append(row)
    return pd.DataFrame(out)


TOPICS = pd.DataFrame({"id": [1, 2, 3], "first_seen": [at(0), at(1), at(-2)]})


def test_family_strips_replay_and_select_family_takes_the_newest():
    assert dataset.family("m/t0.60/r1+replay") == "m/t0.60/r1"
    mixed = pd.concat([snaps([(0, 1, 1, 1.0, {"x": 1}, 0)], "m/t0.60/r1+replay"), snaps([(1, 1, 1, 1.0, {"x": 1}, 2)]),
                       snaps([(0, 2, 2, 0.5, {"x": 2}, 0)], "m/t0.80/r1")])
    picked, name = dataset.select_family(mixed)
    assert name == "m/t0.60/r1"
    assert sorted(picked["is_replay"]) == [False, True]  # live and rebuilt hours, same family


def build(rows, **kw):
    table, _ = dataset.build(snaps(rows), TOPICS, **kw)
    return table.set_index(["topic_id", "taken_at"])


def test_changes_count_a_missing_topic_as_on_no_platform_and_a_missing_run_as_unknown():
    rows = [
        (0, 1, 2, 1.0, {"google_trends": 2}, 1),
        (1, 1, 1, 2.5, {"google_trends": 1, "x": 3}, 1),
        (1, 2, 5, 0.3, {"bluesky": 4}, 0),  # topic 2 first appears at hour 1
        (3, 1, 1, 2.0, {"google_trends": 1, "x": 1}, 1),  # no run at hour 2
    ]
    t = build(rows)
    h1 = t.loc[(1, at(1))]
    assert h1["d1_platform_count"] == 1 and h1["d1_score"] == pytest.approx(1.5)
    assert h1["d1_position"] == 1  # climbed from 2 to 1
    assert h1["d1_rank_google_trends"] == 1 and np.isnan(h1["d1_rank_x"])  # not on X an hour earlier
    new = t.loc[(2, at(1))]
    assert new["d1_platform_count"] == 1 and new["d1_score"] == pytest.approx(0.3)  # from nothing
    assert np.isnan(t.loc[(1, at(3)), "d1_platform_count"])  # no run at hour 2: unknown
    assert t.loc[(1, at(3)), "d3_platform_count"] == 1  # hour 0 had 1 platform


def test_context_features():
    t = build([(0, 3, 1, 1.0, {"x": 1, "google_trends": 2}, 0), (1, 1, 4, 0.5, {"bluesky": 1}, 3)])
    assert t.loc[(3, at(0)), "hours_since_first_seen"] == pytest.approx(2)
    assert t.loc[(3, at(0)), "first_platform"] == "several"
    assert t.loc[(1, at(1)), "first_platform"] == "bluesky"
    assert t.loc[(1, at(1)), "hour_local"] == 9  # 13:07 UTC is 9:07 US Eastern
    assert t.loc[(1, at(1)), "news_count"] == 3


def hourly(topic, positions_and_ranks, start=0):
    return [(start + i, topic, p, 1.0, r, 0) for i, (p, r) in enumerate(positions_and_ranks)]


def test_breakout_label_looks_six_hours_ahead_and_is_unknown_near_the_end():
    one, two, three = {"x": 1}, {"x": 1, "bluesky": 2}, {"x": 1, "bluesky": 2, "google_trends": 3}
    rows = hourly(1, [(8, one), (7, two), (6, two), (5, two), (5, three)] + [(9, one)] * 7)
    t = build(rows)
    assert t.loc[(1, at(0)), "breakout_6h"] == 1.0  # three platforms at hour 4
    assert np.isnan(t.loc[(1, at(4)), "breakout_6h"])  # already broken out
    assert t.loc[(1, at(5)), "breakout_6h"] == 0.0
    assert np.isnan(t.loc[(1, at(7)), "breakout_6h"])  # hour 13 isn't in the data
    assert t.loc[(1, at(0)), "spread_6h"] == 1.0  # one platform, then two
    assert np.isnan(t.loc[(1, at(1)), "spread_6h"])  # already on two


def test_top3_counts_as_a_breakout():
    rows = hourly(1, [(5, {"x": 1}), (3, {"x": 1})] + [(9, {"x": 1})] * 6)
    assert build(rows).loc[(1, at(0)), "breakout_6h"] == 1.0


def test_hours_left_in_the_top_10_allow_short_gaps_and_censor_open_runs():
    r = {"x": 1}
    # topic 1: in the top 10 at hours 0-1, out at 2, in at 3, then out for good (12 at hours 4-9)
    one = hourly(1, [(5, r), (6, r), (12, r), (8, r)] + [(12, r)] * 6)
    # topic 2: enters the top 10 at hour 8 and is still there at the end (hour 9)
    two = hourly(2, [(4, r), (4, r)], start=8)
    t = build(one + two)
    assert t.loc[(1, at(0)), "hours_left_top10"] == 4.0  # last top-10 hour is 3, gap of 2 hours allowed
    assert t.loc[(1, at(3)), "hours_left_top10"] == 1.0
    assert np.isnan(t.loc[(1, at(2)), "hours_left_top10"])  # not in the top 10 that hour
    assert np.isnan(t.loc[(2, at(8)), "hours_left_top10"]) and t.loc[(2, at(8)), "hours_left_censored"]
    assert t.loc[(2, at(8)), "hours_left_lower"] == 2.0


def test_split_by_time_with_an_embargo():
    table = pd.DataFrame({"taken_at": [at(h) for h in range(20)]})
    s = dataset.split(table, test_days=14, embargo_hours=6)
    # under 6 weeks of data: the latest 30% (from hour 13.3) is the test set, the 6 hours before it embargoed
    assert s.tolist() == ["train"] * 8 + ["embargo"] * 6 + ["test"] * 6


def test_summary_reports_label_balance_per_split():
    rows = hourly(1, [(5, {"x": 1}), (3, {"x": 1})] + [(9, {"x": 1})] * 18)
    table, _ = dataset.build(snaps(rows), TOPICS)
    s = dataset.summary(table)
    assert set(s.index) <= {"train", "embargo", "test"}
    assert s.loc["train", "breakout_known"] >= 1


def test_one_view_is_built_and_the_us_view_is_the_default_when_there_are_two():
    rows = [(0, 1, 1, 1.0, {"x": 1}, 0), (1, 1, 2, 0.8, {"x": 2}, 0)]
    one = snaps(rows)
    assert dataset.select_view(one)[1] == "global"  # before the views existed there's only this one
    two = pd.concat([one, one.assign(region="us", position=[3, 4])])
    table, _ = dataset.build(two, TOPICS)
    assert set(table["region"]) == {"us"} and len(table) == 2  # each topic once an hour, not twice
    assert table["position"].tolist() == [3, 4] and table["d1_position"].tolist()[1] == -1  # changes stay inside the view
    table, _ = dataset.build(two, TOPICS, view="global")
    assert set(table["region"]) == {"global"} and table["position"].tolist() == [1, 2]
    with pytest.raises(ValueError):
        dataset.build(one, TOPICS, view="us")
