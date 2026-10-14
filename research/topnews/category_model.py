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
pipeline runs (lib/category-model.ts), and a test holds it equal to
scikit-learn's.

    python -m topnews.category_model          # train the model to ship and write it (reads production, read-only)

That writes `config/models/category.json`, which the pipeline loads, and
`config/models/category.parity.json`: a few made-up inputs with this module's
answers, which the TypeScript scorer's test must reproduce. The pipeline gives
a category only from an item with a stored text (PLAN.md › Who writes a topic's
category); the model itself is trained on every labeled trend, as it was when
it was tested.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

from . import categories, db, echo, llm

UNKNOWN = "unknown"
TARGET_ACCURACY = 0.85  # where it answers (TASKS.md 5.14's starting targets)
TARGET_ANSWERED = 0.5
TEST_SHARE = 0.3
FOLDS = 5
THRESHOLDS = tuple(round(0.05 * i, 2) for i in range(20))  # 0.00 … 0.95
OPTIONS = tuple({"c": c, "use_platform": platform} for platform in (False, True) for c in (3.0, 10.0, 30.0, 100.0))
VERSION = "c1"  # goes in topics.model_category_version; a retrained model takes the next one
MODEL_FILE = db.REPO_ROOT / "config" / "models" / "category.json"
PARITY_FILE = db.REPO_ROOT / "config" / "models" / "category.parity.json"
TOP_LEVEL = ("version", "embedding")  # meta keys the pipeline reads, written beside the weights


@dataclass(frozen=True)
class Model:
    classes: tuple[str, ...]
    platforms: tuple[str, ...]  # the one-hot columns after the vector; empty when the platform isn't used
    weights: np.ndarray  # classes × (vector numbers + platforms)
    bias: np.ndarray
    threshold: float = 0.0  # below this confidence the answer is UNKNOWN
    meta: dict = field(default_factory=dict)


def training_set(
    items: pd.DataFrame, store=categories.STORE, name: str = "category_model", use_text: bool = True,
    only_labeled: bool = False,
) -> tuple[pd.DataFrame, np.ndarray]:
    """The labeled trends that the pipeline's filters keep, oldest first, with their vectors in row order.
    Columns: source_id, key, title, first_seen, category, llm_category, checked, has_text. A vector is made
    from the title and the trend's stored match text, as the pipeline's is; `use_text=False` uses the title
    alone. The filters read the text too, so the two settings can keep slightly different trends.
    `only_labeled` embeds the labeled trends alone, which is all a fit needs and a third of the work."""
    trends = echo.trends(items)
    labels = categories.final(categories.read(store))[["source_id", "key", "category", "llm_category", "checked"]]
    if only_labeled:
        trends = trends.merge(labels[["source_id", "key"]], on=["source_id", "key"])
    filtered, vectors = echo.embed(trends, name, True, items, use_text)
    kept, kept_vectors = echo.kept_trends(trends, filtered, vectors)
    table = kept.merge(labels, on=["source_id", "key"], how="left")
    labeled = table["category"].notna().to_numpy()
    order = np.argsort(table.loc[labeled, "first_seen"].to_numpy(), kind="stable")
    table["has_text"] = table["match_text"].map(echo.has_text)
    columns = ["source_id", "key", "title", "first_seen", "category", "llm_category", "checked", "has_text"]
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


