"""RQ5 · Rhythms: how attention varies by hour of day (and later weekday).

Works on stored lists (db.trend_items): one row per item per fetch, about
hourly. Every measure uses each list's top `depth` items (10 by default, the
depth the site shows and all that Google Trends' feed has), per fetch:

- turnover: the share of the top 10 that wasn't in the list about an hour earlier;
- novelty: items in the top 10 for the first time since the data starts;
- flow: how fast the top 10's metric grows, per hour, relative to the list's median.

Every stored metric is a running total for its item (Bluesky posts, Hacker
News points, Mastodon uses today), so activity is its growth between fetches,
not its level: a list full of old topics has big totals and little growth.

An hour-of-day effect is estimated with a separate baseline per day (day
fixed effects), so one busy news day isn't read as a time-of-day pattern. It
needs data from at least MIN_DAYS different days.
"""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

# Sources whose lists refresh far less often than hourly (TikTok daily,
# Instagram every few hours, Pinterest twice a week): their hour-to-hour
# changes aren't signal (PLAN.md › Predictions and research).
SLOW_SOURCES = frozenset({"tiktok", "instagram", "pinterest"})

# Sources whose url is the item's identity: Bluesky rewrites a topic's title
# as the story moves on (the url holds the feed id), Hacker News titles get
# edited, and Reddit's url holds the post id.
URL_IDENTITY = frozenset({"bluesky", "hacker_news", "reddit"})

# Metrics too coarse for growth: Google's searches come in buckets (200+,
# 500+, 1,000+ …), so most hours show no change.
FLOW_EXCLUDED = frozenset({"google_trends"})

DEPTH = 10
MIN_DAYS = 3
# A fetch is compared with the latest earlier fetch at least MIN_GAP_HOURS
# before (so an extra manual run doesn't shorten the window), and only when
# that fetch is at most MAX_GAP_HOURS before (so a missed run doesn't stretch it).
MIN_GAP_HOURS = 0.75
MAX_GAP_HOURS = 1.5
AUDIENCE_TZ = "America/New_York"


def split_hashtag(tag: str) -> str:
    """Splits a hashtag body into words, as lib/text.ts splitHashtag does: "WorldSeries2026" → "World Series 2026"."""
    tag = re.sub(r"([a-z])([A-Z])", r"\1 \2", tag)
    tag = re.sub(r"([A-Z]+)([A-Z][a-z]{2,})", r"\1 \2", tag)
    tag = re.sub(r"([A-Za-z]{2,})(\d)", r"\1 \2", tag)
    tag = re.sub(r"(\d)([A-Za-z]{2,})", r"\1 \2", tag)
    return re.sub(r"_+", " ", tag)


def title_key(title: str) -> str:
    """Loose identity for matching one source's items across hours by title: hashtags split into words, lowercase."""
    split = re.sub(r"#(\w+)", lambda m: split_hashtag(m.group(1)), title)
    return re.sub(r"\s+", " ", split.lower().replace("#", " ")).strip()


def list_id(source_id: str, region: str) -> str:
    """One name per stored list: the source, plus the region unless it's global."""
    return source_id if region == "global" else f"{source_id} ({region})"


def keyed(items: pd.DataFrame) -> pd.DataFrame:
    """Adds list_id and key (the url for URL_IDENTITY sources, else the loose title)."""
    by_url = items["source_id"].isin(URL_IDENTITY) & items["url"].notna()
    return items.assign(
        list_id=[list_id(s, r) for s, r in zip(items["source_id"], items["region"])],
        key=np.where(by_url, items["url"], items["title"].map(title_key)),
    )


def _runs(frame: pd.DataFrame) -> pd.DataFrame:
    runs = (
        frame.groupby(["list_id", "source_id", "run_id"], sort=False)
        .agg(fetched_at=("fetched_at", "min"), keys=("key", frozenset), size=("key", "size"))
        .reset_index()
        .sort_values(["list_id", "fetched_at"])
    )
    return runs.reset_index(drop=True)


def list_runs(items: pd.DataFrame, depth: int = DEPTH) -> pd.DataFrame:
    """One row per list and fetch: the fetch time and the set of item keys in its top `depth`."""
    return _runs(keyed(items[items["rank"] <= depth]))


