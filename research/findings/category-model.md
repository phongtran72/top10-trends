# Category as a live feature (task 5.14)

**Status: with the stored match text the targets are met on Google and Bluesky trends, on two and a half days of them; not shipped (2026-10-04).** The classifier isn't shipped to the pipeline. It needs more labeled trends, which come as the stored lists grow.
- Re-run `notebooks/09_category_model.ipynb` after each new batch of labels, and compare runs on its rolling score, not on the single split.
- Ship it (task 5.14, step 3) only once it meets the targets below.

## Question

A topic's category predicts how it spreads and how long it lasts (`findings/categories.md`), but only the local model on the owner's GPU can label it, and the pipeline can't call a language model. Can a small classifier on the title vectors the pipeline already computes give the same category, well enough to be a live feature?

## Data

- 959 labeled trends that the pipeline's filters keep, first seen from 2026-09-30 11:32 to 2026-10-01 20:08 UTC, on ten lists (no YouTube).
- Every label is checked: the local model (Qwen3.5-9B) drafted it, and the research assistant (Claude, not the owner) checked it. The check corrected 16% of the drafts.
- Each trend's vector comes from the pipeline's own filters, text and model (`scripts/embed-titles.ts`): nomic-embed-text-v1.5, 384 numbers.

## Method

`topnews.category_model`, tested in `tests/test_category_model.py`.

- **Split by time.** The newest 30% of trends by first sighting are the test set (288 trends, from 12:08 UTC on October 1); the other 671 train. The pipeline will always classify trends newer than its training data.
- **The classifier** is a logistic regression from the vector to one of the 14 categories, with or without the platform as an extra input.
- **It may answer "unknown".** It answers only when its top probability reaches a threshold.
- **Nothing is tuned on the test set.** The options and the threshold are chosen inside the training period: each block of training trends is predicted by a model trained only on earlier blocks, and the threshold is the lowest one whose answers were right 85% of the time there.
- **Scored against the checked label,** never the local model's draft.
- **Targets** (starting values, TASKS.md 5.14): right on at least 85% of what it answers, and an answer for at least half of the trends.

## Result

On the 288 test trends:

| Method | Right |
| --- | --- |
| Each platform's most common category | 31% |
| The nearest labeled trend's category | 38% |
| Classifier, always answering | 53% |
| The local model's draft, as the ceiling | 81% |

At the threshold chosen in training (0.75), with the platform as an input:

| | Target | Now |
| --- | --- | --- |
| Right, of the trends it answers | 85% | 83% |
| Trends it answers | 50% | 37% |

- **It beats both simple rules, and it's well short of the local model.** The vector alone says a lot less than the title plus its context does to a language model.
- **Accuracy and coverage trade off.** At 0.5 it answers 58% and is right on 68%; at 0.9 it answers 23% and is right on 88%.
- **It's good where the words name the subject:**

| Checked category | Test trends | Right, always answering | Answered at 0.75 | Right, of those |
| --- | --- | --- | --- | --- |
| sports | 42 | 79% | 57% | 96% |
| tech | 34 | 85% | 65% | 91% |
| politics | 34 | 65% | 50% | 94% |
| entertainment | 37 | 54% | 46% | 82% |
| gaming | 17 | 65% | 41% | 100% |
| calendar | 23 | 43% | 17% | 75% |
| other | 43 | 35% | 2% | 0% |
| incident | 18 | 22% | 22% | 0% |

- **By platform,** always answering: Bluesky 88% and Hacker News 85% (full sentences), Google 58%, X 43% (bare names), Reddit 32% (titles that say little).
- **"Other" mostly gets no answer, which is right.** It answers 2% of them. Leaving "other" out of the classes, so that it means the same as unknown, was tried and was worse (79% right at the same threshold).
- **Incidents are the real miss:** it answers 22% of them and none rightly. They're named by a place or a person ("emirates", "amber guyger"), and the event is only in the article.
- **More labels help, slowly.** Training on the newest n trends: 40% right with 65, 44% with 260, 52% with 520, 53% with 671. That's about 2 points per 150 trends at the end.

## Re-run with 127 more labels (2026-10-02)

1,072 labeled trends that the filters keep, first seen up to 2026-10-02 00:08 UTC: 747 train, and the newest 325 test (from 14:08 UTC on October 1). The test set moved with the data, so compare with the first run loosely.

