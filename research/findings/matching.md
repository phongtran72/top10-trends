# Topic matching: a checked set of pairs, and a better embedding model

**Status: done (2026-10-01).** This is evidence for task 2.9, the web-app session's decision. Topic matching decides every cross-platform label, so its quality bounds every forecast of breakout, spread and lead time.

## The checked pairs

- **The candidates.** Each trend's best match on every other platform: 228 pairs at similarity 0.45 or more on the pipeline's model (all-MiniLM-L6-v2), plus 26 more that nomic-embed-text-v1.5 rated 0.80 or more. Picking from both models keeps the test from favoring either. The data is stored lists from 2026-09-30 11:32 to 2026-10-01 02:08 UTC, with no YouTube.
- **Drafted by a local model.** Qwen3.5-9B in LM Studio, on this PC's GPU, drafted "same story?" for every pair (`topnews.llm`, about 1 pair a second).
- **Checked one by one.** Every draft was checked by the research assistant (Claude, which also writes these notes), not by the owner. That left 238 labeled pairs (86 same, 152 different), with 16 excluded as too unclear to call. The draft agreed with the check on 88% of pairs. Most of its errors linked things with only a loose connection ("ken paxton" with "#nolanwells", "happy first day of fall" with "#hellooctober").
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

## Shorter vectors

nomic-embed-text-v1.5 was trained so its vectors can be cut short (Matryoshka). You layer-normalize, keep the first numbers and renormalize. On the same pairs:

| Numbers kept | Separation (AUC) | Caught at 90% right | Caught at 95% right | Storage per year (about 44,000 topics) |
| --- | --- | --- | --- | --- |
| 768 | 0.939 | 66% | 66% | 135 MB |
| 512 | 0.940 | 66% | 66% | 90 MB |
| **384** | **0.936** | **66%** | **66%** | **67 MB** |
| 256 | 0.937 | 67% | 57% | 45 MB |
| 128 | 0.927 | 63% | 57% | 22 MB |

At 384 it loses nothing, so topics keep `real[384]` centroids, the same size as today's. 256 and 128 start to lose at the strict end. They could still serve as a compact archive for old topics if storage ever runs short.

## What it means

If the pipeline moved to nomic-embed-text-v1.5, cross-platform topics would merge about twice as often for the same rate of wrong merges. That means more breakouts, spreads and leads seen, and cleaner labels. It's the web-app session's call (task 2.9), because it changes:

- **the model:** `nomic-ai/nomic-embed-text-v1.5`, q8, mean pooling, with `clustering: ` before every text. It's 137 MB in the Actions cache and adds about 3 seconds a run;
- **the centroids:** none, if the vectors are cut to 384 numbers (layer norm, keep the first 384, renormalize), which loses nothing (above);
- **the threshold:** about 0.85 on this set, for 90–95% right merges. That needs confirming on a week with `replay -- tune`;
- **the history:** a new `algo_version` family, and a `replay -- rebuild` to re-embed past hours while the stored lists still cover them (before 2026-10-28).

## A title inside a longer title (2026-10-01)

The first live hour kept "rick ross" (X, Google) and "rick ross battery charge" (Google) as two topics at 0.86. That's a refinement, one title's words all inside the other's, not a short-name error. The checked pairs show whether a rule for it would beat a lower threshold (`matching.containment`, on the pipeline's embedding texts).

**41 of the 230 scored pairs are contained, and 37 of them are the same story.** Their similarities run from 0.81 to 0.97 (median 0.89); 7 of the 37 fall below 0.86 and are missed today.

| Below 0.86, contained | Right | Wrong |
| --- | --- | --- |
| Short title has 2 or more words | 5: "White Sox", "Mike Tomlin", "#truthandreconciliation", "jack smith" twice | 0 |
| Short title is one word | 2: "Mystics", "#flydubai" | 3: "Flores" in "flores amarillas dibujo", "Minecraft" twice |

Rules compared on the 230 pairs (85 the same story):

| Rule | Merged | Right | Wrong | Right merges | Same-story pairs caught |
| --- | --- | --- | --- | --- | --- |
| 0.86 (today) | 60 | 57 | 3 | 95% | 67% |
| 0.86, or contained with 2 or more words in the short title | 65 | 62 | 3 | 95% | 73% |
| 0.86, or contained with any short title | 70 | 64 | 6 | 91% | 75% |
| 0.84 | 74 | 61 | 13 | 82% | 72% |
| 0.82 | 93 | 69 | 24 | 74% | 81% |

- **The containment rule beats lowering the threshold.** With two or more words in the short title it adds 5 right merges and no wrong one. Going to 0.84 adds 4 right and 10 wrong.
- **One-word titles should stay on the threshold alone.** They're where a word means two things ("Flores", "Minecraft").
- **It's 5 pairs from 4 stories,** so it shows the rule is worth a replay test, not that it's safe.
- **Not tested here:**
  - every contained pair in the set is at 0.80 or more, because that's how pairs were picked, so the set can't say whether the rule needs a floor;
  - the pipeline matches an item to a topic's centroid, not to one title. A short two-word name inside many different stories ("jack smith" in each day's Jack Smith story) could chain them into one topic, which a pair test can't show.

## Headlines in the vector split same-name topics (2026-10-04)

The live pipeline embeds a Google trend as its title plus two headlines, and a Bluesky topic as its title plus its description. An X trend is a bare name. So "anthony richardson. Headline. Headline" against "Anthony Richardson" scores about 0.80, under the 0.86 threshold, and the same name becomes two topics. The threshold was tuned on replays, which had titles only until the lists stored match text (2026-10-02 18:07 UTC), so the tuning never saw this.

