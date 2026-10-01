"""RQ2 · Lead and lag: which platform has a story first, and by how long?

Works on RQ6's cross-platform matches (topnews.echo). For each pair of
matched trends on two platforms, the lead is the gap between their first
sightings. Three things keep a lead honest:

- censoring: a trend already on its list at that source's first fetch
  started at some unknown earlier time, and a sighting from before the other
  source was collected at all can't be compared (that source may have had the
  story too, unseen). Both kinds of pairs are left out;
- slow sources: TikTok, Instagram and Pinterest show up on their refresh
  schedule, not when the story broke, so their pairs are left out by default;
- a threshold that makes matches precise (PAIR_THRESHOLD, the pipeline's),
  because a wrong match gives a meaningless lead.

Fetches are hourly, so leads are good to about an hour, and sightings less
than TIE_HOURS apart are a tie.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .echo import HEADLINE_THRESHOLD, RUN_MARGIN
from .rhythms import SLOW_SOURCES

# The pipeline's threshold: with nomic-embed-text-v1.5 it's already about 95%
# precise on the checked pairs (findings/matching.md), where all-minilm-l6-v2
# needed a stricter 0.70 than its 0.60.
PAIR_THRESHOLD = HEADLINE_THRESHOLD
TIE_HOURS = 0.5
SIDE = ["id", "platform", "title", "first", "censored", "start"]


def source_starts(items: pd.DataFrame) -> pd.Series:
    """Each source's first fetch in the data."""
    return items.groupby("source_id")["fetched_at"].min()


def censored(cp: pd.DataFrame, starts: pd.Series) -> pd.Series:
    """True for trends first seen in their source's first fetch: their real start is unknown."""
    return cp["first_seen"] <= cp["source_id"].map(starts) + RUN_MARGIN


def lead_pairs(cp: pd.DataFrame, starts: pd.Series, threshold: float = PAIR_THRESHOLD) -> pd.DataFrame:
    """One row per matched pair of trends on two platforms (platform_a before platform_b alphabetically).

    lead_hours is platform_b's first sighting minus platform_a's: positive
    when platform_a had it first. `first` names the platform that led, or
    "tie". `censored` and `slow` mark pairs to leave out of the summaries: a
    pair is censored when either trend was at its source's first fetch, or
    when the earlier sighting came before both sources were being collected.
    """
    columns = [
        "id_a", "platform_a", "title_a", "id_b", "platform_b", "title_b", "sim", "first_a", "first_b",
        "lead_hours", "first", "censored_a", "censored_b", "start_a", "start_b", "censored", "slow",
    ]
    by_id = cp.set_index("trend_id")
    is_censored = pd.Series(censored(cp, starts).to_numpy(), index=cp["trend_id"])
    seen: set[tuple[str, str]] = set()
    rows = []
    for column in [c for c in cp.columns if c.startswith("sim_")]:
        platform = column[4:]
        matched = cp[cp[column] >= threshold]
        for a_id, b_id, sim in zip(matched["trend_id"], matched[f"match_{platform}"], matched[column]):
            a, b = by_id.loc[a_id], by_id.loc[b_id]
            if a["source_id"] > b["source_id"]:
                a_id, b_id, a, b = b_id, a_id, b, a
            if (a_id, b_id) in seen:
                continue
            seen.add((a_id, b_id))
            lead = (b["first_seen"] - a["first_seen"]).total_seconds() / 3600
            first = a["source_id"] if lead >= TIE_HOURS else b["source_id"] if lead <= -TIE_HOURS else "tie"
            censored_a, censored_b = bool(is_censored[a_id]), bool(is_censored[b_id])
            start_a, start_b = starts[a["source_id"]], starts[b["source_id"]]
            rows.append(
                [
                    a_id, a["source_id"], a["title"], b_id, b["source_id"], b["title"], float(sim),
                    a["first_seen"], b["first_seen"], lead, _first(a["source_id"], b["source_id"], lead),
                    censored_a, censored_b, start_a, start_b,
                    censored_a or censored_b or _before_both(a["first_seen"], b["first_seen"], start_a, start_b),
                    a["source_id"] in SLOW_SOURCES or b["source_id"] in SLOW_SOURCES,
                ]
            )
    return pd.DataFrame(rows, columns=columns)


def _before_both(first_a, first_b, start_a, start_b) -> bool:
    """True when the earlier sighting came before both sources were being collected."""
    return bool(min(first_a, first_b) <= max(start_a, start_b) + RUN_MARGIN)