| | Target | First run (959) | Now (1,072) |
| --- | --- | --- | --- |
| Right, always answering | | 53% | 56% |
| Each platform's most common category | | 31% | 43% |
| Threshold chosen in training | | 0.75 | 0.80 |
| Right, of the trends it answers | 85% | 83% | 90% |
| Trends it answers | 50% | 37% | 35% |

- **Its answers are now right often enough; it still answers too few.** At a threshold of 0.6 it would answer 50% and be right on 82%, so the two targets aren't met together yet.
- **The simple rule got stronger too.** With Reddit now in training, each platform's most common category is right 43% of the time, so the classifier's lead over it is 13 points, down from 22.
- **By platform at its threshold:** Bluesky answers 80% and all rightly; Hacker News 51%, all rightly; Google 39% (83% right); X 23% (86%); Reddit 16% (89%).
- **The learning curve is noisy at this size:** 55% right with 520 training trends, 58% with 650, 56% with 747.

## A steadier score, and a third run (2026-10-02, data to 03:08 UTC)

1,148 labeled trends that the filters keep (84 more).

**One split's score swings with its test hours.** On the newest 30% this run, the classifier was right 67% of the time when always answering, up from 56% two hours of data earlier. Most of that is the test period, not the model: it now ends on a Thursday Night Football evening, full of player names on X and Google, and each platform's most common category alone was right 50% of the time there (43% before).

**So runs are now compared on a rolling score** (`category_model.rolling`): every tenth of the trends, in time order, is predicted by a model trained only on the tenths before it, and the predictions are pooled (1,033 trends).

| Threshold | Trends it answers | Right, of those |
| --- | --- | --- |
| none | 100% | 59% |
| 0.6 | 56% | 79% |
| 0.7 | 47% | 83% |
| 0.8 | 38% | 86% |
| 0.9 | 25% | 91% |

- **Against the targets (85% right, 50% answered):** at 0.8 it's right often enough and answers 38%; at 0.7 it answers 47% and is right on 83%. It's close on each and not there on both.
- **Block by block it's right 39% to 69% of the time,** and each platform's most common category 21% to 61%. The classifier leads that simple rule by 15 points on average, in every block.
- **The single split, for the record:** at the threshold chosen in training (0.9) it answers 43% of the newest 347 trends and is right on 91%.

## Fourth run: more labels stopped helping (2026-10-02, data to 17:08 UTC)

1,468 labeled trends that the filters keep (320 more), every one checked. On the rolling score (1,321 trends predicted):

| Threshold | Trends it answers | Right, of those | At 1,148 trends |
| --- | --- | --- | --- |
| none | 100% | 57% | 59% |
| 0.7 | 46% | 83% | 47%, 83% |
| 0.8 | 37% | 86% | 38%, 86% |
| 0.9 | 25% | 90% | 25%, 91% |

- **The score didn't move with 28% more labels.** Block by block there's no climb either: the tenths are right 46% to 68% of the time whether 300 or 1,300 trends came before them. More labels of the same kind won't reach the targets.
- **It leads each platform's most common category by 16 points,** in every block.
- **It knows five categories and guesses at the rest.** At 0.8:

| Checked category | Trends | Answered | Right, of those |
| --- | --- | --- | --- |
| tech | 127 | 59% | 97% |
| gaming | 79 | 62% | 96% |
| calendar | 82 | 32% | 96% |
| sports | 321 | 53% | 94% |
| politics | 135 | 44% | 93% |
| entertainment | 185 | 26% | 67% |
| other | 160 | 16% | 60% |
| business | 48 | 21% | 40% |
| incident | 47 | 11% | 20% |

- **Limiting it to those five** (answer only when it says sports, politics, tech, gaming or calendar): at 0.7 it answers 36% of all trends and is right on 87%, and it catches 55% of the trends that are in those categories. That's the fallback if nothing better turns up.
- **By platform at 0.8:** Twitch answers 98% (94% right), Hacker News 59% (88%), Bluesky 54% (93%), Google 36% (82%), X 29% (77%), Reddit 23% (85%). TikTok and Pinterest get almost no answers: their hashtags and searches look like nothing in the hourly lists.

