"""RQ6 · Echo chambers: what share of each platform's trends appears nowhere else?

Works on stored lists (db.trend_items), before topic snapshots exist. A trend
is one platform's distinct item (url for Bluesky and Hacker News, loose title
elsewhere, as in rhythms), with its first and last sighting.

Two trends on different platforms count as the same story when their titles'
embeddings are at least `threshold` alike and their sightings are no more than
`slack_hours` apart. The embeddings come from the pipeline itself
(scripts/embed-titles.ts): the same filters, text and model, so "the same
story" means what it means on the site. Unlike the pipeline, which matches
items to topic centroids, this compares trend with trend, so it's an upper
bound on how often the pipeline would merge them.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd

from . import rhythms
from .db import REPO_ROOT

DATA_DIR = REPO_ROOT / "research" / "data"
DIMENSIONS = 384


def pipeline_threshold(config: Path = REPO_ROOT / "config" / "ranking.ts") -> float:
    """The pipeline's MATCH_THRESHOLD, read from config/ranking.ts so research never drifts from the site.
    It belongs to the pipeline's embedding model (lib/embed.ts): 0.86 for nomic-embed-text-v1.5 at 384
    numbers (task 2.15), where 0.60 was all-minilm-l6-v2's."""
    match = re.search(r"export const MATCH_THRESHOLD\s*=\s*([0-9.]+)", config.read_text(encoding="utf-8"))
    if not match:
        raise ValueError(f"no MATCH_THRESHOLD in {config}")
    return float(match.group(1))


# The headline threshold is the pipeline's; the sweep brackets it, on the same model's scale.
HEADLINE_THRESHOLD = pipeline_threshold()
THRESHOLDS = tuple(round(HEADLINE_THRESHOLD + step, 2) for step in (-0.08, -0.04, 0, 0.03, 0.06))
SLACK_HOURS = 24.0
RUN_MARGIN = pd.to_timedelta(15, unit="min")  # like the pipeline's RUN_LIST_MARGIN_MS

# A list that describes an earlier period pairs only with lists whose window covers that period.
# TikTok's runs about a week behind (PLAN.md › Predictions and research), so a match with an hourly
# list is the same story a week apart, not at the same time; Pinterest's 30-day window covers
# TikTok's week. The pipeline goes further and doesn't match TikTok at all (UNSCORED_SOURCES).
LAGGED_PARTNERS: dict[str, frozenset[str]] = {"tiktok": frozenset({"pinterest"})}


def pipeline_unscored(config: Path = REPO_ROOT / "config" / "ranking.ts") -> frozenset[str]:
    """The sources the pipeline leaves out of matching and the combined score (UNSCORED_SOURCES)."""
    match = re.search(r"export const UNSCORED_SOURCES[^=]*=\s*new Set\(\[([^\]]*)\]\)", config.read_text(encoding="utf-8"))
    if not match:
        raise ValueError(f"no UNSCORED_SOURCES in {config}")
    return frozenset(re.findall(r"[\"']([a-z_]+)[\"']", match.group(1)))


def may_pair(source: np.ndarray, lagged: dict[str, frozenset[str]] = LAGGED_PARTNERS) -> np.ndarray:
    """Row trend against column trend: True when the two platforms may be matched at all.
    Never a platform with itself, and a lagged list only with its listed partners."""
    allowed = source[:, None] != source[None, :]
    for lagging, partners in lagged.items():
        is_lagging, is_partner = source == lagging, np.isin(source, sorted(partners))
        blocked = is_lagging[:, None] & ~is_partner[None, :]
        allowed &= ~(blocked | blocked.T)
    return allowed


def since_all_present(items: pd.DataFrame) -> pd.DataFrame:
    """The items from the first fetch time by which every source in `items` has a list.

    Sources start on different days; comparing a morning trend with a source
    that had no list yet would count it as appearing nowhere else. One run's
    lists are fetched seconds apart, so the start allows a margin of RUN_MARGIN.
    """
    start = items.groupby("source_id")["fetched_at"].min().max() - RUN_MARGIN
    return items[items["fetched_at"] >= start]


def trends(items: pd.DataFrame) -> pd.DataFrame:
    """One row per platform and distinct item: its latest title, sightings, best rank and fetches seen in,
    and its latest stored match text (None where the lists kept none)."""
    df = rhythms.keyed(items).sort_values("fetched_at")
    grouped = df.groupby(["source_id", "key"], sort=False)
    out = grouped.agg(
        title=("title", "last"),
        first_seen=("fetched_at", "min"),
        last_seen=("fetched_at", "max"),
        best_rank=("rank", "min"),
        fetches=("run_id", "nunique"),
    ).reset_index()
    out.insert(0, "trend_id", [f"t{i}" for i in range(len(out))])
    out["match_text"] = None
    if "match_text" in df:
        stored = df[df["match_text"].map(has_text)].drop_duplicates(["source_id", "key"], keep="last")
        latest = dict(zip(zip(stored["source_id"], stored["key"]), stored["match_text"]))
        out["match_text"] = [latest.get(pair) for pair in zip(out["source_id"], out["key"])]
    return out


