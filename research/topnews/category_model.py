"""5.14 · Category as a live feature: a small classifier on the pipeline's title vectors.

The local model's category labels (topnews.categories) need a GPU, and the
pipeline can't call a language model. It does have every title's vector, so
this distills the labels into a logistic regression on that vector (and,
optionally, the platform), small enough to ship as a JSON file that the
TypeScript pipeline scores with one matrix product.

Rules that keep its scores honest:
- trends are split by time (the newest share is the test set), because the
  pipeline will always classify trends newer than anything it was trained on;
- it trains on every label, checked or not, but is scored only on checked
  labels, and against the checked label, not the local model's draft;
- it may answer "unknown". The confidence it needs before answering is chosen
  inside the training period (forward-chaining folds: each block is predicted
  by a model trained only on earlier blocks), never on the test set.

`probabilities` is plain numpy on the stored weights, the same arithmetic the
pipeline would run, and a test holds it equal to scikit-learn's.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

from . import categories, echo

UNKNOWN = "unknown"
TARGET_ACCURACY = 0.85  # where it answers (TASKS.md 5.14's starting targets)
TARGET_ANSWERED = 0.5
TEST_SHARE = 0.3
FOLDS = 5
THRESHOLDS = tuple(round(0.05 * i, 2) for i in range(20))  # 0.00 … 0.95
OPTIONS = tuple({"c": c, "use_platform": platform} for platform in (False, True) for c in (3.0, 10.0, 30.0, 100.0))


@dataclass(frozen=True)
class Model:
    classes: tuple[str, ...]
    platforms: tuple[str, ...]  # the one-hot columns after the vector; empty when the platform isn't used
    weights: np.ndarray  # classes × (vector numbers + platforms)
    bias: np.ndarray
    threshold: float = 0.0  # below this confidence the answer is UNKNOWN
    meta: dict = field(default_factory=dict)


def training_set(items: pd.DataFrame, store=categories.STORE, name: str = "category_model") -> tuple[pd.DataFrame, np.ndarray]:
    """The labeled trends that the pipeline's filters keep, oldest first, with their vectors in row order.
    Columns: source_id, key, title, first_seen, category, llm_category, checked."""
    trends = echo.trends(items)
    filtered, vectors = echo.embed(trends, name, True, items)
    kept, kept_vectors = echo.kept_trends(trends, filtered, vectors)
    labels = categories.final(categories.read(store))[["source_id", "key", "category", "llm_category", "checked"]]
    table = kept.merge(labels, on=["source_id", "key"], how="left")
    labeled = table["category"].notna().to_numpy()
    order = np.argsort(table.loc[labeled, "first_seen"].to_numpy(), kind="stable")
    columns = ["source_id", "key", "title", "first_seen", "category", "llm_category", "checked"]
    out = table.loc[labeled, columns].iloc[order].reset_index(drop=True)
    return out.assign(checked=out["checked"].astype(bool)), kept_vectors[labeled][order]


def time_split(table: pd.DataFrame, test_share: float = TEST_SHARE) -> np.ndarray:
    """True for the newest `test_share` of the rows by first sighting: the test set. Rows first seen at the
    cut's exact time all go to the test set, so no moment is on both sides."""
    times = table["first_seen"].to_numpy()
    cut = np.sort(times)[int(len(times) * (1 - test_share))]
    return times >= cut


def design(vectors: np.ndarray, sources, platforms: tuple[str, ...]) -> np.ndarray:
    """The classifier's inputs: the vector, then one column per platform in `platforms` (1 for the trend's)."""
    if not platforms:
        return np.asarray(vectors, dtype=np.float64)
    sources = np.asarray(sources)
    onehot = np.stack([(sources == p) for p in platforms], axis=1).astype(np.float64)
    return np.hstack([np.asarray(vectors, dtype=np.float64), onehot])


def fit(vectors: np.ndarray, sources, labels, c: float = 10.0, use_platform: bool = False) -> Model:
    """A logistic regression from vectors (and platforms) to categories. A platform unseen in training
    gets no column, so it's scored on the vector alone."""
    platforms = tuple(sorted(set(sources))) if use_platform else ()
    fitted = LogisticRegression(C=c, max_iter=5000).fit(design(vectors, sources, platforms), labels)
    return Model(tuple(str(k) for k in fitted.classes_), platforms, fitted.coef_.copy(), fitted.intercept_.copy())


def probabilities(model: Model, vectors: np.ndarray, sources) -> np.ndarray:
    """Each row's probability per class, in the order of `model.classes`: softmax(inputs · weightsᵀ + bias)."""
    scores = design(vectors, sources, model.platforms) @ model.weights.T + model.bias
    scores -= scores.max(axis=1, keepdims=True)
    exp = np.exp(scores)
    return exp / exp.sum(axis=1, keepdims=True)


def predict(model: Model, vectors: np.ndarray, sources) -> tuple[np.ndarray, np.ndarray]:
    """The most likely category per row and its probability; UNKNOWN where that's below the model's threshold."""
    proba = probabilities(model, vectors, sources)
    confidence = proba.max(axis=1)
    answers = np.array(model.classes, dtype=object)[proba.argmax(axis=1)]
    answers[confidence < model.threshold] = UNKNOWN
    return answers, confidence