def rolling(
    vectors: np.ndarray, sources, labels, folds: int = 10, thresholds=(0.0, 0.6, 0.7, 0.8, 0.9), scored=None,
    **fit_options,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """A steadier score than one split, for rows in time order: every block after the first is predicted by
    a model trained on the blocks before it, and the predictions are pooled.

    One split's score swings with what its test hours happened to hold (a football night is easy). Returns
    the pooled score per threshold, and per block the share right when always answering beside the
    platform-majority baseline, to show that swing. Every row trains; `scored` (a mask) limits which rows
    count in the pooled score, for example to checked labels.
    """
    sources, labels = np.asarray(sources), np.asarray(labels)
    answers, confidence = out_of_fold(vectors, sources, labels, folds=folds, **fit_options)
    known = ~np.isnan(confidence)
    if scored is not None:
        known &= np.asarray(scored, dtype=bool)
    by_threshold = []
    for threshold in thresholds:
        gated = np.where(confidence[known] >= threshold, answers[known], UNKNOWN)
        by_threshold.append({"threshold": threshold, **score(gated, labels[known])})
    blocks = np.array_split(np.arange(len(labels)), folds)
    by_block = []
    for k in range(1, folds):
        past, block = np.concatenate(blocks[:k]), blocks[k]
        simple = baselines(vectors[past], sources[past], labels[past], vectors[block], sources[block], labels[block])
        by_block.append(
            {
                "block": k, "training_trends": int(len(past)), "rows": int(len(block)),
                "right": float((answers[block] == labels[block]).mean()), "platform_majority": simple["platform_majority"],
            }
        )
    return pd.DataFrame(by_threshold), pd.DataFrame(by_block)


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
    """The model as the JSON the pipeline loads: classes, platforms, weights, bias, threshold, meta, and
    the meta keys the pipeline reads (`version`, `embedding`) beside them."""
    return json.dumps(
        {
            **{key: model.meta[key] for key in TOP_LEVEL if key in model.meta},
            "classes": list(model.classes),
            "platforms": list(model.platforms),
            "dimensions": int(model.weights.shape[1] - len(model.platforms)),
            "threshold": model.threshold,
            "weights": np.round(model.weights, decimals).tolist(),
            "bias": np.round(model.bias, decimals).tolist(),
            "meta": {key: value for key, value in model.meta.items() if key not in TOP_LEVEL},
        }
    )


def from_json(text: str) -> Model:
    data = json.loads(text)
    meta = {**{key: data[key] for key in TOP_LEVEL if key in data}, **data.get("meta", {})}
    return Model(
        tuple(data["classes"]), tuple(data["platforms"]), np.array(data["weights"], dtype=np.float64),
        np.array(data["bias"], dtype=np.float64), float(data["threshold"]), meta,
    )


def pipeline_embedding(source: Path = db.REPO_ROOT / "lib" / "embed.ts") -> dict:
    """The embedding the pipeline makes its vectors with, read from lib/embed.ts. A classifier belongs to
    the vectors it was trained on, so the model file records this and the pipeline refuses a mismatch."""
    text = source.read_text(encoding="utf-8")

    def constant(name: str) -> str:
        match = re.search(rf"export const {name} = ([^;]+);", text)
        if not match:
            raise ValueError(f"{name} not found in {source}")
        return match.group(1).strip()

    return {
        "model": json.loads(constant("EMBEDDING_MODEL")),
        "dtype": json.loads(constant("EMBEDDING_DTYPE")),
        "dimensions": int(constant("EMBEDDING_DIMENSIONS")),
        "prefix": json.loads(constant("EMBEDDING_PREFIX")),
    }


def shipped(table: pd.DataFrame, vectors: np.ndarray, version: str = VERSION, options=OPTIONS) -> Model:
    """The model to ship, from every labeled trend (`training_set`'s table and vectors): `choose` picks the
    options and the threshold from forward-chaining folds over them, then fits on all of them. `meta`
    records what it was made from."""
    model = choose(vectors, table["source_id"].to_numpy(), table["category"].to_numpy(), options)
    return with_threshold(
        model, model.threshold, version=version, embedding=pipeline_embedding(),
        checked_trends=int(table["checked"].sum()), trends_with_text=int(table["has_text"].sum()),
        first_seen_from=table["first_seen"].min().strftime("%Y-%m-%dT%H:%MZ"),
        first_seen_to=table["first_seen"].max().strftime("%Y-%m-%dT%H:%MZ"),
    )


def parity_cases(model: Model, seed: int = 0, decimals: int = 6) -> list[dict]:
    """Five made-up inputs with the model's answers, for the TypeScript scorer's test. No stored trend is
    in them: two point along a category's own weights (so the model is sure), one lies between two
    categories, and one is random, scored once for a platform the model knows and once for one it doesn't."""
    width = model.weights.shape[1] - len(model.platforms)
    directions = model.weights[:, :width] - model.weights[:, :width].mean(axis=0)
    strongest = np.argsort(-np.linalg.norm(directions, axis=1))
    random = np.random.default_rng(seed).normal(size=width)
    known = model.platforms[0] if model.platforms else "google_trends"
    made = [
        (known, directions[strongest[0]]),
        ("bluesky", directions[strongest[1]]),
        (known, directions[strongest[0]] / np.linalg.norm(directions[strongest[0]])
         + directions[strongest[1]] / np.linalg.norm(directions[strongest[1]])),
        (known, random),
        ("a-platform-it-never-saw", random),
    ]
    cases = []
    for source, vector in made:
        vector = np.round(vector / np.linalg.norm(vector), decimals)
        answers, confidence = predict(model, vector[None, :], [source])
        cases.append(
            {
                "source": source,
                "vector": vector.tolist(),
                "probabilities": probabilities(model, vector[None, :], [source])[0].tolist(),
                "category": None if answers[0] == UNKNOWN else str(answers[0]),
                "confidence": float(confidence[0]),
            }
        )
    return cases


def write(model: Model, model_file: Path = MODEL_FILE, parity_file: Path = PARITY_FILE) -> Model:
    """Writes the model file and its parity cases. The cases are scored by the model as the file holds it
    (rounded weights), which is the model the pipeline runs; returns that model."""
    model_file.parent.mkdir(parents=True, exist_ok=True)
    model_file.write_text(to_json(model) + "\n", encoding="utf-8", newline="\n")
    stored = from_json(model_file.read_text(encoding="utf-8"))
    parity = {"version": stored.meta.get("version"), "cases": parity_cases(stored)}
    parity_file.write_text(json.dumps(parity) + "\n", encoding="utf-8", newline="\n")
    return stored


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the category model the pipeline loads and write it.")
    parser.add_argument("--days", type=float, default=28, help="how far back to read stored lists")
    parser.add_argument("--version", default=VERSION)
    parser.add_argument("--name", default="category_ship", help="name of the vector files under research/data/")
    args = parser.parse_args()
    items = db.trend_items(db.engine(), days=args.days)
    table, vectors = training_set(items, name=args.name, only_labeled=True)
    unknown = set(table["category"]) - set(llm.CATEGORIES)
    if unknown:
        raise ValueError(f"labels outside the research categories: {sorted(unknown)}")
    stored = write(shipped(table, vectors, args.version))
    sources, labels = table["source_id"].to_numpy(), table["category"].to_numpy()
    checked, has_text = table["checked"].to_numpy(), table["has_text"].to_numpy()
    print(f"{len(table)} labeled trends ({int(checked.sum())} checked, {int(has_text.sum())} with a stored text)")
    print("model:", {key: value for key, value in stored.meta.items() if key != "embedding"}, "threshold", stored.threshold)
    print("platforms:", list(stored.platforms), "classes:", len(stored.classes))
    fit_options = {"c": stored.meta["c"], "use_platform": stored.meta["use_platform"]}
    for name, scored in (("checked", checked), ("checked, with a stored text", checked & has_text)):
        by_threshold, _ = rolling(vectors, sources, labels, thresholds=(0.0, stored.threshold), scored=scored, **fit_options)
        print(f"rolling score, {name}:")
        print(by_threshold.round(3).to_string(index=False))
    print("parity cases:", [(case["source"], case["category"], round(case["confidence"], 3)) for case in stored_cases()])
    print(f"wrote {MODEL_FILE.relative_to(db.REPO_ROOT)} and {PARITY_FILE.relative_to(db.REPO_ROOT)}")


def stored_cases(parity_file: Path = PARITY_FILE) -> list[dict]:
    return json.loads(parity_file.read_text(encoding="utf-8"))["cases"]


if __name__ == "__main__":
    main()