def comparisons(
    runs: pd.DataFrame, min_gap_hours: float = MIN_GAP_HOURS, max_gap_hours: float = MAX_GAP_HOURS
) -> pd.DataFrame:
    """Pairs each fetch with the fetch of the same list about an hour earlier.

    That's the latest earlier fetch at least min_gap_hours older. When it's
    more than max_gap_hours older (a missed run), or there is none (the list's
    first fetch), the fetch has no pair and is left out.
    """
    columns = ["list_id", "source_id", "run_id", "fetched_at", "previous_run_id", "gap_hours"]
    rows = []
    for _, group in runs.groupby("list_id", sort=False):
        fetches = list(group.itertuples(index=False))
        for i, row in enumerate(fetches):
            for earlier in reversed(fetches[:i]):
                gap = (row.fetched_at - earlier.fetched_at).total_seconds() / 3600
                if gap >= min_gap_hours:
                    if gap <= max_gap_hours:
                        rows.append([row.list_id, row.source_id, row.run_id, row.fetched_at, earlier.run_id, gap])
                    break
    return pd.DataFrame(rows, columns=columns)


def turnover(runs: pd.DataFrame, **gaps: float) -> pd.DataFrame:
    """Per fetch: how many items of the top 10 weren't in the top 10 about an hour earlier.

    For a list shorter than it is busy, share_new saturates: Google's feed
    holds only the 10 newest trends, so 1.0 there means "10 or more".
    """
    pairs = comparisons(runs, **gaps)
    keys = runs.set_index(["list_id", "run_id"])["keys"]
    now = [keys[(name, run)] for name, run in zip(pairs["list_id"], pairs["run_id"])]
    before = [keys[(name, run)] for name, run in zip(pairs["list_id"], pairs["previous_run_id"])]
    new = [len(a - b) for a, b in zip(now, before)]
    size = [len(a) for a in now]
    return pairs.assign(size=size, new=new, share_new=np.array(new) / np.array(size, dtype=float))


def novelty(items: pd.DataFrame, depth: int = DEPTH) -> pd.DataFrame:
    """Per fetch: how many items are in the list's top `depth` for the first time since the data starts.

    Each list's first fetch is left out (everything in it is 'first'). Early
    hours still run high, because a topic that trended just before the data
    starts looks new when it comes back; the bias fades as the data grows.
    """
    df = keyed(items[items["rank"] <= depth])
    first = df.sort_values("fetched_at").drop_duplicates(["list_id", "key"])
    counts = first.groupby(["list_id", "run_id"]).size().rename("first_time")
    runs = df.groupby(["list_id", "source_id", "run_id"]).agg(fetched_at=("fetched_at", "min")).reset_index()
    runs = runs.join(counts, on=["list_id", "run_id"]).fillna({"first_time": 0}).astype({"first_time": int})
    opening = runs.groupby("list_id")["fetched_at"].transform("min")
    return runs[runs["fetched_at"] > opening].sort_values(["list_id", "fetched_at"]).reset_index(drop=True)


def flow(items: pd.DataFrame, depth: int = DEPTH, **gaps: float) -> pd.DataFrame:
    """Per fetch: the median hourly growth of the metric of top-`depth` items, and that relative to the list's median.

    An item counts when it's in this fetch's top `depth` and anywhere in the
    list about an hour earlier. A fall in the metric (Mastodon's "uses today"
    resets at midnight UTC) drops that item. Lists without a metric, and those
    in FLOW_EXCLUDED, are left out.
    """
    frame = keyed(items[items["metric_value"].notna() & ~items["source_id"].isin(FLOW_EXCLUDED)])
    frame = frame.sort_values("rank").drop_duplicates(["list_id", "run_id", "key"])
    columns = ["list_id", "source_id", "run_id", "fetched_at", "gap_hours", "matched", "rate", "relative"]
    if frame.empty:
        return pd.DataFrame(columns=columns)
    pairs = comparisons(_runs(frame), **gaps)
    values = frame[["list_id", "run_id", "key", "rank", "metric_value"]]
    now = pairs.merge(values[values["rank"] <= depth], on=["list_id", "run_id"])
    before = values.drop(columns="rank").rename(columns={"run_id": "previous_run_id", "metric_value": "previous"})
    joined = now.merge(before, on=["list_id", "previous_run_id", "key"])
    joined["rate"] = (joined["metric_value"] - joined["previous"]) / joined["gap_hours"]
    joined = joined[joined["rate"] >= 0]
    per_run = (
        joined.groupby(["list_id", "source_id", "run_id", "fetched_at", "gap_hours"])
        .agg(matched=("rate", "size"), rate=("rate", "median"))
        .reset_index()
    )
    median = per_run.groupby("list_id")["rate"].transform("median")
    per_run["relative"] = per_run["rate"] / median.where(median > 0)
    return per_run[columns]


