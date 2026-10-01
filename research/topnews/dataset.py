"""5.2 · Dataset: one training table from topic snapshots, one row per topic per hour.

    python -m topnews.dataset                     # production snapshots (read-only)
    python -m topnews.dataset --source replay     # snapshots rebuilt by scripts/replay-snapshots.ts

Rows come from one `algo_version` family (a version with or without
"+replay"), so every row was matched and scored the same way; `is_replay`
marks rebuilt hours, whose `news_count` is always 0.

Features, all known at the row's hour:
- each platform's rank (`rank_<source>`), platform count, position and score,
  and their changes over 1, 3 and 6 hours (`d<k>_…`; ranks and position
  count a climb as positive). A topic missing from an earlier run counts as on
  no platform, with no score; a missing run leaves the change unknown;
- hours since the topic was first seen, the first platform it was seen on,
  hour of day and weekday (US Eastern), `news_count`.

Labels, unknown (NaN) wherever the data can't answer yet:
- `breakout_6h`: reaches 3 or more platforms, or the top 3, within 6 hours.
  Only for rows not broken out already;
- `spread_6h`: a topic on one platform reaches a second within 6 hours (the
  easier label RQ6 suggested). Only for rows on one platform;
- `hours_left_top10`: for rows in the top 10, the hours until the topic last
  appears there, allowing gaps of up to 2 hours (Bluesky flickers, RQ1). When
  that could still go on at the end of the data, it's censored:
  `hours_left_lower` keeps the lower bound.

The top 10 is the snapshot position, which leaves YouTube out: the combined
rankings table's order includes YouTube, which can't feed a permanent model
(PLAN.md › Data model). Google's 3-hour window (task 2.12) and Bluesky's
2-hour grace (2.14) are part of what the site shows, so they're part of the
labels too.

Rows are split by time: the latest 2 weeks are the test set (the latest 30%
while there's less than 6 weeks), and the 6 hours before it are an embargo,
left out of training because their labels look into the test period.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from . import db, rhythms

HORIZON_HOURS = 6
BREAKOUT_PLATFORMS = 3
BREAKOUT_POSITION = 3
SPREAD_PLATFORMS = 2
TOP_N = 10
GAP_HOURS = 2
LAGS = (1, 3, 6)
RUN_TOLERANCE = pd.to_timedelta(30, unit="min")
END_TOLERANCE = pd.to_timedelta(15, unit="min")
TEST_DAYS = 14
EMBARGO_HOURS = HORIZON_HOURS
KEY = ["region", "topic_id", "taken_at"]


def family(version: str) -> str:
    """The algo_version without "+replay": live and rebuilt hours made the same way."""
    return version.removesuffix("+replay")


def load_replay(prefix: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Snapshots and topics written by scripts/replay-snapshots.ts, shaped like db.snapshots and db.topics."""
    snaps = pd.DataFrame(json.loads(Path(f"{prefix}_snapshots.json").read_text(encoding="utf-8")))
    topics = pd.DataFrame(json.loads(Path(f"{prefix}_topics.json").read_text(encoding="utf-8")))
    snaps = snaps.rename(
        columns={
            "takenAt": "taken_at", "topicId": "topic_id", "platformCount": "platform_count",
            "newsCount": "news_count", "algoVersion": "algo_version",
        }
    )
    snaps["taken_at"] = pd.to_datetime(snaps["taken_at"], utc=True)
    snaps = db.expand(db.expand(snaps, "ranks", "rank_"), "metrics", "metric_")
    topics = topics.rename(columns={"firstSeen": "first_seen", "lastSeen": "last_seen"})
    topics["first_seen"] = pd.to_datetime(topics["first_seen"], utc=True)
    return snaps, topics


def select_family(snaps: pd.DataFrame, name: str | None = None) -> tuple[pd.DataFrame, str]:
    """The rows of one algo_version family: `name`, or the family of the newest snapshot."""
    families = snaps["algo_version"].map(family)
    chosen = name or families.iloc[int(snaps["taken_at"].to_numpy().argmax())]
    picked = snaps[families == chosen]
    return picked.assign(is_replay=picked["algo_version"].str.endswith("+replay")), chosen


def _rank_columns(frame: pd.DataFrame) -> list[str]:
    return sorted(c for c in frame.columns if c.startswith("rank_"))


