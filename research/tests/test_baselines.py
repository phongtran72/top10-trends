import numpy as np
import pandas as pd
import pytest

from topnews import baselines

T0 = pd.Timestamp("2026-10-01T12:07", tz="UTC")


def at(hours):
    return T0 + pd.to_timedelta(hours, unit="h")


def spells(rows):
    """rows: (list, title, start hour, hours, right_censored)."""
    return pd.DataFrame(
        [
            {"list_id": l, "title": t, "start": at(s), "end": at(s + h), "hours": float(h), "left_censored": False, "right_censored": rc}
            for l, t, s, h, rc in rows
        ]
    )


def test_split_time_keeps_the_first_share_for_training():
    items = pd.DataFrame({"fetched_at": [at(0), at(10)]})
    assert baselines.split_time(items, 0.7) == at(7)


def test_training_spells_are_cut_at_the_split():
    s = spells([("bluesky", "done", 0, 2, False), ("bluesky", "running", 4, 5, False), ("bluesky", "later", 8, 1, False)])
    train = baselines.training_spells(s, at(6)).set_index("title")
    assert list(train.index) == ["done", "running"]  # "later" started after the split
    assert not train.loc["done", "right_censored"]
    assert train.loc["running", "right_censored"] and train.loc["running", "hours"] == 2.0  # known only up to the split


def test_median_left_by_age_from_training():
    train = spells([("hn", "a", 0, 1, False), ("hn", "b", 0, 1, False), ("hn", "c", 0, 3, False), ("hn", "d", 0, 3, False), ("hn", "e", 0, 4, False)])
    table = baselines.median_left_table(train).set_index("age")["median_left"]
    assert table[0] == pytest.approx(3.0)  # a fresh entry: median lifetime
    assert table[1] == pytest.approx(2.0)  # survived 1 h: of c, d, e, 2 more hours is the median
    assert table[4] == pytest.approx(1.0)  # at least an hour


def test_lifespan_forecasts_come_after_the_split_and_score_only_ended_stays():
    train = spells([("hn", "a", 0, 1, False), ("hn", "b", 0, 3, False)])
    table = baselines.median_left_table(train)
    test = spells([("hn", "x", 7, 3, False), ("hn", "y", 8, 2, True)])
    f = baselines.lifespan_forecasts(test, at(6), table)
    x = f[f.title == "x"]
    assert x["age"].tolist() == [0, 1, 2]
    assert x["actual_left"].tolist() == [3.0, 2.0, 1.0]
    assert x["as_long_again"].tolist() == [1.0, 1.0, 2.0]
    assert f[f.title == "y"]["actual_left"].isna().all()  # still listed at the end: not scored
    scores = baselines.score_lifespans(f).set_index("rule")
    assert scores.loc["one_more_hour", "forecasts"] == 3
    assert scores.loc["one_more_hour", "mean_error_hours"] == pytest.approx((2 + 1 + 0) / 3)


def test_horizon_scores_count_long_stays_that_are_still_running():
    train = spells([("hn", "a", 0, 1, False), ("hn", "b", 0, 1, False), ("hn", "c", 0, 1, False)])
    table = baselines.median_left_table(train)
    # x ends after 1 hour; y is still listed when the data ends at hour 12.
    test = spells([("hn", "x", 7, 1, False), ("hn", "y", 7, 5, True)])
    f = baselines.lifespan_forecasts(test, at(6), table)
    scores = baselines.score_horizons(f, data_end=at(12), ks=(1,)).set_index("rule")
    # Ages 0 to 4 for y (it's listed through hour 12) and 0 for x; all made at least an hour before the end.
    assert scores.loc["one_more_hour", "forecasts"] == 6
    assert scores.loc["one_more_hour", "still_listed"] == pytest.approx(5 / 6)  # every y forecast; x was gone
    assert scores.loc["one_more_hour", "accuracy"] == pytest.approx(1 / 6)  # it always says no
    assert scores.loc["as_long_again", "accuracy"] == pytest.approx(4 / 6)  # yes at y's ages 2-4, no for x


def test_horizon_scores_leave_out_stays_last_seen_before_the_answer_is_due():
    train = spells([("bluesky", "a", 0, 1, False)])
    table = baselines.median_left_table(train)
    # z was last seen at hour 9 and might come back (a stay left open by max_missed); the data ends at 12.
    test = pd.DataFrame(
        [{"list_id": "bluesky", "title": "z", "start": at(7), "end": at(9), "hours": 2.0, "left_censored": False, "right_censored": True}]
    )
    f = baselines.lifespan_forecasts(test, at(6), table)
    scores = baselines.score_horizons(f, data_end=at(12), ks=(1, 3)).set_index(["k_hours", "rule"])
    assert scores.loc[(1, "one_more_hour"), "forecasts"] == 2  # ages 0 and 1: seen 1 hour later, so known
    assert scores.loc[(1, "one_more_hour"), "still_listed"] == 1.0
    assert (3, "one_more_hour") not in scores.index  # 3 hours later is past its last sighting: unknown


def starts(rows):
    """rows: (story, platform, first hour, censored)."""
    return pd.DataFrame([{"story": s, "platform": p, "first": at(h), "censored": c} for s, p, h, c in rows])


def test_breakout_rule_alerts_on_two_platforms_within_two_hours_and_scores_lead_time():
    st = starts(
        [
            ("game", "google_trends", 0, False), ("game", "x", 1, False), ("game", "bluesky", 4, False),  # breaks out
            ("tag", "mastodon", 0, False), ("tag", "instagram", 5, False),  # 2 platforms, too slowly to alert
            ("old", "x", 0, True), ("old", "google_trends", 1, True), ("old", "bluesky", 2, True),  # censored
        ]
    )
    f = baselines.breakout_forecasts(st, [at(1), at(2)], data_end=at(9))
    assert set(f["story"]) == {"game", "tag"}
    game = f[(f.story == "game") & (f["at"] == at(1))].iloc[0]
    assert game["alert"] and game["breakout"] and game["lead_hours"] == pytest.approx(3)
    assert not f[f.story == "tag"]["alert"].any()
    score = baselines.score_breakouts(f)
    assert score["precision"] == 1.0 and score["recall"] == 1.0 and score["median_lead_hours"] == pytest.approx(2.5)


def test_breakout_hours_need_six_hours_of_data_after_them():
    st = starts([("game", "google_trends", 0, False), ("game", "x", 1, False)])
    assert baselines.breakout_forecasts(st, [at(1), at(4)], data_end=at(8))["at"].tolist() == [at(1)]
    assert np.isnan(baselines.score_breakouts(baselines.breakout_forecasts(st, [at(4)], data_end=at(8)))["precision"])