**In the live snapshots** (79 live hours, r1 to r5, the US view for r5):

| | Topic-hours |
| --- | --- |
| X and Google in one topic | 23 |
| The same name as two topics in one hour, one on X and one on Google | 59 |
| The same in the 28 rebuilt hours, which had titles only | 50 merged, 0 split |

Examples: "Bahrain GP" and "bahrain gp" for six hours on October 4, "Anthony Richardson", "Jeremiah Smith", "Tom Cotton". The web-app session found the same name twice in 11 of 64 combined top 10s.

**Pair against pair** on the lists since the text was stored (51 hours, Google's US feed), the same trends embedded both ways, at 0.86:

| Pair of platforms | Titles only | Title and text |
| --- | --- | --- |
| Google and X | 101 | 5 |
| Bluesky and Google | 13 | 17 |
| Bluesky and X | 10 | 3 |
| Google and Mastodon | 9 | 1 |
| Google and Instagram | 7 | 0 |
| Google and Reddit | 5 | 8 |
| All pairs | 195 | 76 (54 in both) |

The text helps where both sides have words to compare (Bluesky with Google, Google with Reddit's long titles) and hurts where one side is a bare name. The 141 pairs lost sit at a median of 0.80 once the text is in.

**Topic against topic:** four in-memory replays of the same 52 hours (`scripts/replay-snapshots.ts --since … [--titles-only] [--threshold …]`), US view:

| | Live: title and text, 0.86 | Titles only, 0.86 | Titles only, 0.90 | Titles only, 0.93 |
| --- | --- | --- | --- | --- |
| Topics | 985 | 872 | 1,019 | 1,068 |
| Topic-hours on 2 or more platforms | 1.2% | 4.1% | 2.0% | 1.6% |
| X and Google in one topic (topic-hours) | 10 | 103 | 64 | 56 |
| Bluesky and Google | 19 | 13 | 0 | 0 |
| Same-name splits (topic-hours) | 30 | 0 | 0 | 0 |
| Hours with a name twice in the Global top 10 | 5 of 52 | 0 | 0 | 0 |
| Cross-platform member pairs | 93 | 268 | 119 | 74 |
| Of those, the same name on both sides | 15 | 54 | 56 | 56 |

- **Titles only removes every split, and at 0.86 it brings wrong merges back.** Of the 220 member pairs it has and live doesn't, read one by one, 164 are the same story, 52 are not and 4 are unclear: 24% wrong.
- **The wrong ones are chains through a shared word,** which a topic's centroid makes worse than pair matching suggests: "ty france" inside the France–Italy topic; "Índia" pulling in three other matches; "its gameday" joining the Braves, Lions and Packers; surnames ("sean tucker" with "kyle tucker", "nolan wells" with "austin wells").
- **A stricter title threshold fixes most of that and loses the text's gain.** At 0.90, of the pairs read, 79 are right and 6 wrong; but no Bluesky topic joins a Google one, because a sentence and a query never reach 0.90 on titles.
- **What the text adds is nearly all right:** 45 member pairs that titles miss, such as "Plague death reported in Siberia" with "pneumonic plague", and "F1 returns to Sepang" with "bahrain gp", "lewis hamilton" and Reddit's race result.

**So the two kinds of evidence want different rules,** and the recommendation sent to the web-app session is in two steps:
1. Now: an exact-name rule on top of today's vectors. An item joins a topic when its normalized title equals a member's. It removes the splits and the top-10 duplicates and adds no wrong merge.
2. For the review: also join when the title-alone similarity is 0.90 or more, keeping the text comparison at 0.86. That adds about 40 right pairs (a name inside a longer query, such as "eagles game sunday" with "Eagles") for about 6 wrong, and needs a second vector per item.

**The exact-name rule, checked before it ships** (the web-app session's PR #25, replayed in memory over the same hours, 53 by then):

| US view | Without the rule | With it |
| --- | --- | --- |
| Same-name splits (topic-hours) | 31 | 0 |
| Hours with a name twice in the top 10 | 5 | 0 |
| X and Google in one topic (topic-hours) | 10 | 54 |
| Bluesky and Google | 21 | 19 |
| Topics with members from 2 or more sources | 47 | 77 |

- Of the 102 member pairs it adds, 40 have the same name on both sides and all 40 are the same subject. The other 62 come through the topic the item joined; 54 of them are one Formula 1 race, now a single story across five platforms.
- It adds no wrong merge of its own. Four added pairs ride on merges the vectors had already made (two surname ones, two loose ones from Google's headlines).
- The rule runs before the vectors, so it can move an item: 5 pairs disappear, where a Google query used to join a Bluesky story by its headlines and now joins the same name on X.

**For research:** `echo.analyze` embeds titles alone by default, so the research questions treat every day alike and aren't cut down by the same effect. `use_text=True` gives the live pipeline's vectors.

**Limits of this test:** one reader's verdicts (the research assistant's); pairs are counted inside topics, so one chained topic counts several times; 52 hours with a football weekend in them.

## Limits

- 238 pairs from one day, heavy on the MLB playoffs. The differences between the top two models are within noise.
- One reviewer's labels (the research assistant's, not the owner's), drafted by a local model, with fixed rules.
- Pairs that both models miss aren't in the set, so the shares caught are relative, not absolute.
- Titles only: the pipeline also embeds Google's headlines, which this didn't.