def _lag_times(snaps: pd.DataFrame, hours: float) -> pd.Series:
    """For each row, the time of its region's run nearest to `hours` earlier (within 30 minutes), or NaT."""
    runs = snaps[["region", "taken_at"]].drop_duplicates().sort_values("taken_at").rename(columns={"taken_at": "lag_time"})
    targets = snaps[["region", "taken_at"]].assign(target=snaps["taken_at"] - pd.to_timedelta(hours, unit="h"))
    targets = targets.reset_index().sort_values("target")
    matched = pd.merge_asof(
        targets, runs, left_on="target", right_on="lag_time", by="region", direction="nearest", tolerance=RUN_TOLERANCE
    )
    return matched.set_index("index")["lag_time"].reindex(snaps.index)


def features(snaps: pd.DataFrame, topics: pd.DataFrame) -> pd.DataFrame:
    """The feature columns for every snapshot row (see the module notes)."""
    ranks = _rank_columns(snaps)
    base = snaps.reset_index(drop=True)
    out = base[KEY + ["position", "score", "platform_count", "news_count", "is_replay", *ranks]].copy()
    score_now = base["score"].fillna(0)
    past_columns = ["region", "topic_id", "taken_at", "position", "score", "platform_count", *ranks]
    for k in LAGS:
        lag_time = _lag_times(base, k)
        past = base[["region", "topic_id"]].assign(taken_at=lag_time).merge(base[past_columns], on=KEY, how="left")
        run_exists = lag_time.notna().to_numpy()
        absent = run_exists & past["platform_count"].isna().to_numpy()
        past_count = np.where(absent, 0, past["platform_count"])
        past_score = np.where(absent, 0, past["score"].fillna(0))
        out[f"d{k}_platform_count"] = np.where(run_exists, base["platform_count"] - past_count, np.nan)
        out[f"d{k}_score"] = np.where(run_exists, score_now - past_score, np.nan)
        out[f"d{k}_position"] = past["position"] - base["position"]  # climbing is positive; unknown if either is missing
        for column in ranks:
            out[f"d{k}_{column}"] = past[column] - base[column]
    first_seen = base["topic_id"].map(topics.set_index("id")["first_seen"])
    out["hours_since_first_seen"] = (base["taken_at"] - first_seen).dt.total_seconds() / 3600
    out["first_platform"] = base["topic_id"].map(_first_platforms(base, ranks))
    clocked = rhythms.with_clock(base, column="taken_at")
    out["hour_local"], out["weekday_local"], out["hour_utc"] = clocked["hour_local"], clocked["weekday_local"], clocked["hour_utc"]
    return out


def _first_platforms(snaps: pd.DataFrame, ranks: list[str]) -> pd.Series:
    """Per topic, the platform of its first snapshot, or "several" when it started on more than one."""
    first = snaps.sort_values("taken_at").drop_duplicates("topic_id").set_index("topic_id")[ranks]
    listed = first.notna()
    return listed.apply(lambda row: row.index[row][0][5:] if row.sum() == 1 else "several", axis=1)


def labels(snaps: pd.DataFrame, horizon_hours: float = HORIZON_HOURS, gap_hours: float = GAP_HOURS) -> pd.DataFrame:
    """The label columns for every snapshot row (see the module notes), keyed by region, topic and time."""
    horizon, gap = pd.to_timedelta(horizon_hours, unit="h"), pd.to_timedelta(gap_hours, unit="h")
    rows = []
    for region, by_region in snaps.groupby("region"):
        data_end = by_region["taken_at"].max()
        for topic_id, group in by_region.sort_values("taken_at").groupby("topic_id"):
            times = group["taken_at"].to_numpy()
            counts = group["platform_count"].to_numpy()
            position = group["position"].to_numpy(dtype=float)
            broken = (counts >= BREAKOUT_PLATFORMS) | (position <= BREAKOUT_POSITION)
            in_top = position <= TOP_N
            left, lower, censored = _hours_left(times, in_top, data_end, gap)
            for i, at in enumerate(times):
                window = (times > at) & (times <= at + horizon)
                known = pd.Timestamp(at) + horizon <= data_end + END_TOLERANCE
                breakout = np.nan if broken[i] or not known else float(broken[window].any())
                spread = np.nan if counts[i] != 1 or not known else float((counts[window] >= SPREAD_PLATFORMS).any())
                rows.append(
                    {
                        "region": region, "topic_id": topic_id, "taken_at": pd.Timestamp(at),
                        "broken_out_now": bool(broken[i]), "breakout_6h": breakout, "spread_6h": spread,
                        "in_top10": bool(in_top[i]), "hours_left_top10": left[i],
                        "hours_left_lower": lower[i], "hours_left_censored": censored[i],
                    }
                )
    return pd.DataFrame(rows)


