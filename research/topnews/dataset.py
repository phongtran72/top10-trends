"""5.2 · Dataset: one training table from topic snapshots, one row per topic per hour.

    python -m topnews.dataset                     # production snapshots (read-only)
    python -m topnews.dataset --view global       # the Global view (default: us, from r5 on)
    python -m topnews.dataset --source replay     # snapshots rebuilt by scripts/replay-snapshots.ts

Rows come from one `algo_version` family (a version with or without
"+replay"), so every row was matched and scored the same way; `is_replay`
marks rebuilt hours, whose `news_count` is always 0. They also come from one
view (the snapshot's `region`): from r5 on (task 3.2) every hour is stored
once for the Global view and once for the US view, with the same topics, so
reading both would count each topic twice. The US view is the default, as the
continuation of the single list before r5; `--view global` builds the other.

Features, all known at the row's hour:
- each platform's rank (`rank_<source>`), platform count, position and score,
  and their changes over 1, 3 and 6 hours (`d<k>_…`; ranks and position
  count a climb as positive). A topic missing from an earlier run counts as on
  no platform, with no score; a missing run leaves the change unknown;
- hours since the topic was first seen, the first platform it was seen on,
  hour of day and weekday (US Eastern), `news_count`;
- `model_category`: the classifier's category (task 5.14), from the first topic
  of the story that has one, once that topic exists. Never Claude's
  `topics.category`, which arrives only when a topic reaches a top 10.

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

Missing runs are gaps, not quiet hours (three so far: 2026-10-05 20:07 and
21:07 UTC, and 2026-10-07 15:07 UTC). A label is known only when every hourly
run it looks at exists: a 6-hour label whose window crosses a gap is unknown,
and a top-10 stay that reaches a gap is censored there, like a stay at the end
of the data. An hour whose run came late (a catch-up run, up to half past the
usual minute) isn't a gap: runs up to 1.75 hours apart follow each other, and
"k hours earlier" is the run within 40 minutes of that time.

From r7 on (the 2026-10-14 03:07 UTC run), a topic takes no new member once
it is 48 hours old, and what arrives next starts a new topic that records the
one it continues (`topics.continues_topic_id`, from the 2026-10-16 02:07 UTC
run; before that, inferred from the same name). The table follows the chain:
a row is a story (`topic_id` is its first topic), and in an hour where two of
its topics are listed, the row takes the better position, the better rank on
each platform and the higher score. So a successor's arrival is neither a new
topic nor a breakout, and a story's stay doesn't end at the age limit. Before
r7 every story is one topic.

Rows are split by time: the latest 2 weeks are the test set (the latest 30%
while there's less than 6 weeks), and the 6 hours before it are an embargo,
left out of training because their labels look into the test period.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import re

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
RUN_TOLERANCE = pd.to_timedelta(40, unit="min")  # a catch-up run is up to 30 minutes off the hour
END_TOLERANCE = pd.to_timedelta(15, unit="min")
# Runs are hourly, and an hour whose run failed can run up to 30 minutes late (the Worker's catch-up
# trigger), 1.5 hours after the run before it. Further apart than this, a run is missing.
MAX_RUN_GAP = pd.to_timedelta(1.75, unit="h")
TEST_DAYS = 14
EMBARGO_HOURS = HORIZON_HOURS
KEY = ["region", "topic_id", "taken_at"]
DEFAULT_VIEW = "us"
R7_START = pd.Timestamp("2026-10-14T03:00Z")  # the first run with the 48-hour age limit (03:07 UTC)
LINKS_FROM = pd.Timestamp("2026-10-16T02:00Z")  # the first run that wrote continues_topic_id (02:07 UTC)
MAX_TOPIC_AGE = pd.to_timedelta(48, unit="h")  # config/ranking.ts MAX_TOPIC_AGE_HOURS


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


def select_view(snaps: pd.DataFrame, view: str | None = None) -> tuple[pd.DataFrame, str]:
    """The rows of one view (`region`): `view`, or the US view when there are several, or the only one."""
    views = sorted(snaps["region"].unique())
    chosen = view or (views[0] if len(views) == 1 else DEFAULT_VIEW)
    if chosen not in views:
        raise ValueError(f"no view {chosen!r} in these snapshots; they hold {views}")
    return snaps[snaps["region"] == chosen], chosen


def name_key(text: str) -> str:
    """Close to lib/text.ts nameKey: lowercase letters and digits only ("#WorldSeries" and "World Series"
    give "worldseries")."""
    return re.sub(r"[\W_]+", "", str(text).lower())


def story_roots(topics: pd.DataFrame) -> pd.Series:
    """For each topic id, the first topic of its story: follow `continues_topic_id` back to a topic that
    continues none. For r7 topics first seen before the column was written, the link is inferred as the
    pipeline makes it by name: the newest topic with the same name that was 48 hours old or more when the
    new one started, and still seen in the 48 hours before. (The pipeline also links by centroid; research
    infers by name only, for those two days.)"""
    ids = topics["id"].to_numpy()
    link = pd.Series(np.nan, index=ids, dtype="float64")
    if "continues_topic_id" in topics:
        link[:] = pd.to_numeric(topics["continues_topic_id"], errors="coerce").to_numpy()
    first = pd.to_datetime(topics["first_seen"], utc=True).dt.tz_localize(None).to_numpy()  # UTC, as datetime64
    last = pd.to_datetime(topics.get("last_seen", topics["first_seen"]), utc=True).dt.tz_localize(None).to_numpy()
    keys = topics["label"].map(name_key).to_numpy() if "label" in topics else np.array([""] * len(topics))
    window = (first >= R7_START.tz_localize(None).to_datetime64()) & (first < LINKS_FROM.tz_localize(None).to_datetime64())
    window &= "label" in topics
    by_key: dict[str, list[int]] = {}
    for i in np.argsort(first, kind="stable"):
        by_key.setdefault(keys[i], []).append(i)
    for i in np.flatnonzero(window & np.isnan(link.to_numpy())):
        start = first[i]
        aged = [
            j for j in by_key.get(keys[i], [])
            if j != i and first[j] <= start - MAX_TOPIC_AGE.to_timedelta64() and last[j] >= start - MAX_TOPIC_AGE.to_timedelta64()
        ]
        if aged:
            link.iloc[i] = ids[max(aged, key=lambda j: first[j])]
    roots = {}
    for topic in ids:
        seen, current = set(), topic
        while not np.isnan(link.get(current, np.nan)) and current not in seen:  # links go to earlier topics
            seen.add(current)
            current = int(link[current])
        roots[topic] = current
    return pd.Series(roots, name="story_id")


def merge_stories(snaps: pd.DataFrame, roots: pd.Series) -> pd.DataFrame:
    """Snapshot rows per story instead of per topic: `topic_id` becomes the story's first topic, and an hour
    where two of its topics are listed becomes one row (best position and rank per platform, highest score,
    platform count over the merged ranks)."""
    ranks = _rank_columns(snaps)
    out = snaps.assign(topic_id=snaps["topic_id"].map(roots).fillna(snaps["topic_id"]).astype(snaps["topic_id"].dtype))
    shared = out.duplicated(KEY, keep=False)
    if not shared.any():
        return out
    alone, together = out[~shared], out[shared]
    how = {"position": "min", "score": "max", "news_count": "max", "platform_count": "max", "algo_version": "first",
           "is_replay": "any", **{c: "min" for c in ranks}}
    how.update({c: "max" for c in together.columns if c.startswith("metric_")})
    how.update({c: "first" for c in together.columns if c not in how and c not in KEY})
    merged = together.groupby(KEY, as_index=False).agg({c: f for c, f in how.items() if c in together.columns})
    merged["platform_count"] = merged[ranks].notna().sum(axis=1) if ranks else merged["platform_count"]
    return pd.concat([alone, merged[together.columns]], ignore_index=True).sort_values(["taken_at", "position"]).reset_index(drop=True)


def story_categories(snaps: pd.DataFrame, topics: pd.DataFrame, roots: pd.Series) -> pd.Series:
    """For each story row (after merge_stories), the classifier's category known at that hour: from the
    earliest topic of the story that has one and was first seen by then. NaN where none is known."""
    if "model_category" not in topics:
        return pd.Series(np.nan, index=snaps.index, dtype=object)
    known = topics[topics["model_category"].notna()].assign(story=lambda f: f["id"].map(roots))
    known = known.assign(first_seen=pd.to_datetime(known["first_seen"], utc=True)).sort_values("first_seen")
    out = pd.Series(np.nan, index=snaps.index, dtype=object)
    for story, members in known.groupby("story"):
        rows = snaps.index[snaps["topic_id"] == story]
        if len(rows) == 0:
            continue
        at = snaps.loc[rows, "taken_at"].to_numpy()
        which = np.searchsorted(members["first_seen"].to_numpy(), at, side="right") - 1
        values = members["model_category"].to_numpy()
        out.loc[rows] = np.where(which >= 0, values[np.maximum(which, 0)], np.nan)
    return out


def _rank_columns(frame: pd.DataFrame) -> list[str]:
    return sorted(c for c in frame.columns if c.startswith("rank_"))


def _lag_times(snaps: pd.DataFrame, hours: float) -> pd.Series:
    """For each row, the time of its region's run nearest to `hours` earlier (within 40 minutes), or NaT."""
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


