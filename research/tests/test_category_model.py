import json

import numpy as np
import pandas as pd
import pytest
from sklearn.linear_model import LogisticRegression

from topnews import category_model as cm
from topnews import llm

T0 = pd.Timestamp("2026-10-01T12:07", tz="UTC")
CENTERS = {"sports": (1, 0, 0), "politics": (0, 1, 0), "tech": (0, 0, 1)}


def clusters(per_class: int = 30, noise: float = 0.15, seed: int = 0):
    """Unit vectors around one center per category, in shuffled time order, with a platform that says nothing."""
    rng = np.random.default_rng(seed)
    labels = np.array([name for name in CENTERS for _ in range(per_class)], dtype=object)
    vectors = np.array([np.array(CENTERS[name]) + rng.normal(0, noise, 3) for name in labels])
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    order = rng.permutation(len(labels))
    sources = np.array(["x", "bluesky"], dtype=object)[np.arange(len(labels)) % 2]
    return vectors[order], sources, labels[order]


def test_it_learns_separable_categories_and_numpy_matches_scikit_learn():
    vectors, sources, labels = clusters()
    model = cm.fit(vectors[:60], sources[:60], labels[:60])
    answers, confidence = cm.predict(model, vectors[60:], sources[60:])
    assert (answers == labels[60:]).mean() > 0.95
    reference = LogisticRegression(C=10.0, max_iter=5000).fit(vectors[:60], labels[:60])
    assert model.classes == tuple(reference.classes_)
    assert cm.probabilities(model, vectors[60:], sources[60:]) == pytest.approx(reference.predict_proba(vectors[60:]))
    assert confidence == pytest.approx(reference.predict_proba(vectors[60:]).max(axis=1))


def test_the_platform_is_an_extra_input_and_an_unseen_one_is_scored_on_the_vector_alone():
    vectors, sources, labels = clusters()
    model = cm.fit(vectors, sources, labels, use_platform=True)
    assert model.platforms == ("bluesky", "x") and model.weights.shape == (3, 3 + 2)
    assert cm.design(vectors[:2], ["x", "reddit"], model.platforms)[:, 3:].tolist() == [[0, 1], [0, 0]]
    answers, _ = cm.predict(model, vectors[:10], ["reddit"] * 10)
    assert (answers == labels[:10]).mean() > 0.9


def test_below_the_threshold_it_answers_unknown():
    vectors, sources, labels = clusters()
    model = cm.with_threshold(cm.fit(vectors, sources, labels), 0.99, note="strict")
    between = np.array([[1.0, 1.0, 0.0]]) / np.sqrt(2)  # halfway between sports and politics
    answers, confidence = cm.predict(model, between, ["x"])
    assert answers.tolist() == [cm.UNKNOWN] and confidence[0] < 0.99
    assert model.meta == {"note": "strict"}


def test_time_split_takes_the_newest_rows_and_keeps_a_moment_on_one_side():
    hours = [0, 1, 2, 3, 4, 5, 6, 7, 7, 7]
    table = pd.DataFrame({"first_seen": [T0 + pd.to_timedelta(h, unit="h") for h in hours]})
    test = cm.time_split(table, test_share=0.2)
    assert test.tolist() == [False] * 7 + [True] * 3  # the three rows of the last hour stay together


def test_out_of_fold_never_trains_on_later_rows(monkeypatch):
    vectors, sources, labels = clusters()
    seen = []
    real_fit = cm.fit

    def spy(v, s, y, **options):
        seen.append(len(y))
        return real_fit(v, s, y, **options)

    monkeypatch.setattr(cm, "fit", spy)
    answers, confidence = cm.out_of_fold(vectors, sources, labels, folds=3)
    assert seen == [30, 60]  # block 2 from block 1, block 3 from blocks 1 and 2
    assert answers[:30].tolist() == [None] * 30 and np.isnan(confidence[:30]).all()
    assert (answers[30:] == labels[30:]).mean() > 0.9