def _hours_left(times: np.ndarray, in_top: np.ndarray, data_end: pd.Timestamp, gap: pd.Timedelta):
    """For each row in the top 10: whole hours until the last top-10 appearance of its run of appearances
    (gaps up to `gap` allowed), counting the current hour; censored when the run could still go on."""
    n = len(times)
    left, lower, censored = np.full(n, np.nan), np.full(n, np.nan), np.full(n, False)
    top = np.flatnonzero(in_top)
    if len(top) == 0:
        return left, lower, censored
    breaks = np.flatnonzero(np.diff(times[top]) > np.timedelta64(gap)) + 1
    for run in np.split(top, breaks):
        last = times[run[-1]]
        open_ended = pd.Timestamp(last) + gap >= data_end - END_TOLERANCE
        for i in run:
            hours = float(round((last - times[i]) / np.timedelta64(1, "h")) + 1)
            lower[i], censored[i] = hours, open_ended
            left[i] = np.nan if open_ended else hours
    return left, lower, censored


def split(table: pd.DataFrame, test_days: float = TEST_DAYS, embargo_hours: float = EMBARGO_HOURS) -> pd.Series:
    """train, embargo or test, by time: the latest `test_days` are the test set (the latest 30% while the
    data spans less than 3 times that), and the `embargo_hours` before it are left out of training."""
    start, end = table["taken_at"].min(), table["taken_at"].max()
    span = end - start
    window = pd.to_timedelta(test_days, unit="D")
    test_start = end - window if span >= 3 * window else start + span * 0.7
    embargo_start = test_start - pd.to_timedelta(embargo_hours, unit="h")
    return pd.Series(
        np.select([table["taken_at"] >= test_start, table["taken_at"] >= embargo_start], ["test", "embargo"], "train"),
        index=table.index,
    )


def build(snaps: pd.DataFrame, topics: pd.DataFrame, family_name: str | None = None) -> tuple[pd.DataFrame, str]:
    """The training table: features and labels for one algo_version family, with a time split."""
    picked, chosen = select_family(snaps, family_name)
    table = features(picked, topics).merge(labels(picked), on=KEY, how="left")
    table = table.sort_values(["taken_at", "region", "topic_id"]).reset_index(drop=True)
    return table.assign(split=split(table)), chosen


def _known(series: pd.Series, how: str) -> float:
    known = series.dropna()
    return float(getattr(known, how)()) if len(known) else float("nan")


def summary(table: pd.DataFrame) -> pd.DataFrame:
    """Rows, topics and label balance per split."""
    def describe(g: pd.DataFrame) -> pd.Series:
        return pd.Series(
            {
                "rows": len(g),
                "topics": g["topic_id"].nunique(),
                "breakout_known": int(g["breakout_6h"].notna().sum()),
                "breakout_rate": _known(g["breakout_6h"], "mean"),
                "spread_known": int(g["spread_6h"].notna().sum()),
                "spread_rate": _known(g["spread_6h"], "mean"),
                "top10_rows": int(g["in_top10"].sum()),
                "hours_left_known": int(g["hours_left_top10"].notna().sum()),
                "hours_left_median": _known(g["hours_left_top10"], "median"),
                "hours_left_censored": int(g["hours_left_censored"].sum()),
            }
        )

    return table.groupby("split").apply(describe, include_groups=False)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m topnews.dataset", description=__doc__.split("\n\n")[0])
    parser.add_argument("--source", choices=["db", "replay"], default="db")
    parser.add_argument("--replay-prefix", default=str(db.REPO_ROOT / "research" / "data" / "replay"))
    parser.add_argument("--family", default=None, help="algo_version family; default: the newest snapshot's")
    parser.add_argument("--out", default=None, help="CSV path; default research/data/dataset_<source>.csv")
    args = parser.parse_args(argv)

    if args.source == "replay":
        snaps, topics = load_replay(Path(args.replay_prefix))
    else:
        engine = db.engine()
        snaps, topics = db.snapshots(engine), db.topics(engine)
    if snaps.empty:
        print("No topic snapshots yet. Try --source replay after npx tsx scripts/replay-snapshots.ts.")
        return
    table, chosen = build(snaps, topics, args.family)
    out = Path(args.out or db.REPO_ROOT / "research" / "data" / f"dataset_{args.source}.csv")
    out.parent.mkdir(parents=True, exist_ok=True)
    table.to_csv(out, index=False)
    print(f"family {chosen}: {len(table):,} rows, {table.topic_id.nunique():,} topics, "
          f"{table.taken_at.min():%Y-%m-%d %H:%M} to {table.taken_at.max():%Y-%m-%d %H:%M} UTC")
    print(summary(table).round(3).to_string())
    print(f"written to {out}")


if __name__ == "__main__":
    main()