def stretch_ends(run_times) -> dict:
    """For each run time, the last run of its unbroken stretch: the runs that follow it hour by hour, up to
    the next missing run or the end of the data. What happened after that run wasn't observed."""
    times = sorted(pd.Series(run_times).drop_duplicates())
    ends = {}
    end = None
    for i in range(len(times) - 1, -1, -1):
        if end is None or times[i + 1] - times[i] > MAX_RUN_GAP:
            end = times[i]
        ends[times[i]] = end
    return ends


def labels(snaps: pd.DataFrame, horizon_hours: float = HORIZON_HOURS, gap_hours: float = GAP_HOURS) -> pd.DataFrame:
    """The label columns for every snapshot row (see the module notes), keyed by region, topic and time."""
    horizon, gap = pd.to_timedelta(horizon_hours, unit="h"), pd.to_timedelta(gap_hours, unit="h")
    rows = []
    for region, by_region in snaps.groupby("region"):
        seen_until = stretch_ends(by_region["taken_at"])
        for topic_id, group in by_region.sort_values("taken_at").groupby("topic_id"):
            times = group["taken_at"].to_numpy()
            counts = group["platform_count"].to_numpy()
            position = group["position"].to_numpy(dtype=float)
            broken = (counts >= BREAKOUT_PLATFORMS) | (position <= BREAKOUT_POSITION)
            in_top = position <= TOP_N
            until = [seen_until[t] for t in group["taken_at"]]
            left, lower, censored = _hours_left(times, in_top, until, gap)
            for i, at in enumerate(times):
                window = (times > at) & (times <= at + horizon)
                known = pd.Timestamp(at) + horizon <= until[i] + END_TOLERANCE  # every run in the window exists
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


