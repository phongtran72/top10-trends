# Topic matching: a checked set of pairs, and a better embedding model

**Status: done (2026-10-01).** This is evidence for task 2.9, the web-app session's decision. Topic matching decides every cross-platform label, so its quality bounds every forecast of breakout, spread and lead time.

## The checked pairs

- **The candidates.** Each trend's best match on every other platform: 228 pairs at similarity 0.45 or more on the pipeline's model (all-MiniLM-L6-v2), plus 26 more that nomic-embed-text-v1.5 rated 0.80 or more. Picking from both models keeps the test from favoring either. The data is stored lists from 2026-09-30 11:32 to 2026-10-01 02:08 UTC, with no YouTube.
- **Drafted by a local model.** Qwen3.5-9B in LM Studio, on this PC's GPU, drafted "same story?" for every pair (`topnews.llm`, about 1 pair a second).
- **Checked by hand.** Every draft was checked, which left 238 labeled pairs (86 same, 152 different), with 16 excluded as too unclear to call. The draft agreed with the check on 88% of pairs. Most of its errors linked things with only a loose connection ("ken paxton" with "#nolanwells", "happy first day of fall" with "#hellooctober").
- **Labeling rules:**
  - the same event, person, team, product or occasion is the same story;
  - a team and its game are the same ("braves" and "phillies - braves");
  - an umbrella event and one of its parts are the same ("mlb playoffs" and a wild-card game);
  - two teams are different, and so are two people with the same surname, or a game and its sequel.
- **Storage.** The set lives in the gitignored `research/data/match_pairs_union.csv`.

## The models

Every model embedded exactly the pipeline's text: titles cleaned by `lib/text.ts`, hashtags split, one title at a time. They ran through Transformers.js on the CPU with 8-bit (q8) weights from Hugging Face, as the pipeline would run them. "Caught at 90% right" is the share of same-story pairs a model still merges at the lowest threshold where at least 90% of its merges are right.

| Model (Hugging Face) | Separation (AUC) | Caught at 90% right | Caught at 95% right | Threshold for 95% | CPU ms per title | Download |
| --- | --- | --- | --- | --- | --- | --- |
| **nomic-ai/nomic-embed-text-v1.5** (`clustering: ` prefix) | **0.94** | 66% | **66%** | 0.85 | 7.9 | 137 MB |
| mixedbread-ai/mxbai-embed-large-v1 | 0.92 | 67% | 62% | 0.74 | 13.1 | 337 MB |
| onnx-community/Qwen3-Embedding-0.6B-ONNX | 0.79 | 60% | 37% | 0.71 | 50.5 | 614 MB |
| Snowflake/snowflake-arctic-embed-m-v2.0 (`query: `) | 0.86 | 50% | 48% | 0.62 | 7.1 | 311 MB |
| Xenova/bge-small-en-v1.5 | 0.88 | 48% | 45% | 0.81 | 1.9 | 34 MB |
| onnx-community/embeddinggemma-300m-ONNX (sentence-similarity prompt) | 0.80 | 37% | 33% | 0.83 | 108.7 | 309 MB |
| **Xenova/all-MiniLM-L6-v2** (the pipeline's, today) | 0.82 | 37% | 36% | 0.74 | 1.0 | 23 MB |

- **The pipeline's model is weak at this.** At 0.60 only 66% of its merges are right and it catches 57% of the same-story pairs. To be 90% right it needs 0.71, and then it catches only 37%.
- **nomic-embed-text-v1.5 catches about twice as many same-story pairs at the same accuracy,** and holds that at 95% right.
  - It's the smallest and fastest of the strong models: about 3 seconds per 400 titles on a CPU.
  - LM Studio's GGUF build of the same model gave the same result (AUC 0.93).
- **mxbai-embed-large is close at 90%** (one pair more), but worse at 95%, two and a half times the size, and 1.7 times slower.
- **EmbeddingGemma did surprisingly badly here,** and was the slowest. Its 8-bit weights on short titles may be the cause. Its full-precision weights (1.2 GB) weren't tried.
- **lightonai/DenseOn (April 2026) has no ONNX weights,** so it wasn't tested.

The losing downloads were deleted after the test. nomic-embed-text-v1.5 stays in the worktree's model cache.

## What it means

If the pipeline moved to nomic-embed-text-v1.5, cross-platform topics would merge about twice as often for the same rate of wrong merges. That means more breakouts, spreads and leads seen, and cleaner labels. It's the web-app session's call (task 2.9), because it changes:

- **the model:** `nomic-ai/nomic-embed-text-v1.5`, q8, mean pooling, with `clustering: ` before every text. It's 137 MB in the Actions cache and adds about 3 seconds a run;
- **the centroids:** 768 numbers instead of 384. `topics.centroid` is `real[384]` in the schema; Postgres doesn't enforce the length, but the docs and tests would change;
- **the threshold:** about 0.85 on this set, for 90–95% right merges. That needs confirming on a week with `replay -- tune`;
- **the history:** a new `algo_version` family, and a `replay -- rebuild` to re-embed past hours while the stored lists still cover them (before 2026-10-28).

## Limits

- 238 pairs from one day, heavy on the MLB playoffs. The differences between the top two models are within noise.
- One person's labels, drafted by a local model, with fixed rules.
- Pairs that both models miss aren't in the set, so the shares caught are relative, not absolute.
- Titles only: the pipeline also embeds Google's headlines, which this didn't.