def _first(platform_a: str, platform_b: str, lead_hours: float) -> str:
    return platform_a if lead_hours >= TIE_HOURS else platform_b if lead_hours <= -TIE_HOURS else "tie"


def story_pairs(pairs: pd.DataFrame) -> pd.DataFrame:
    """Collapses matched trends into stories and compares each platform's earliest sighting of the story.

    A story is a group of trends linked by matches (for example Google's
    "phillies", "phillies - braves" and "braves vs phillies" with X's
    "Phillies"), so a story with many variants counts once per pair of
    platforms. A platform whose earliest trend in the story is censored is
    censored for that story, and so is a pair whose earlier sighting came before
    both platforms were collected. Same columns as lead_pairs, plus story and label.
    """
    parent: dict[str, str] = {}

    def root(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in zip(pairs["id_a"], pairs["id_b"]):
        parent[root(a)] = root(b)

    sides = pd.concat(
        [
            pairs[["id_a", "platform_a", "title_a", "first_a", "censored_a", "start_a"]].set_axis(SIDE, axis=1),
            pairs[["id_b", "platform_b", "title_b", "first_b", "censored_b", "start_b"]].set_axis(SIDE, axis=1),
        ]
    ).drop_duplicates("id")
    sides["story"] = sides["id"].map(root)
    earliest = sides.sort_values("first").drop_duplicates(["story", "platform"])
    labels = earliest.drop_duplicates("story").set_index("story")["title"]

    rows = []
    for story, group in earliest.groupby("story"):
        platforms = group.sort_values("platform").to_dict("records")
        for i, a in enumerate(platforms):
            for b in platforms[i + 1 :]:
                lead = (b["first"] - a["first"]).total_seconds() / 3600
                rows.append(
                    {
                        "story": story,
                        "label": labels[story],
                        "platform_a": a["platform"],
                        "title_a": a["title"],
                        "platform_b": b["platform"],
                        "title_b": b["title"],
                        "first_a": a["first"],
                        "first_b": b["first"],
                        "lead_hours": lead,
                        "first": _first(a["platform"], b["platform"], lead),
                        "censored": bool(
                            a["censored"] or b["censored"] or _before_both(a["first"], b["first"], a["start"], b["start"])
                        ),
                        "slow": a["platform"] in SLOW_SOURCES or b["platform"] in SLOW_SOURCES,
                    }
                )
    return pd.DataFrame(rows)


def usable(pairs: pd.DataFrame, include_slow: bool = False) -> pd.DataFrame:
    """The pairs whose lead can be read: neither side censored, and no slow source unless asked."""
    keep = ~pairs["censored"] & (include_slow | ~pairs["slow"])
    return pairs[keep]


def pair_summary(pairs: pd.DataFrame) -> pd.DataFrame:
    """Per pair of platforms: how many matched pairs, who led how often, and the median lead (positive: platform_a first)."""
    def summarize(g: pd.DataFrame) -> pd.Series:
        platform_a, platform_b = g.name
        return pd.Series(
            {
                "pairs": len(g),
                "a_first": int((g["first"] == platform_a).sum()),
                "ties": int((g["first"] == "tie").sum()),
                "b_first": int((g["first"] == platform_b).sum()),
                "median_lead_hours": float(g["lead_hours"].median()),
            }
        )

    return pairs.groupby(["platform_a", "platform_b"]).apply(summarize, include_groups=False).reset_index()


def leaders(pairs: pd.DataFrame) -> pd.DataFrame:
    """Per platform, over all its usable pairs: how often it had the story first, tied or came later,
    and its median hours ahead (negative: behind)."""
    a = pairs.assign(platform=pairs["platform_a"], ahead=pairs["lead_hours"])
    b = pairs.assign(platform=pairs["platform_b"], ahead=-pairs["lead_hours"])
    long = pd.concat([a, b])[["platform", "first", "ahead"]]
    return (
        long.groupby("platform")
        .apply(
            lambda g: pd.Series(
                {
                    "pairs": len(g),
                    "first": float((g["first"] == g.name).mean()),
                    "tie": float((g["first"] == "tie").mean()),
                    "later": float(((g["first"] != g.name) & (g["first"] != "tie")).mean()),
                    "median_hours_ahead": float(np.median(g["ahead"])),
                }
            ),
            include_groups=False,
        )
        .sort_values("first", ascending=False)
    )