def test_pick_threshold_is_the_lowest_that_reaches_the_target():
    answers = np.array([None, "a", "a", "a", "a"], dtype=object)
    labels = np.array(["a", "a", "b", "a", "a"], dtype=object)
    confidence = np.array([np.nan, 0.9, 0.3, 0.6, 0.8])
    assert cm.pick_threshold(answers, confidence, labels, target=0.75) == 0.0  # 3 of 4 right with every answer
    assert cm.pick_threshold(answers, confidence, labels, target=0.9) == 0.35  # drops the 0.3 answer
    wrong = np.array([None, "b", "b", "b", "b"], dtype=object)
    assert cm.pick_threshold(wrong, confidence, np.array(["a"] * 5, dtype=object)) == 1.0  # never answer


def test_choose_picks_options_and_a_threshold_from_training_rows_and_records_them():
    vectors, sources, labels = clusters(noise=0.6)  # overlapping, so some answers are wrong
    options = ({"c": 0.01, "use_platform": False}, {"c": 10.0, "use_platform": False})
    model = cm.choose(vectors, sources, labels, options, target=0.9)
    assert model.meta["c"] == 10.0 and model.meta["training_trends"] == 90
    assert 0 < model.threshold < 1 and 0.5 < model.meta["out_of_fold_accuracy"] < 1
    answers, _ = cm.predict(model, vectors, sources)
    assert (answers == cm.UNKNOWN).any()  # the overlap is where it declines to answer


def test_score_counts_unknown_as_not_right_but_not_as_an_answer():
    answers = np.array(["a", "b", cm.UNKNOWN, cm.UNKNOWN], dtype=object)
    labels = np.array(["a", "a", "a", "b"], dtype=object)
    assert cm.score(answers, labels) == {"rows": 4, "answered": 0.5, "right_when_answered": 0.5, "right_overall": 0.25}
    groups = cm.by_group(answers, labels, ["x", "x", "x", "reddit"])
    assert groups.index.tolist() == ["x", "reddit"]
    assert groups.loc["x", "rows"] == 3 and np.isnan(groups.loc["reddit", "right_when_answered"])


def test_rolling_pools_blocks_that_were_each_predicted_from_earlier_ones():
    vectors, sources, labels = clusters(noise=0.5)
    by_threshold, by_block = cm.rolling(vectors, sources, labels, folds=3, thresholds=(0.0, 0.9))
    assert by_block["training_trends"].tolist() == [30, 60] and by_block["rows"].tolist() == [30, 30]
    always, strict = by_threshold.iloc[0], by_threshold.iloc[1]
    assert always["rows"] == 60 and always["answered"] == 1.0  # the first block has no earlier data, so it isn't scored
    assert always["right_overall"] == pytest.approx(by_block["right"].mean())
    assert strict["answered"] < 1.0 and strict["right_when_answered"] >= always["right_when_answered"]
    assert by_block["platform_majority"].between(0, 1).all()


def test_baselines_use_training_rows_only():
    train_vectors = np.eye(3)
    train_labels = np.array(["sports", "politics", "politics"], dtype=object)
    result = cm.baselines(
        train_vectors, ["x", "bluesky", "bluesky"], train_labels,
        np.array([[0.9, 0.1, 0.0], [0.0, 0.2, 0.9]]), ["x", "reddit"], np.array(["sports", "tech"], dtype=object),
    )
    assert result == {"platform_majority": 0.5, "nearest_trend": 0.5}  # reddit falls back to the overall majority


def test_the_json_round_trip_scores_the_same():
    vectors, sources, labels = clusters()
    model = cm.with_threshold(cm.fit(vectors, sources, labels, use_platform=True), 0.6, trained_to="2026-10-01")
    again = cm.from_json(cm.to_json(model, decimals=6))
    assert again.classes == model.classes and again.platforms == model.platforms and again.threshold == 0.6
    assert again.meta == {"trained_to": "2026-10-01"}
    assert cm.probabilities(again, vectors, sources) == pytest.approx(cm.probabilities(model, vectors, sources), abs=1e-4)
    assert '"dimensions": 3' in cm.to_json(model)


def test_the_json_puts_what_the_pipeline_reads_beside_the_weights():
    vectors, sources, labels = clusters()
    model = cm.with_threshold(cm.fit(vectors, sources, labels), 0.6, version="c9", embedding={"model": "m"}, c=10.0)
    data = json.loads(cm.to_json(model))
    assert data["version"] == "c9" and data["embedding"] == {"model": "m"} and data["meta"] == {"c": 10.0}
    assert cm.from_json(cm.to_json(model)).meta == model.meta