def has_text(value) -> bool:
    """True for a stored match text with something in it (not None, NaN or an empty list)."""
    return isinstance(value, (list, tuple, np.ndarray)) and len(value) > 0


def embed_input(trend_table: pd.DataFrame, items: pd.DataFrame | None = None, use_text: bool = True) -> dict:
    """What scripts/embed-titles.ts reads. With `items`, each trend is embedded as in the hour it was first
    seen: that hour's titles decide which hashtag runs stay whole, as they would in that pipeline run.
    A trend's stored match text goes with its title, as in the pipeline; `use_text=False` leaves it out
    (titles only, as every vector was before the lists stored it)."""
    rows = [{"id": t.trend_id, "source": t.source_id, "title": t.title} for t in trend_table.itertuples(index=False)]
    texts = trend_table["match_text"] if use_text and "match_text" in trend_table else [None] * len(rows)
    for row, text in zip(rows, texts):
        if has_text(text):
            row["matchText"] = [str(t) for t in text]
    if items is None:
        return {"rows": rows}
    hours = pd.to_datetime(trend_table["first_seen"], utc=True).dt.floor("h").dt.strftime("%Y-%m-%dT%H")
    for row, hour in zip(rows, hours):
        row["group"] = hour
    by_hour = items.assign(hour=pd.to_datetime(items["fetched_at"], utc=True).dt.floor("h").dt.strftime("%Y-%m-%dT%H"))
    by_hour = by_hour[by_hour["hour"].isin(set(hours))].drop_duplicates(["hour", "source_id", "title"])
    stored = by_hour["match_text"] if use_text and "match_text" in by_hour else pd.Series(None, index=by_hour.index, dtype=object)
    groups: dict[str, list[dict]] = {}
    for hour, source, title, text in zip(by_hour["hour"], by_hour["source_id"], by_hour["title"], stored):
        entry = {"source": source, "title": title}
        if has_text(text):
            entry["matchText"] = [str(t) for t in text]
        groups.setdefault(hour, []).append(entry)
    return {"rows": rows, "groups": groups}


def embed(
    trend_table: pd.DataFrame, name: str = "rq6_titles", segment: bool = True, items: pd.DataFrame | None = None,
    use_text: bool = True,
) -> tuple[pd.DataFrame, np.ndarray]:
    """Runs the pipeline's filters and model on the trends' titles and stored match text
    (scripts/embed-titles.ts); `use_text=False` embeds the titles alone.

    Writes research/data/<name>.json/.f32 (git ignores data/) and returns the
    filter result per trend, plus the kept trends' vectors in row order. Pass
    the stored `items` to embed each trend as in the hour it was first seen.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    source = DATA_DIR / f"{name}_input.json"
    out = DATA_DIR / name
    source.write_text(json.dumps(embed_input(trend_table, items, use_text)), encoding="utf-8")
    npx = shutil.which("npx") or "npx"
    flags = [] if segment else ["--no-segment"]
    subprocess.run([npx, "tsx", "scripts/embed-titles.ts", str(source), str(out), *flags], cwd=REPO_ROOT, check=True)
    return load_vectors(out)


def load_vectors(out: Path) -> tuple[pd.DataFrame, np.ndarray]:
    meta = json.loads(Path(f"{out}.json").read_text(encoding="utf-8"))
    if meta["dimensions"] != DIMENSIONS:
        raise ValueError(f"expected {DIMENSIONS}-number vectors, got {meta['dimensions']}")
    vectors = np.fromfile(f"{out}.f32", dtype="<f4").reshape(-1, DIMENSIONS)
    return pd.DataFrame(meta["rows"]), vectors


def kept_trends(trend_table: pd.DataFrame, filtered: pd.DataFrame, vectors: np.ndarray) -> tuple[pd.DataFrame, np.ndarray]:
    """The trends the filters kept, in the same order as their vectors."""
    kept = filtered[filtered["kept"]].sort_values("index")
    table = trend_table.set_index("trend_id").loc[kept["id"]].reset_index()
    return table, vectors[kept["index"].astype(int).to_numpy()]


def analyze(
    items: pd.DataFrame, name: str, slack_hours: float = SLACK_HOURS, segment: bool = True, use_text: bool = False
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Trends → the pipeline's filters and model → cross-platform matches. Returns the matches and the dropped
    trends.

    Titles alone by default. That treats the days before and after the lists stored match text
    (2026-10-02 18:07 UTC) alike, and it's what the threshold was tuned on. With `use_text=True` a Google
    or Bluesky trend is embedded with its text, as the live pipeline does, and a bare name on another
    platform then falls below the threshold (findings/matching.md): Google–X matches drop from 101 to 5."""
    table = trends(items)
    filtered, vectors = embed(table, name, segment, items, use_text)
    kept, kept_vectors = kept_trends(table, filtered, vectors)
    dropped = filtered[~filtered["kept"]].merge(table, left_on="id", right_on="trend_id")
    return cross_platform(kept, kept_vectors, slack_hours), dropped


