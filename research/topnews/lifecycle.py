"""RQ1 · Lifecycle: how trends rise, peak and fade, and how long they last.

Works on stored lists (db.trend_items), per platform, before topic
snapshots exist. A *spell* is one stay in a list's top `depth`: from the fetch
it entered to the first fetch it's missing from. Items are matched across
fetches as in rhythms (url for Bluesky and Hacker News, title elsewhere).

Two kinds of censoring keep the durations honest:

- a spell already running at the list's first fetch, or right after a gap
  in the list's fetches, started at an unknown time: it's `left_censored`
  and left out of durations;
- a spell still running at the list's last fetch, or right before a gap,
  hasn't ended: it's `right_censored`, and its duration so far is a lower
  bound. Survival curves (Kaplan–Meier) use those correctly.

Fetches are hourly, so durations are whole hours: an item seen in one fetch
counts as 1 hour, and "listed after 1 h" means it was still there at the next
hourly fetch.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import rhythms

DEPTH = rhythms.DEPTH
MAX_GAP_HOURS = rhythms.MAX_GAP_HOURS
SURVIVAL_HOURS = (1, 2, 3, 6, 12)


def _whole_hours(span: np.timedelta64) -> float:
    """Durations in whole hours, at least 1: fetches are hourly, and their minutes wobble (12:07, 13:08,
    18:10…), so 0.98 and 1.04 hours are both one fetch interval."""
    return float(max(1, round(span / np.timedelta64(1, "h"))))


def spells(
    items: pd.DataFrame, depth: int = DEPTH, max_missed: int = 0, max_gap_hours: float = MAX_GAP_HOURS
) -> pd.DataFrame:
    """One row per stay in a list's top `depth`, with its ranks, metrics and censoring.

    With `max_missed` above 0, a stay carries on through up to that many
    fetches in a row without the item. Bluesky's list drops and re-adds
    topics from hour to hour. A stay whose last sighting is that close to the
    end of the data, or to a gap, might still come back, so it's
    right-censored.
    """
    top = rhythms.keyed(items[items["rank"] <= depth]).sort_values("rank").drop_duplicates(["list_id", "run_id", "key"])
    rows = []
    for list_id, group in top.groupby("list_id", sort=False):
        fetches = group.groupby("run_id")["fetched_at"].min().sort_values()
        times = fetches.to_numpy()
        index_of = {run: i for i, run in enumerate(fetches.index)}
        gap_after = np.append(np.diff(times) / np.timedelta64(1, "h") > max_gap_hours, True)  # last fetch: data end
        gap_before = np.insert(gap_after[:-1], 0, True)  # first fetch: data start
        # For each fetch, the last fetch before the next gap (or the data end).
        stretch_end = np.array([np.flatnonzero(gap_after[i:])[0] + i for i in range(len(times))])
        source = group["source_id"].iloc[0]
        for key, sightings in group.groupby("key", sort=False):
            sightings = sightings.assign(i=sightings["run_id"].map(index_of)).sort_values("i")
            positions = sightings["i"].to_numpy()
            # A new spell starts where the item missed more than max_missed fetches, or where the list had a gap.
            jumped = np.diff(positions) > 1 + max_missed
            crossed_gap = np.array([gap_after[a:b].any() for a, b in zip(positions[:-1], positions[1:])], dtype=bool)
            breaks = np.flatnonzero(jumped | crossed_gap) + 1
            for part in np.split(np.arange(len(positions)), breaks):
                spell = sightings.iloc[part]
                first, last = int(spell["i"].iloc[0]), int(spell["i"].iloc[-1])
                ended = last + max_missed < stretch_end[last]
                end = times[last + 1] if ended else times[last]
                ranks = spell["rank"].to_numpy()
                metrics = spell["metric_value"].to_numpy(dtype=float)
                rows.append(
                    {
                        "list_id": list_id,
                        "source_id": source,
                        "key": key,
                        "title": spell["title"].iloc[-1],
                        "start": pd.Timestamp(times[first]),
                        "end": pd.Timestamp(end),
                        "fetches": len(spell),
                        "hours": _whole_hours(end - times[first]),
                        "entry_rank": int(ranks[0]),
                        "best_rank": int(ranks.min()),
                        "exit_rank": int(ranks[-1]),
                        "hours_to_best": (spell["fetched_at"].iloc[int(ranks.argmin())] - spell["fetched_at"].iloc[0]).total_seconds() / 3600,
                        "metric_start": metrics[0],
                        "metric_end": metrics[-1],
                        "left_censored": bool(gap_before[first]),
                        "right_censored": not ended,
                    }
                )
    out = pd.DataFrame(rows)
    if out.empty:
        return out
    out["spell"] = out.groupby(["list_id", "key"]).cumcount() + 1
    return out


def survival(spell_table: pd.DataFrame, hours: tuple[float, ...] = SURVIVAL_HOURS) -> pd.DataFrame:
    """Per list, a Kaplan–Meier estimate of time in the top 10: the median ("half-life") and the share still
    listed after each of `hours`. Left-censored spells are left out; right-censored ones count as ongoing."""
    from lifelines import KaplanMeierFitter

    rows = []
    usable = spell_table[~spell_table["left_censored"]]
    for list_id, group in usable.groupby("list_id"):
        km = KaplanMeierFitter().fit(group["hours"], event_observed=~group["right_censored"])
        row = {
            "list_id": list_id,
            "spells": len(group),
            "ended": int((~group["right_censored"]).sum()),
            "median_hours": float(km.median_survival_time_),
        }
        for h in hours:
            row[f"listed_after_{h}h"] = float(km.survival_function_at_times(h).iloc[0])
        rows.append(row)
    return pd.DataFrame(rows)


def shapes(spell_table: pd.DataFrame) -> pd.DataFrame:
    """Per list, over spells whose start is known: where trends enter, how often they climb after entering,
    how long they take to reach their best rank, and how often an item comes back for another spell."""
    usable = spell_table[~spell_table["left_censored"]]
    return (
        usable.groupby("list_id")
        .apply(
            lambda g: pd.Series(
                {
                    "spells": len(g),
                    "median_entry_rank": float(g["entry_rank"].median()),
                    "climbed": float((g["best_rank"] < g["entry_rank"]).mean()),
                    "peak_at_entry": float((g["hours_to_best"] == 0).mean()),
                    "median_hours_to_best": float(g["hours_to_best"].median()),
                    "came_back": float((g["spell"] > 1).mean()),
                }
            ),
            include_groups=False,
        )
        .reset_index()
    )


def rank_paths(items: pd.DataFrame, spell_table: pd.DataFrame, depth: int = DEPTH) -> pd.DataFrame:
    """Per list and hours since entry: the median rank of the spells still listed, for spells whose start is
    known. The shape of a typical rise and fall."""
    usable = spell_table[~spell_table["left_censored"]]
    top = rhythms.keyed(items[items["rank"] <= depth])
    joined = top.merge(usable[["list_id", "key", "start", "end"]], on=["list_id", "key"])
    joined = joined[(joined["fetched_at"] >= joined["start"]) & (joined["fetched_at"] < joined["end"] + pd.to_timedelta(1, unit="min"))]
    joined = joined.assign(age=((joined["fetched_at"] - joined["start"]).dt.total_seconds() / 3600).round().astype(int))
    return (
        joined.groupby(["list_id", "age"])
        .agg(median_rank=("rank", "median"), still_listed=("key", "nunique"))
        .reset_index()
    )