def test_pipeline_embedding_reads_the_constants_of_lib_embed(tmp_path):
    source = tmp_path / "embed.ts"
    source.write_text(
        'export const EMBEDDING_MODEL = "some/model";\nexport const EMBEDDING_DTYPE = "q8"; // a note\n'
        'export const EMBEDDING_DIMENSIONS = 384;\nexport const EMBEDDING_PREFIX = "clustering: ";\n', encoding="utf-8",
    )
    assert cm.pipeline_embedding(source) == {"model": "some/model", "dtype": "q8", "dimensions": 384, "prefix": "clustering: "}
    assert cm.pipeline_embedding()["dimensions"] == 384  # the real file parses too
    source.write_text("export const EMBEDDING_MODEL = 'x';", encoding="utf-8")
    with pytest.raises(ValueError):
        cm.pipeline_embedding(source)


def test_shipped_model_records_what_it_was_made_from_and_write_scores_the_stored_weights(tmp_path):
    vectors, sources, labels = clusters(noise=0.4)
    table = pd.DataFrame(
        {
            "source_id": sources, "category": labels, "checked": [True, False] * 45, "has_text": [True] * 30 + [False] * 60,
            "first_seen": [T0 + pd.to_timedelta(h, unit="h") for h in range(90)],
        }
    )
    model = cm.shipped(table, vectors, version="c7", options=({"c": 10.0, "use_platform": True},))
    assert model.meta["version"] == "c7" and model.meta["embedding"] == cm.pipeline_embedding()
    assert (model.meta["checked_trends"], model.meta["trends_with_text"], model.meta["training_trends"]) == (45, 30, 90)
    assert (model.meta["first_seen_from"], model.meta["first_seen_to"]) == ("2026-10-01T12:07Z", "2026-10-05T05:07Z")
    stored = cm.write(model, tmp_path / "models" / "category.json", tmp_path / "models" / "category.parity.json")
    parity = json.loads((tmp_path / "models" / "category.parity.json").read_text(encoding="utf-8"))
    assert parity["version"] == "c7" and len(parity["cases"]) == 5
    for case in parity["cases"]:
        vector = np.array([case["vector"]])
        assert np.linalg.norm(vector) == pytest.approx(1, abs=1e-5)
        assert cm.probabilities(stored, vector, [case["source"]])[0] == pytest.approx(case["probabilities"], abs=1e-12)
        answer, confidence = cm.predict(stored, vector, [case["source"]])
        assert case["category"] == (None if answer[0] == cm.UNKNOWN else answer[0]) and case["confidence"] == pytest.approx(confidence[0])
    assert parity["cases"][3]["vector"] == parity["cases"][4]["vector"]  # one input, for a known and an unknown platform
    assert parity["cases"][4]["source"] not in stored.platforms


def test_the_model_the_pipeline_loads_matches_its_parity_cases_and_the_pipeline_s_embedding():
    if not cm.MODEL_FILE.exists():
        pytest.skip("no model shipped yet")
    model = cm.from_json(cm.MODEL_FILE.read_text(encoding="utf-8"))
    assert set(model.classes) <= set(llm.CATEGORIES)
    assert model.meta["embedding"] == cm.pipeline_embedding()  # a new embedding model needs a retrained classifier
    parity = json.loads(cm.PARITY_FILE.read_text(encoding="utf-8"))
    assert parity["version"] == model.meta["version"]
    for case in parity["cases"]:
        proba = cm.probabilities(model, np.array([case["vector"]]), [case["source"]])[0]
        assert proba == pytest.approx(case["probabilities"], abs=1e-12)  # the files were written together


def archived_rows(keys, hours, texts=None):
    return pd.DataFrame(
        {
            "source_id": ["google_trends"] * len(keys), "key": keys, "title": keys,
            "first_seen": [T0 + pd.to_timedelta(h, unit="h") for h in hours],
            "match_text": texts or [["a headline"]] * len(keys), "has_text": [True] * len(keys),
        }
    )