def _seconds(times: pd.Series) -> np.ndarray:
    return (pd.to_datetime(times, utc=True) - pd.Timestamp(0, tz="UTC")).dt.total_seconds().to_numpy()


def cross_platform(table: pd.DataFrame, vectors: np.ndarray, slack_hours: float = SLACK_HOURS) -> pd.DataFrame:
    """Per trend: its best similarity to each other platform's trends seen within `slack_hours`.
    A lagged list (TikTok) is compared only with its LAGGED_PARTNERS.

    Returns the trend table with `sim_<platform>` columns (NaN for its own
    platform) and `match_<platform>` columns (that best match's trend_id),
    `best_sim`, and the best match's platform and title.
    """
    platforms = sorted(table["source_id"].unique())
    sims = vectors @ vectors.T
    first, last = _seconds(table["first_seen"]), _seconds(table["last_seen"])
    slack = slack_hours * 3600
    near_in_time = (first[:, None] <= last[None, :] + slack) & (first[None, :] <= last[:, None] + slack)
    source = table["source_id"].to_numpy()
    allowed = near_in_time & may_pair(source)
    masked = np.where(allowed, sims, -np.inf)

    out = table.copy()
    ids = table["trend_id"].to_numpy()
    for platform in platforms:
        columns = np.flatnonzero(source == platform)
        best = masked[:, columns].max(axis=1)
        which = ids[columns[masked[:, columns].argmax(axis=1)]]
        found = np.isfinite(best) & (source != platform)
        out[f"sim_{platform}"] = np.where(found, best, np.nan)
        out[f"match_{platform}"] = np.where(found, which, None)
    best_index = masked.argmax(axis=1)
    best_value = masked[np.arange(len(table)), best_index]
    has_match = np.isfinite(best_value)
    out["best_sim"] = np.where(has_match, best_value, np.nan)
    out["best_platform"] = np.where(has_match, source[best_index], None)
    out["best_title"] = np.where(has_match, table["title"].to_numpy()[best_index], None)
    return out


def echo_shares(cp: pd.DataFrame, thresholds: tuple[float, ...] = THRESHOLDS) -> pd.DataFrame:
    """Per platform and threshold: the share of its trends with no match on any other platform.

    `share` counts each trend once; `share_by_fetches` weights each trend by
    how many fetches it was seen in, i.e. by how long it was on the list.
    """
    rows = []
    for threshold in thresholds:
        alone = ~(cp["best_sim"] >= threshold)
        for platform, group in cp.assign(alone=alone).groupby("source_id"):
            rows.append(
                {
                    "source_id": platform,
                    "threshold": threshold,
                    "trends": len(group),
                    "alone": int(group["alone"].sum()),
                    "share": float(group["alone"].mean()),
                    "share_by_fetches": float((group["alone"] * group["fetches"]).sum() / group["fetches"].sum()),
                }
            )
    return pd.DataFrame(rows)


def reach(cp: pd.DataFrame, threshold: float) -> pd.DataFrame:
    """Per platform: the share of its trends seen on 1, 2, and 3 or more platforms in all (itself included).

    3 or more is the breakout label's bar (PLAN.md › Predictions and research).
    """
    sims = cp[[c for c in cp.columns if c.startswith("sim_")]]
    platforms = 1 + (sims >= threshold).sum(axis=1)
    bucket = platforms.clip(upper=3).map({1: "1", 2: "2", 3: "3+"})
    table = pd.crosstab(cp["source_id"], bucket, normalize="index")
    return table.reindex(columns=["1", "2", "3+"], fill_value=0.0)


def overlap_matrix(cp: pd.DataFrame, threshold: float) -> pd.DataFrame:
    """Row platform A, column platform B: the share of A's trends that have a match on B."""
    platforms = sorted(cp["source_id"].unique())
    matrix = pd.DataFrame(index=platforms, columns=platforms, dtype=float)
    for a, group in cp.groupby("source_id"):
        for b in platforms:
            matrix.loc[a, b] = np.nan if a == b else float((group[f"sim_{b}"] >= threshold).mean())
    return matrix


def near(cp: pd.DataFrame, low: float, high: float, limit: int = 20) -> pd.DataFrame:
    """Best cross-platform pairs with a similarity in [low, high), strongest first, for checking by eye."""
    pairs = cp[(cp["best_sim"] >= low) & (cp["best_sim"] < high)]
    columns = ["source_id", "title", "best_platform", "best_title", "best_sim"]
    return pairs.sort_values("best_sim", ascending=False)[columns].head(limit).reset_index(drop=True)
