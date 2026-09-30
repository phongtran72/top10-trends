"""RQ3 · Breakout: what separates trends that spread to other platforms from those that don't?

Works on RQ6's cross-platform matches (topnews.echo) before topic snapshots
exist. Breakouts to 3 or more platforms are too rare to study yet (RQ6), so
the outcome here is *spread*: matched on at least one other list at
`threshold` (0.70 by default, since a wrong match makes a wrong label).

Features are what's known when a trend is first seen: its platform, entry
rank, metric against its list's median, hour of day and the shape of its
title. To compare fairly, only trends whose entry was seen (not already
listed at their source's first fetch) and that had at least `window_hours`
of data after their first sighting count: a trend seen in the last hour of
the data hasn't failed to spread, it hasn't had time.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from . import rhythms
from .echo import RUN_MARGIN
from .leadlag import PAIR_THRESHOLD

WINDOW_HOURS = 6.0


def label(cp: pd.DataFrame, threshold: float = PAIR_THRESHOLD) -> pd.DataFrame:
    """Adds `platforms` (how many lists have the trend, its own included), `spread` (2 or more) and
    `breakout` (3 or more)."""
    sims = cp[[c for c in cp.columns if c.startswith("sim_")]]
    platforms = 1 + (sims >= threshold).sum(axis=1)
    return cp.assign(platforms=platforms, spread=platforms >= 2, breakout=platforms >= 3)


def features(cp: pd.DataFrame, items: pd.DataFrame) -> pd.DataFrame:
    """Adds what was known at each trend's first sighting: entry rank, the metric against its list's
    median, the hour (US Eastern) and the title's shape."""
    keyed = rhythms.keyed(items)
    first = keyed.sort_values(["fetched_at", "rank"]).drop_duplicates(["source_id", "key"])
    medians = keyed.groupby("source_id")["metric_value"].median()
    first = first.assign(metric_vs_median=first["metric_value"] / first["source_id"].map(medians).replace(0, np.nan))
    joined = cp.merge(
        first[["source_id", "key", "rank", "metric_vs_median"]].rename(columns={"rank": "entry_rank"}),
        on=["source_id", "key"],
        how="left",
    )
    words = joined["title"].map(rhythms.title_key).str.split()
    return rhythms.with_clock(joined, column="first_seen").assign(
        words=words.str.len(),
        hashtag=joined["title"].str.strip().str.startswith("#"),
    )


def observable(table: pd.DataFrame, items: pd.DataFrame, window_hours: float = WINDOW_HOURS) -> pd.DataFrame:
    """The trends whose entry was seen and that had `window_hours` of data after their first sighting."""
    starts = items.groupby("source_id")["fetched_at"].min()
    end = items["fetched_at"].max()
    entered = table["first_seen"] > table["source_id"].map(starts) + RUN_MARGIN
    had_time = table["first_seen"] <= end - pd.to_timedelta(window_hours, unit="h")
    return table[entered & had_time]


def wilson(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson interval for a proportion: sensible for small counts and rates near 0."""
    if n == 0:
        return (math.nan, math.nan)
    p = successes / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return (max(0.0, centre - half), min(1.0, centre + half))


def rates(table: pd.DataFrame, by: str, outcome: str = "spread") -> pd.DataFrame:
    """The outcome's rate per value of `by`, with counts and a 95% Wilson interval."""
    rows = []
    for value, group in table.groupby(by, observed=True):
        k, n = int(group[outcome].sum()), len(group)
        low, high = wilson(k, n)
        rows.append({by: value, "trends": n, outcome: k, "rate": k / n if n else math.nan, "low": low, "high": high})
    return pd.DataFrame(rows)


def buckets(table: pd.DataFrame) -> pd.DataFrame:
    """Coarse groups for the rate tables: entry rank 1–3, 4–6, 7–10 or deeper (Bluesky, Hacker News and Twitch
    list 25); metric below, near or above its list's median; morning, afternoon or evening (US Eastern); one
    word, 2–3 words, 4 or more."""
    return table.assign(
        entry=pd.cut(table["entry_rank"], [0, 3, 6, 10, np.inf], labels=["1–3", "4–6", "7–10", "11+"]),
        metric=pd.cut(table["metric_vs_median"], [0, 0.5, 2, np.inf], labels=["below half", "near", "over twice"]),
        part_of_day=pd.cut(table["hour_local"], [-1, 11, 17, 23], labels=["before noon", "noon–6 pm", "after 6 pm"]),
        length=pd.cut(table["words"], [0, 1, 3, np.inf], labels=["1 word", "2–3 words", "4+ words"]),
    )
