"""A local copy of the live topic snapshots and topics, kept before a rebuild replaces them.

    python -m topnews.live_copy            # writes research/data/live_<UTC date>_{snapshots,topics}.pkl (read-only)

A rebuild (`npm run replay -- rebuild`) deletes and rewrites topics, rankings
and snapshots. Rebuilt hours are marked `+replay` and, until a rebuild is shown
to match live exactly, they train models but never score them; so the live
hours are kept here first. Snapshots never include YouTube, and topics are
read without their centroids. Git ignores research/data/.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from . import db

DATA_DIR = db.REPO_ROOT / "research" / "data"


def save(eng, stamp: str, folder: Path = DATA_DIR) -> tuple[Path, Path, pd.DataFrame]:
    """Every live snapshot and topic as two pickles named for `stamp`; returns their paths and the snapshots."""
    snaps, topics = db.snapshots(eng), db.topics(eng)
    folder.mkdir(parents=True, exist_ok=True)
    snaps_path, topics_path = folder / f"live_{stamp}_snapshots.pkl", folder / f"live_{stamp}_topics.pkl"
    snaps.to_pickle(snaps_path)
    topics.to_pickle(topics_path)
    return snaps_path, topics_path, snaps


def load(stamp: str, folder: Path = DATA_DIR) -> tuple[pd.DataFrame, pd.DataFrame]:
    """A saved copy, shaped like db.snapshots and db.topics."""
    return pd.read_pickle(folder / f"live_{stamp}_snapshots.pkl"), pd.read_pickle(folder / f"live_{stamp}_topics.pkl")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m topnews.live_copy", description=__doc__.split("\n\n")[0])
    parser.add_argument("--stamp", default=pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%dT%H%MZ"), help="name of the copy")
    args = parser.parse_args(argv)
    snaps_path, _, snaps = save(db.engine(), args.stamp)
    print(f"saved {len(snaps):,} snapshots ({snaps['taken_at'].min():%Y-%m-%d %H:%M} to {snaps['taken_at'].max():%Y-%m-%d %H:%M} UTC) "
          f"as {snaps_path.name} and its topics")
    print(snaps.groupby("algo_version")["taken_at"].agg(["min", "max", "count"]).to_string())


if __name__ == "__main__":
    main()
