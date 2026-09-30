import pandas as pd
import pytest

from topnews import lifecycle

T0 = pd.Timestamp("2026-10-01T12:07", tz="UTC")


def lists(fetches, source="mastodon", offsets=None, metrics=None):
    """fetches: one list of titles per fetch, an hour apart unless `offsets` (hours) are given."""
    rows = []
    for i, titles in enumerate(fetches):
        at = T0 + pd.to_timedelta(offsets[i] if offsets else i, unit="h")
        for rank, title in enumerate(titles, start=1):
            rows.append(
                {
                    "run_id": i + 1,
                    "source_id": source,
                    "region": "global",
                    "rank": rank,
                    "title": title,
                    "url": None,
                    "fetched_at": at,
                    "metric_value": None if metrics is None else metrics[i][rank - 1],
                }
            )
    return pd.DataFrame(rows)


def by_title(table):
    return {(r.title, r.spell): r for r in table.itertuples()}


def test_spells_measure_entry_to_exit_and_mark_censoring():
    items = lists([["b"], ["b", "a"], ["a", "b"], ["c"], ["c"]])
    s = by_title(lifecycle.spells(items))
    a = s[("a", 1)]
    assert (a.hours, a.fetches, a.left_censored, a.right_censored) == (2.0, 2, False, False)  # in at 13:07, gone at 15:07
    assert (a.entry_rank, a.best_rank, a.exit_rank, a.hours_to_best) == (2, 1, 1, 1.0)
    assert s[("b", 1)].left_censored  # already listed at the first fetch
    c = s[("c", 1)]
    assert c.right_censored and c.hours == 1.0  # still listed at the last fetch: at least an hour


def test_an_item_that_leaves_and_comes_back_has_two_spells():
    items = lists([["x"], ["a", "x"], ["x"], ["a", "x"], ["x"]])
    s = by_title(lifecycle.spells(items))
    assert s[("a", 1)].hours == 1.0 and s[("a", 2)].hours == 1.0


def test_max_missed_carries_a_stay_through_short_absences():
    items = lists([["x"], ["a", "x"], ["x"], ["a", "x"], ["x"], ["x"], ["x"]])
    one = by_title(lifecycle.spells(items, max_missed=1))
    assert ("a", 2) not in one  # one stay, through the missed fetch
    assert (one[("a", 1)].hours, one[("a", 1)].fetches, one[("a", 1)].right_censored) == (3.0, 2, False)


def test_max_missed_leaves_a_stay_open_near_the_end_of_the_data():
    items = lists([["x"], ["a", "x"], ["x"]])
    assert not by_title(lifecycle.spells(items))[("a", 1)].right_censored
    assert by_title(lifecycle.spells(items, max_missed=1))[("a", 1)].right_censored  # it might be back next hour


def test_a_gap_in_the_lists_fetches_censors_both_sides():
    items = lists([["x"], ["x", "a"], ["x", "a"], ["x"]], offsets=[0, 1, 5, 6])  # no fetches from 13:07 to 17:07
    s = by_title(lifecycle.spells(items))
    assert s[("a", 1)].right_censored and not s[("a", 1)].left_censored
    assert s[("a", 2)].left_censored and not s[("a", 2)].right_censored


def test_survival_gives_the_half_life_and_treats_ongoing_spells_as_ongoing():
    spells = pd.DataFrame(
        {
            "list_id": "bluesky",
            "hours": [1.0, 2.0, 3.0, 5.0],
            "left_censored": [False, False, False, True],
            "right_censored": [False, False, False, False],
        }
    )
    row = lifecycle.survival(spells).iloc[0]
    assert row["spells"] == 3  # the left-censored one is left out
    assert row["median_hours"] == pytest.approx(2.0)
    assert row["listed_after_1h"] == pytest.approx(2 / 3)
    ongoing = spells.assign(right_censored=[False, False, True, False])
    assert lifecycle.survival(ongoing).iloc[0]["listed_after_3h"] == pytest.approx(1 / 3)


def test_shapes_and_rank_paths():
    items = lists([["x"], ["x", "y", "a"], ["a", "x"], ["x", "a"], ["x"]])
    s = lifecycle.spells(items)
    shape = lifecycle.shapes(s).set_index("list_id").loc["mastodon"]
    a_and_y = s[~s.left_censored]
    assert shape["spells"] == len(a_and_y)
    assert shape["climbed"] == pytest.approx(0.5)  # a climbed from 3 to 1; y entered at its best
    paths = lifecycle.rank_paths(items, s).set_index("age")
    assert paths.loc[0, "still_listed"] == 2  # a and y in their first hour
    assert paths.loc[1, "median_rank"] == 1.0  # only a at age 1, at rank 1


def test_metrics_at_the_start_and_end_of_a_spell():
    items = lists([["x"], ["x", "a"], ["a", "x"]], metrics=[[5], [6, 10], [40, 7]])
    a = by_title(lifecycle.spells(items))[("a", 1)]
    assert (a.metric_start, a.metric_end) == (10.0, 40.0)