**The next lever is the text, not the labels.** From the 2026-10-02 18:07 UTC run the pipeline stores each Google trend's headlines and each Bluesky topic's description (`trend_items.match_text`, migration 0005). The live pipeline embeds that text with the title, and until now research could only embed the title. The next run compares, on the same new trends, vectors from the title alone with vectors from the title and its stored text. Google is where the gap should close: its bare queries ("lito", "drake", "detention") are named by their headlines.

## The stored text works where there is text (2026-10-04, data to 02:08 UTC)

The lists have stored each Google trend's headlines and each Bluesky topic's description since the 2026-10-02 18:07 UTC run (`trend_items.match_text`). Research now embeds a trend as the pipeline does, the title with up to two of those texts (`echo.embed`), and can still embed the title alone (`use_text=False`).

**The test:** the same 2,415 labeled trends embedded both ways, scored on the rolling score. 389 of them have a stored text. Of the 1,173 trends new since the last run, the 345 from Google and Bluesky are checked (31 corrected, 91% agreed, the local model's best yet, because it now reads the real headlines). The other 828 are unchecked drafts: they train both versions and score neither.

On the 341 scored trends that have a text (248 Google, 93 Bluesky):

| Vectors from | Right, always answering | Answers at 0.7 | Right, of those |
| --- | --- | --- | --- |
| The title alone | 71% | 64% | 87% |
| The title and its text | **82%** | **76%** | **93%** |

- **The text fixed 53 trends and broke 15** (sign test p < 0.001). It names what a bare query is: "robot" (robot umpires) went from tech to sports, "benny johnson" and "samuel alito" to politics, "nicole linton" to incident, "bruce willis" and "doing life" to entertainment.
- **Both targets are met on these trends** (85% right, 50% answered): at 0.7 it answers 76% and is right on 93%.
- **Google gains most:** 71% to 84% right when always answering; at 0.7 it answers 79% and is right on 94%. Bluesky, whose titles are already sentences, goes from 71% to 77%.
- **Trends without a text don't change:** 55% right either way (1,174 trends: X, Reddit, Mastodon and the rest, and everything before October 2).
- **Over every checked trend** (1,515): 58% to 61% right; at 0.7 it answers 50% and is right on 85%, which is the two targets exactly, carried by the trends with text.
- **By category at 0.7, trends with text:** sports 85% answered and 97% right, politics 83% and 96%, entertainment 82% and 95%. Entertainment was the weak one on titles (67% right). Incidents are answered 32% of the time, all rightly; business is still poor (57% right of 12).

**What it means for shipping.** The pipeline would classify a topic from its lead items, and Google's and Bluesky's carry a text. So a topic that Google or Bluesky lists would get a category about three times in four, rightly 93% of the time; a topic only on X or Mastodon would mostly stay unknown, as it would today. That's enough to try category as a feature (step 4), once it holds on more than one weekend.

**Not settled yet:**
- It's 341 trends from two and a half days, 45% of them sports (a Nations League round and a college football Saturday).
- The check of this batch covered Google and Bluesky only.
- Rule changes are held until the review around 2026-10-07; a week of trends with text will be in by then. Re-run on that week before step 3.

## What it means

- **Not ready to ship.** It misses both targets, by 2 points on accuracy and 13 on coverage.
- **The cheap fix is more labels.** The stored lists add about 300 new trends a day, the local model drafts them at about one a second, and each batch gets checked. A re-run at about 2,000 and 3,000 labels will show whether the curve gets there.
- **If it flattens below the targets,** the options are:
  - give the classifier what the local model sees. Live, the pipeline's vector for a Google trend already includes its headlines; here, stored lists keep only titles, so Google's vectors in this test are poorer than the live ones would be;
  - settle for a few sure categories (sports, tech, politics, gaming) and unknown for the rest, which already runs above 90% right;
  - drop the idea, and keep category as a research label only.
- **A category feature is only worth shipping if the forecasts improve with it** (task 5.14, step 4). Platform and category are tangled, so part of what category says, the models already get from the platform ranks.

## Limits

- Two days of trends, heavy on the MLB playoffs and on October 1's calendar tags.
- One reviewer's check (the research assistant's), on labels drafted by one local model.
- The test set has 288 trends, so a category with under 20 of them has a wide margin.
- Reddit joined at 12:07 UTC on October 1, so training holds almost no Reddit trends.
- Titles only: no headlines, and no article context.
