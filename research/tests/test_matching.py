import numpy as np
import pandas as pd
import pytest

from topnews import echo, matching

T0 = pd.Timestamp("2026-10-01T12:07", tz="UTC")


def unit(*values):
    v = np.zeros(echo.DIMENSIONS, dtype=np.float32)
    v[: len(values)] = values
    return v / np.linalg.norm(v)


def test_candidate_pairs_are_unique_and_above_the_floor():
    rows = [("google_trends", "astros"), ("x", "Astros"), ("bluesky", "Astros win"), ("twitch", "Minecraft")]
    table = pd.DataFrame(
        [{"trend_id": f"t{i}", "source_id": s, "key": t.lower(), "title": t, "first_seen": T0, "last_seen": T0, "best_rank": 1, "fetches": 1}
         for i, (s, t) in enumerate(rows)]
    )
    cp = echo.cross_platform(table, np.stack([unit(1), unit(1), unit(1, 0.3), unit(0, 1)]))
    pairs = matching.candidate_pairs(cp, low=0.9)
    assert len(pairs) == 3  # astros-Astros, astros-Astros win, Astros-Astros win; each once
    assert pairs["sim"].iloc[0] == pytest.approx(1.0)
    assert set(pairs["platform_a"]) | set(pairs["platform_b"]) == {"google_trends", "x", "bluesky"}


def test_final_labels_prefer_a_persons_correction():
    pairs = pd.DataFrame({"llm_same": [True, False, True], "reviewed_same": [np.nan, True, False]})
    assert matching.final_labels(pairs).tolist() == [True, True, False]
    unclear = pairs.assign(exclude=[True, False, False])
    assert pd.isna(matching.final_labels(unclear)[0])


def test_auc_and_thresholds():
    same = pd.Series([True, True, False, False], dtype="boolean")
    sims = pd.Series([0.9, 0.7, 0.6, 0.3])
    assert matching.auc(same, sims) == 1.0
    assert matching.auc(same, pd.Series([0.3, 0.6, 0.7, 0.9])) == 0.0
    table = matching.at_thresholds(same, sims, [0.5, 0.65]).set_index("threshold")
    assert table.loc[0.5, "precision"] == pytest.approx(2 / 3) and table.loc[0.5, "recall"] == 1.0
    assert table.loc[0.65, "precision"] == 1.0
    best = matching.best_threshold(same, sims, min_precision=0.9)
    assert best["threshold"] == pytest.approx(0.61) and best["recall"] == 1.0


def test_cosine_pairs_from_vectors():
    pairs = pd.DataFrame({"id_a": ["a", "a"], "id_b": ["b", "z"]})
    sims = matching.cosine_pairs(pairs, {"a": unit(1), "b": unit(1, 1)})
    assert sims.iloc[0] == pytest.approx(1 / np.sqrt(2), rel=1e-5)
    assert np.isnan(sims.iloc[1])


def test_containment_reads_words_not_order_or_case():
    assert matching.containment("rick ross", "Rick Ross battery charge") == ("contained", 2)
    assert matching.containment("Phillies force Game 3 in Atlanta", "phillies") == ("contained", 1)
    assert matching.containment("braves vs phillies", "Phillies vs Braves") == ("equal", 3)
    assert matching.containment("yankees", "astros") == ("no", 1)
    assert matching.containment("flores", "floresta") == ("no", 1)  # whole words only
    assert matching.containment("", "astros") == ("no", 0)