def _hours_left(times: np.ndarray, in_top: np.ndarray, seen_until: list, gap: pd.Timedelta):
    """For each row in the top 10: whole hours until the last top-10 appearance of its run of appearances
    (gaps up to `gap` allowed), counting the current hour; censored when the run could still go on, which
    is when fewer than `gap` hours were observed after its last appearance (`seen_until`: the last run of
    each row's unbroken stretch of runs)."""
    n = len(times)
    left, lower, censored = np.full(n, np.nan), np.full(n, np.nan), np.full(n, False)
    top = np.flatnonzero(in_top)
    if len(top) == 0:
        return left, lower, censored
    breaks = np.flatnonzero(np.diff(times[top]) > np.timedelta64(gap)) + 1
    for run in np.split(top, breaks):
        last = times[run[-1]]
        open_ended = pd.Timestamp(last) + gap >= seen_until[run[-1]] - END_TOLERANCE
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


def build(
    snaps: pd.DataFrame, topics: pd.DataFrame, family_name: str | None = None, view: str | None = None
) -> tuple[pd.DataFrame, str]:
    """The training table: features and labels for one algo_version family and one view, with a time split.
    The table's `region` column says which view it was built from; `topic_id` is a story's first topic."""
    picked, chosen = select_family(snaps, family_name)
    picked, _ = select_view(picked, view)
    roots = story_roots(topics)
    picked = merge_stories(picked, roots)
    table = features(picked, topics).merge(labels(picked), on=KEY, how="left")
    table["model_category"] = story_categories(table, topics, roots).to_numpy()
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
    parser.add_argument("--view", default=None, help="global or us; default: us when the family has both views")
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
    table, chosen = build(snaps, topics, args.family, args.view)
    out = Path(args.out or db.REPO_ROOT / "research" / "data" / f"dataset_{args.source}.csv")
    out.parent.mkdir(parents=True, exist_ok=True)
    table.to_csv(out, index=False)
    print(f"family {chosen}, view {table.region.iloc[0]}: {len(table):,} rows, {table.topic_id.nunique():,} topics, "
          f"{table.taken_at.min():%Y-%m-%d %H:%M} to {table.taken_at.max():%Y-%m-%d %H:%M} UTC")
    print(summary(table).round(3).to_string())
    print(f"written to {out}")


if __name__ == "__main__":
    main()
