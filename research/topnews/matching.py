"""A checked set of matching pairs, and how well an embedding model separates them.

Topic matching decides every cross-platform label, and RQ6 found it about half
right between 0.60 and 0.70 on the model of the time. This builds a set of trend pairs from different
platforms (each trend's best match on each other platform, from RQ6's
cross_platform), has the local model (topnews.llm) draft "same story?" for
each, and keeps a person's corrections. Any embedding model can then be scored
on the same pairs: how well its similarities separate same from different,
and how precise and complete it is at a given threshold.

The pairs come from public trend titles (no YouTube); the set lives in the
gitignored research/data/, like every other export.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

LOW = 0.75  # on the scale of nomic-embed-text-v1.5, the pipeline's model; the first set used 0.45 on all-minilm-l6-v2's


def candidate_pairs(cp: pd.DataFrame, low: float = LOW) -> pd.DataFrame:
    """Unique pairs of trends on different platforms where one is the other's best match on that platform,
    at similarity `low` or more."""
    titles = cp.set_index("trend_id")[["source_id", "title"]]
    rows = []
    for column in [c for c in cp.columns if c.startswith("sim_")]:
        platform = column[4:]
        matched = cp[cp[column] >= low]
        for a, b, sim in zip(matched["trend_id"], matched[f"match_{platform}"], matched[column]):
            first, second = sorted((a, b))
            rows.append({"id_a": first, "id_b": second, "sim": float(sim)})
    pairs = pd.DataFrame(rows, columns=["id_a", "id_b", "sim"]).drop_duplicates(["id_a", "id_b"]).reset_index(drop=True)
    for side in ("a", "b"):
        pairs[f"platform_{side}"] = pairs[f"id_{side}"].map(titles["source_id"])
        pairs[f"title_{side}"] = pairs[f"id_{side}"].map(titles["title"])
    return pairs.sort_values("sim", ascending=False).reset_index(drop=True)


def final_labels(pairs: pd.DataFrame) -> pd.Series:
    """The checked label per pair: a person's correction where there is one, else the model's draft;
    unknown for pairs the person excluded as too unclear to call."""
    reviewed = pairs["reviewed_same"] if "reviewed_same" in pairs else pd.Series(np.nan, index=pairs.index)
    labels = reviewed.where(reviewed.notna(), pairs["llm_same"]).astype("boolean")
    if "exclude" in pairs:
        labels[pairs["exclude"].fillna(False).astype(bool)] = pd.NA
    return labels


def cosine_pairs(pairs: pd.DataFrame, vectors: dict[str, np.ndarray]) -> pd.Series:
    """Each pair's cosine similarity from a model's unit vectors, keyed by trend id."""
    return pd.Series(
        [float(vectors[a] @ vectors[b]) if a in vectors and b in vectors else np.nan for a, b in zip(pairs["id_a"], pairs["id_b"])],
        index=pairs.index,
    )


def auc(same: pd.Series, sims: pd.Series) -> float:
    """The chance that a random same-story pair scores above a random different pair (1 is perfect, 0.5 is
    chance): how well the model separates them, whatever the threshold."""
    known = same.notna() & sims.notna()
    pos, neg = sims[known & same.fillna(False)].to_numpy(), sims[known & ~same.fillna(True)].to_numpy()
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    greater = (pos[:, None] > neg[None, :]).mean()
    ties = (pos[:, None] == neg[None, :]).mean()
    return float(greater + ties / 2)


def at_thresholds(same: pd.Series, sims: pd.Series, thresholds) -> pd.DataFrame:
    """Precision (share of merges that are right) and recall (share of same-story pairs merged) at each
    threshold."""
    known = same.notna() & sims.notna()
    s, x = same[known].astype(bool), sims[known]
    rows = []
    for t in thresholds:
        merged = x >= t
        hits = int((merged & s).sum())
        rows.append(
            {
                "threshold": t,
                "merged": int(merged.sum()),
                "precision": hits / merged.sum() if merged.sum() else float("nan"),
                "recall": hits / s.sum() if s.sum() else float("nan"),
            }
        )
    return pd.DataFrame(rows)


def best_threshold(same: pd.Series, sims: pd.Series, min_precision: float = 0.9) -> dict:
    """The lowest threshold whose merges are at least `min_precision` right, and its recall: the threshold
    that keeps wrong merges rare while merging as much as it can."""
    grid = np.round(np.arange(0.40, 1.0, 0.01), 2)
    table = at_thresholds(same, sims, grid)
    ok = table[(table["precision"] >= min_precision) & (table["merged"] > 0)]
    if ok.empty:
        return {"threshold": float("nan"), "precision": float("nan"), "recall": float("nan")}
    row = ok.iloc[0]
    return {"threshold": float(row["threshold"]), "precision": float(row["precision"]), "recall": float(row["recall"])}