def with_clock(df: pd.DataFrame, column: str = "fetched_at", tz: str = AUDIENCE_TZ) -> pd.DataFrame:
    """Adds hour and date columns in UTC and in the audience's time zone (US Eastern by default)."""
    ts = pd.to_datetime(df[column], utc=True)
    local = ts.dt.tz_convert(tz)
    return df.assign(
        hour_utc=ts.dt.hour,
        date_utc=ts.dt.date,
        hour_local=local.dt.hour,
        date_local=local.dt.date,
        weekday_local=local.dt.day_name(),
    )


def by_hour(df: pd.DataFrame, value: str, clock: str = "local") -> pd.DataFrame:
    """Per list and hour of day: mean and median of `value`, with how many fetches and days."""
    hour, date = f"hour_{clock}", f"date_{clock}"
    return (
        df.groupby(["list_id", hour])
        .agg(mean=(value, "mean"), median=(value, "median"), n=(value, "size"), days=(date, "nunique"))
        .reset_index()
        .rename(columns={hour: "hour"})
    )


def hour_effect(df: pd.DataFrame, value: str, clock: str = "local", min_days: int = MIN_DAYS) -> pd.DataFrame | None:
    """Per list, whether hour of day explains `value` beyond each day's own level.

    Fits value ~ C(hour) + C(day) by ordinary least squares and reports the
    F-test that all hour effects are zero, and the hours with the highest and
    lowest estimated effect. Lists with fewer than `min_days` days are
    skipped; returns None when none qualify.
    """
    import statsmodels.formula.api as smf

    hour, date = f"hour_{clock}", f"date_{clock}"
    rows = []
    for name, group in df.dropna(subset=[value]).groupby("list_id"):
        days = group[date].nunique()
        if days < min_days or group[hour].nunique() < 3:
            continue
        data = group.rename(columns={hour: "hour", date: "day"})[[value, "hour", "day"]].astype({"day": str})
        model = smf.ols(f"{value} ~ C(hour) + C(day)", data=data).fit()
        terms = [term for term in model.params.index if term.startswith("C(hour)")]
        test = model.f_test(", ".join(f"{term} = 0" for term in terms))
        effects = pd.Series({int(term.split("T.")[1].rstrip("]")): model.params[term] for term in terms})
        effects[int(data["hour"].min())] = 0.0  # the baseline hour
        rows.append(
            {
                "list_id": name,
                "days": days,
                "n": len(group),
                "f_pvalue": float(test.pvalue),
                "peak_hour": int(effects.idxmax()),
                "low_hour": int(effects.idxmin()),
                "peak_minus_low": float(effects.max() - effects.min()),
            }
        )
    return pd.DataFrame(rows) if rows else None


def coverage(items: pd.DataFrame, tz: str = AUDIENCE_TZ) -> dict:
    """How much data there is: first and last fetch, hours spanned, and days touched in the audience's time zone."""
    ts = pd.to_datetime(items["fetched_at"], utc=True)
    return {
        "first": ts.min(),
        "last": ts.max(),
        "hours": round((ts.max() - ts.min()).total_seconds() / 3600, 1) if len(ts) else 0.0,
        "days_local": int(ts.dt.tz_convert(tz).dt.date.nunique()),
        "fetches": int(items["run_id"].nunique()),
        "rows": len(items),
    }
