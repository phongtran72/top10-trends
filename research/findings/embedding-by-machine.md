# The pipeline's vectors depend on the machine (2026-10-18 to 2026-10-21)

**Status: found and measured; the fix (the fp32 model) is proposed by the web-app session (2026-10-21).**

## Question

A replay of the stored lists matched the live history on 95 to 97% of topics under r7, not 100%. Why?

## What was compared

A topic seen in a single fetch keeps its one item's vector as its centroid, which the database stores. Embedding that item's stored text again on this PC (`scripts/embed-titles.ts`, the pipeline's filters and model) and comparing gives the live vector against a recomputed one, for the same text. Read-only; vectors stay in `research/data/`.

## Results

**1. Most live vectors aren't the vectors a replay computes** (617 single-item topics, 2026-10-12 to 10-18, 8-bit model): only 27% were identical (to float32 rounding). The rest differed by a cosine of 0.97 to 0.99, at worst 0.90, and it varied by run. Title-only X names differed too, so it isn't the stored text. This, not the second at which the 48-hour limit falls, is most of the replay gap: replaying with the live run's own start times raised the match by 1.4 points (US view) and 2.6 (Global) on one day, and left the other days unchanged.

**2. It follows the machine.** From 2026-10-18 13:07 UTC each hourly run logs its CPU and a probe vector (the web-app session's change). Lined up with 630 single-item topics over 69 runs:

| Probe | Machines that printed it | Runs | Topics | Identical | Runs all / some / none identical |
| --- | --- | --- | --- | --- | --- |
| A (this PC's) | AMD EPYC 9V45 and 9V74, Intel Xeon 8573C and 6973P-C | 29 | 254 | 63% | 2 / 27 / 0 |
| B | AMD EPYC 7763, and some 9V74 machines | 40 | 376 | 0% | 0 / 0 / 40 |

- **B runs take a different 8-bit path.** Every vector moves, by a cosine of 0.02 to 0.07: enough to change which topics merge near 0.86. That fits the u8×s8 kernel saturating on machines without VNNI. The same CPU model printed both probes, so the path follows what the virtual machine exposes, not the model name.
- **A runs are the same kind of path as this PC, but not always bit-identical.** A third of texts differ slightly (cosine 0.990 or more), likely a VNNI kernel of another width or summation order. Small, but it can still flip a pair right at the threshold.

**3. The fp32 model is the same on every machine.** Seven dry runs of the pipeline with fp32 (2026-10-21, nothing written) printed one probe on an EPYC 7763, four 9V74s, a 9V45 and a Xeon 8370C, the same as this PC's fp32 probe. One text only; the wider test is this comparison on live fp32 hours after the switch.

**4. The category classifier barely notices.** On the 443 topics of result 1 whose live vector differs, c1 gave the same answer 93% of the time; the rest were answer-or-not flips near its threshold, and when both answered the category was the same. c2 (the same model on fp32 vectors, `category-model.md`) scores the same as c1.

## What it means

- **Until the switch, live matching near the threshold depends on which machine ran the hour**, and a replay can't match the live history exactly.
- **MATCH_THRESHOLD 0.86 holds for fp32:** the web-app session's replay of 376 stored hours gave totals within 1% of the 8-bit model at 0.86.
- **With fp32 and whole-hour ages (r8), a rebuild should match the live history exactly.** If a check after the switch confirms it, rebuilt hours can score forecast models, not only train them.

## Limits

- One probe text for the fp32 result.
- Single-item topics are mostly Google trends (their text includes headlines), so the sample leans on Google.

<details>
<summary>Per run, 2026-10-18 13:07 to 2026-10-21 10:07 UTC (8-bit model; 10-19 16:00 left out, it had three runs)</summary>

| Run (UTC) | Probe | Topics | Identical | Lowest cosine |
| --- | --- | --- | --- | --- |
| 2026-10-18 13:07 | A | 10 | 7 | 0.993 |
| 2026-10-18 14:07 | A | 10 | 5 | 0.990 |
| 2026-10-18 15:07 | A | 10 | 8 | 0.992 |
| 2026-10-18 16:07 | A | 10 | 7 | 0.990 |
| 2026-10-18 17:07 | B | 10 | 0 | 0.973 |
| 2026-10-18 18:07 | B | 10 | 0 | 0.979 |
| 2026-10-18 19:07 | B | 10 | 0 | 0.978 |
| 2026-10-18 20:07 | B | 10 | 0 | 0.978 |
| 2026-10-18 21:07 | B | 10 | 0 | 0.966 |
| 2026-10-18 22:07 | B | 10 | 0 | 0.980 |
| 2026-10-18 23:07 | B | 10 | 0 | 0.966 |
| 2026-10-19 00:07 | B | 10 | 0 | 0.975 |
| 2026-10-19 01:07 | A | 9 | 7 | 0.992 |
| 2026-10-19 02:07 | B | 8 | 0 | 0.964 |
| 2026-10-19 03:07 | B | 4 | 0 | 0.980 |
| 2026-10-19 04:07 | B | 7 | 0 | 0.972 |
| 2026-10-19 05:07 | A | 2 | 2 | 1.000 |
| 2026-10-19 06:07 | B | 6 | 0 | 0.977 |
| 2026-10-19 07:07 | A | 4 | 3 | 0.996 |
| 2026-10-19 08:07 | A | 6 | 5 | 0.994 |
| 2026-10-19 09:07 | A | 6 | 3 | 0.995 |
| 2026-10-19 10:07 | B | 10 | 0 | 0.977 |
| 2026-10-19 11:07 | B | 10 | 0 | 0.980 |
| 2026-10-19 12:07 | B | 10 | 0 | 0.978 |
| 2026-10-19 13:07 | B | 10 | 0 | 0.979 |
| 2026-10-19 14:07 | A | 10 | 3 | 0.992 |
| 2026-10-19 15:07 | B | 10 | 0 | 0.963 |
| 2026-10-19 17:07 | A | 7 | 5 | 0.994 |
| 2026-10-19 18:07 | A | 10 | 6 | 0.990 |
| 2026-10-19 19:07 | B | 10 | 0 | 0.979 |
| 2026-10-19 20:07 | B | 10 | 0 | 0.966 |
| 2026-10-19 21:07 | B | 10 | 0 | 0.963 |
| 2026-10-19 22:07 | B | 10 | 0 | 0.977 |
| 2026-10-19 23:07 | B | 10 | 0 | 0.960 |
| 2026-10-20 00:07 | A | 10 | 4 | 0.990 |
| 2026-10-20 01:07 | B | 10 | 0 | 0.971 |
| 2026-10-20 02:07 | B | 10 | 0 | 0.982 |
| 2026-10-20 03:07 | A | 10 | 5 | 0.992 |
| 2026-10-20 04:07 | A | 6 | 5 | 0.993 |
| 2026-10-20 05:07 | A | 10 | 5 | 0.993 |
| 2026-10-20 06:07 | A | 10 | 7 | 0.995 |
| 2026-10-20 07:07 | A | 5 | 2 | 0.992 |
| 2026-10-20 08:07 | B | 2 | 0 | 0.981 |
| 2026-10-20 09:07 | A | 9 | 5 | 0.993 |
| 2026-10-20 10:07 | B | 9 | 0 | 0.960 |
| 2026-10-20 11:07 | A | 10 | 6 | 0.991 |
| 2026-10-20 12:07 | A | 10 | 8 | 0.996 |
| 2026-10-20 13:07 | A | 10 | 10 | 1.000 |
| 2026-10-20 14:07 | B | 10 | 0 | 0.964 |
| 2026-10-20 15:07 | B | 10 | 0 | 0.972 |
| 2026-10-20 16:07 | A | 10 | 4 | 0.991 |
| 2026-10-20 17:07 | B | 10 | 0 | 0.977 |
| 2026-10-20 18:07 | A | 10 | 5 | 0.994 |
| 2026-10-20 19:07 | B | 10 | 0 | 0.972 |
| 2026-10-20 20:07 | B | 10 | 0 | 0.979 |
| 2026-10-20 21:07 | B | 10 | 0 | 0.979 |
| 2026-10-20 22:07 | A | 10 | 6 | 0.992 |
| 2026-10-20 23:07 | A | 10 | 9 | 0.994 |
| 2026-10-21 00:07 | A | 10 | 7 | 0.991 |
| 2026-10-21 01:07 | B | 10 | 0 | 0.978 |
| 2026-10-21 02:07 | A | 10 | 7 | 0.992 |
| 2026-10-21 03:07 | B | 10 | 0 | 0.975 |
| 2026-10-21 04:07 | B | 10 | 0 | 0.934 |
| 2026-10-21 05:07 | B | 10 | 0 | 0.981 |
| 2026-10-21 06:07 | B | 10 | 0 | 0.968 |
| 2026-10-21 07:07 | B | 10 | 0 | 0.979 |
| 2026-10-21 08:07 | B | 10 | 0 | 0.968 |
| 2026-10-21 09:07 | A | 10 | 5 | 0.993 |
| 2026-10-21 10:07 | B | 10 | 0 | 0.978 |

</details>