def out_of_fold(vectors: np.ndarray, sources, labels, folds: int = FOLDS, **fit_options) -> tuple[np.ndarray, np.ndarray]:
    """Forward-chaining predictions for rows in time order: each block after the first is predicted by a
    model trained only on the blocks before it. The first block gets None and NaN."""
    sources, labels = np.asarray(sources), np.asarray(labels)
    answers = np.full(len(labels), None, dtype=object)
    confidence = np.full(len(labels), np.nan)
    blocks = np.array_split(np.arange(len(labels)), folds)
    for k in range(1, folds):
        past = np.concatenate(blocks[:k])
        model = fit(vectors[past], sources[past], labels[past], **fit_options)
        answers[blocks[k]], confidence[blocks[k]] = predict(model, vectors[blocks[k]], sources[blocks[k]])
    return answers, confidence


def pick_threshold(answers, confidence, labels, target: float = TARGET_ACCURACY) -> float:
    """The lowest confidence at which the answers given are right at least `target` of the time, from
    predictions made out of fold. 1.0 (never answer) when no threshold gets there."""
    answers, confidence, labels = np.asarray(answers), np.asarray(confidence, dtype=float), np.asarray(labels)
    known = ~np.isnan(confidence)
    right = answers[known] == labels[known]
    for threshold in THRESHOLDS:
        answered = confidence[known] >= threshold
        if answered.any() and right[answered].mean() >= target:
            return threshold
    return 1.0


def with_threshold(model: Model, threshold: float, **meta) -> Model:
    return Model(model.classes, model.platforms, model.weights, model.bias, threshold, {**model.meta, **meta})


def choose(vectors: np.ndarray, sources, labels, options=OPTIONS, target: float = TARGET_ACCURACY) -> Model:
    """The model to test, chosen with training rows only (in time order): the options with the best
    out-of-fold accuracy, their threshold for `target`, then a fit on every training row. `meta` records
    the choice."""
    sources, labels = np.asarray(sources), np.asarray(labels)
    best = None
    for option in options:
        answers, confidence = out_of_fold(vectors, sources, labels, **option)
        known = ~np.isnan(confidence)
        accuracy = float((answers[known] == labels[known]).mean())
        if best is None or accuracy > best[0]:
            best = (accuracy, option, answers, confidence)
    accuracy, option, answers, confidence = best
    threshold = pick_threshold(answers, confidence, labels, target)
    model = fit(vectors, sources, labels, **option)
    return with_threshold(model, threshold, **option, out_of_fold_accuracy=round(accuracy, 4), training_trends=int(len(labels)))


def score(answers, labels) -> dict:
    """How many rows it answered, how often those answers were right, and how often it was right over all
    rows (an UNKNOWN counts as not right)."""
    answers, labels = np.asarray(answers), np.asarray(labels)
    answered = answers != UNKNOWN
    right = answers == labels
    return {
        "rows": int(len(labels)),
        "answered": float(answered.mean()) if len(labels) else float("nan"),
        "right_when_answered": float(right[answered].mean()) if answered.any() else float("nan"),
        "right_overall": float(right.mean()) if len(labels) else float("nan"),
    }


def by_group(answers, labels, groups) -> pd.DataFrame:
    """`score` per group (a platform or a checked category), largest group first."""
    frame = pd.DataFrame({"answer": np.asarray(answers), "label": np.asarray(labels), "group": np.asarray(groups)})
    rows = {group: score(part["answer"], part["label"]) for group, part in frame.groupby("group")}
    return pd.DataFrame(rows).T.astype({"rows": int}).sort_values("rows", ascending=False)


def baselines(train_vectors, train_sources, train_labels, test_vectors, test_sources, test_labels) -> dict:
    """Two simple rules to beat on the test rows: each platform's most common category in training (the
    overall most common one for an unseen platform), and the label of the nearest training trend."""
    train_sources, train_labels = np.asarray(train_sources), np.asarray(train_labels)
    counts = pd.Series(train_labels).groupby(train_sources).agg(lambda s: s.value_counts().index[0])
    overall = pd.Series(train_labels).value_counts().index[0]
    majority = np.array([counts.get(s, overall) for s in test_sources], dtype=object)
    nearest = train_labels[(np.asarray(test_vectors) @ np.asarray(train_vectors).T).argmax(axis=1)]
    test_labels = np.asarray(test_labels)
    return {
        "platform_majority": float((majority == test_labels).mean()),
        "nearest_trend": float((nearest == test_labels).mean()),
    }


def learning_curve(train_vectors, train_sources, train_labels, test_vectors, test_sources, test_labels, sizes, **fit_options) -> pd.DataFrame:
    """Accuracy on the test rows (always answering) when training on only the newest `n` training rows."""
    train_sources, train_labels = np.asarray(train_sources), np.asarray(train_labels)
    rows = []
    for n in sizes:
        if n > len(train_labels):
            continue
        model = fit(train_vectors[-n:], train_sources[-n:], train_labels[-n:], **fit_options)
        answers, _ = predict(model, test_vectors, test_sources)
        rows.append({"training_trends": n, "right_overall": score(answers, test_labels)["right_overall"]})
    return pd.DataFrame(rows)


def to_json(model: Model, decimals: int = 4) -> str:
    """The model as the JSON the pipeline would load: classes, platforms, weights, bias, threshold, meta."""
    return json.dumps(
        {
            "classes": list(model.classes),
            "platforms": list(model.platforms),
            "dimensions": int(model.weights.shape[1] - len(model.platforms)),
            "threshold": model.threshold,
            "weights": np.round(model.weights, decimals).tolist(),
            "bias": np.round(model.bias, decimals).tolist(),
            "meta": model.meta,
        }
    )


def from_json(text: str) -> Model:
    data = json.loads(text)
    return Model(
        tuple(data["classes"]), tuple(data["platforms"]), np.array(data["weights"], dtype=np.float64),
        np.array(data["bias"], dtype=np.float64), float(data["threshold"]), data.get("meta", {}),
    )