def test_the_archive_keeps_trends_past_the_purge_and_the_newer_row_wins(tmp_path):
    archive = tmp_path / "category_archive"
    assert cm.load_archive(archive) is None
    assert cm.save_archive(archived_rows(["a", "b"], [0, 1]), np.eye(384, dtype="<f4")[:2], archive) == 2
    newer = archived_rows(["b", "c"], [1, 2], [["b again"], None]).assign(has_text=[True, False])
    assert cm.save_archive(newer, np.eye(384, dtype="<f4")[[5, 6]], archive) == 3
    rows, vectors = cm.load_archive(archive)
    assert rows["key"].tolist() == ["a", "b", "c"] and vectors.shape == (3, 384)
    assert vectors[1].argmax() == 5 and rows.loc[1, "match_text"] == ["b again"]  # b's newer row
    assert rows.loc[2, "match_text"] is None and str(rows["first_seen"].dt.tz) == "UTC"


def test_an_archive_from_another_embedding_is_left_out(tmp_path, monkeypatch):
    archive = tmp_path / "category_archive"
    cm.save_archive(archived_rows(["a"], [0]), np.eye(384, dtype="<f4")[:1], archive)
    monkeypatch.setattr(cm, "pipeline_embedding", lambda: {"model": "another", "dimensions": 384})
    assert cm.load_archive(archive) is None


def test_an_archive_from_another_embedding_is_embedded_again_and_nothing_is_lost(tmp_path, monkeypatch):
    archive = tmp_path / "category_archive"
    cm.save_archive(archived_rows(["a", "b"], [0, 1]), np.eye(384, dtype="<f4")[:2], archive)
    monkeypatch.setattr(cm, "pipeline_embedding", lambda: {"model": "another", "dtype": "fp32", "dimensions": 384, "prefix": "x"})
    asked = []

    def fake_embed(trends, name, segment, items, use_text):
        asked.append((name, trends["title"].tolist(), trends["match_text"].tolist()))
        filtered = pd.DataFrame({"id": trends["trend_id"], "kept": [True, False], "index": [0, None]})
        return filtered, np.eye(384, dtype="<f4")[[7]]  # "b" is dropped by today's filters

    monkeypatch.setattr(cm.echo, "embed", fake_embed)
    rows, vectors = cm.load_archive(archive, name="reembed_test")
    assert asked == [("reembed_test", ["a", "b"], [["a headline"], ["a headline"]])]  # titles and texts as archived
    assert rows["key"].tolist() == ["a"] and vectors[0].argmax() == 7
    assert cm.load_archive(archive) is None  # without a name it's still left out
    assert cm.save_archive(archived_rows(["c"], [2]), np.eye(384, dtype="<f4")[[9]], archive, name="reembed_test") == 2
    rows, _ = cm.load_archive(archive)  # written with the new embedding now
    assert rows["key"].tolist() == ["a", "c"]


def test_with_archive_adds_labeled_trends_the_lists_no_longer_hold(tmp_path):
    archive = tmp_path / "category_archive"
    cm.save_archive(archived_rows(["old", "now", "unlabeled"], [0, 5, 1]), np.eye(384, dtype="<f4")[:3], archive)
    labels = pd.DataFrame(
        {"source_id": ["google_trends"] * 2, "key": ["old", "now"], "category": ["sports", "politics"],
         "llm_category": ["sports", "sports"], "checked": [True, False]}
    )
    table = archived_rows(["now"], [5]).assign(category="politics", llm_category="sports", checked=False)
    table = table[["source_id", "key", "title", "first_seen", "match_text", "category", "llm_category", "checked", "has_text"]]
    current = np.eye(384, dtype="<f4")[[9]]
    out, vectors = cm.with_archive(table, current, labels, archive)
    assert out["key"].tolist() == ["old", "now"]  # oldest first; the unlabeled one is left out
    assert out["category"].tolist() == ["sports", "politics"] and out["checked"].tolist() == [True, False]
    assert vectors[0].argmax() == 0 and vectors[1].argmax() == 9  # "now" keeps the vector from the lists


def test_rolling_scores_only_the_rows_it_is_told_to():
    vectors, sources, labels = clusters(noise=0.5)
    scored = np.zeros(len(labels), dtype=bool)
    scored[40:70] = True
    by_threshold, by_block = cm.rolling(vectors, sources, labels, folds=3, thresholds=(0.0,), scored=scored)
    assert by_threshold.iloc[0]["rows"] == 30  # every row trained; 30 were scored
    assert by_block["rows"].tolist() == [30, 30]  # the per-block view still shows every block
