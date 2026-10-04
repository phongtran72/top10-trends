# RQ3 · Breakout

**Status: first result (2026-10-04, below). As first written (2026-09-30):** No trend on the five all-day lists spread to another one. The day's shared stories ran on X, Google and Instagram in the evening, and X and Instagram joined the data then. Re-run `notebooks/03_rq3_breakout.ipynb` as days go by: its second cut (every list) fills first, and its model cell starts once 30 trends have spread. After phase 2, repeat it on topic snapshots, with `news_count`.

## Question

What separates trends that spread to other platforms from those that stay on one? The answer becomes the features of the hours horizon's forecast ("will this reach 3 platforms within 6 hours?").

## Data

- Stored lists (`trend_items`) from 2026-09-30 11:32 to 23:08 UTC, through RQ6's matching (the pipeline's filters and model).
- **Cut A:** Bluesky, Google Trends, Hacker News, Mastodon and Twitch, matched only against each other.
- **Cut B:** every list, from 22:08 UTC.

## Method

`topnews.breakout`, tested in `tests/test_breakout.py`.
- **Outcome:** reaching 3 or more platforms is too rare to study yet (2 stories all day, RQ6). The outcome is *spread*: matched on at least one other list at 0.70. That's stricter than RQ6's 0.60, because a wrong match makes a wrong label.
- **Features:** only what's known at a trend's first sighting:
  - its platform and entry rank;
  - its metric against its list's median;
  - its hour of day (US Eastern), title length and whether it's a hashtag.
- **Who counts:** only trends whose entry was seen and that had at least 6 hours of data after it. A trend seen in the last hours hasn't failed to spread; it hasn't had time.
- **Rates** come with 95% Wilson intervals.
- **Dropped:** a "Google trend with a news story" feature, because all 140 Google items in the data had one.

## Result

- **Cut A: 96 trends counted, none spread at 0.70.** The 95% upper bound on their spread rate is 3.8%.
  - At 0.60, 2 "spread", and both were wrong matches. One paired two different Senate bills. The other paired Twitch's Minecraft category with a Hacker News story that mentions Minecraft.
- **Cut B: nothing to count yet.** Its first trends need 6 hours of data after them, and entries seen after the first run.
- **Where the day's cross-platform stories were:** the MLB wild card games, the Astros and Jack Smith (RQ6). They all ran on X, Google and Instagram in the evening, after the 17:08 UTC cutoff that cut A's 6-hour rule sets.

## Re-run on the pipeline's new matcher (2026-10-01)

With nomic-embed-text-v1.5 at the pipeline's 0.86 and data to 2026-10-01 03:08 UTC:

- **Cut A: 146 trends counted, 7 spread (4.8%), all right matches.** They are three stories that Google and Bluesky shared: the US–Iran proposals, the Phillies–Braves game (four Google variants) and Ronaldo leaving Portugal's camp. None reached 3 lists.
- **Cut B: still nothing to count.** Every list has only 6 hours of data.

With the old model, none of 96 spread at 0.70, and the two that did at 0.60 were wrong matches. The better matcher finds the real ones. Seven is still too few to compare features.

## First result on four days (2026-10-04)

Every hourly list since X joined (2026-09-30 22:08 to 2026-10-04 22:08 UTC), Google's US feed only, matched on titles at 0.86. A trend counts when its entry was seen and 6 hours of data follow it.

**2,315 trends; 381 were also on another list (16%, 95% interval 15% to 18%); 50 were on three or more (2.2%).**

| By the list it was on | Trends | Also on another list |
| --- | --- | --- |
| Google Trends (US) | 684 | 23% |
| X | 689 | 21% |
| Bluesky | 179 | 20% |
| Mastodon | 96 | 19% |
| Twitch | 66 | 11% |
| Reddit | 355 | 5% |
| Hacker News | 246 | 1% |

What was known at a trend's first sighting:

| Known at first sighting | Groups | Also on another list |
| --- | --- | --- |
| Its metric against its list's median | below half, near, over twice | 14%, 20%, **37%** |
| Its entry rank | 1–10, 11 or deeper | 20%, 12% |
| Its title | 1–3 words, 4 or more | 22%, 8% |
| The hour (US Eastern) | before 6 pm, after | 15%, 19% |
| Its category | sports, calendar, incident, entertainment, politics, tech | 29%, 27%, 18%, 15%, 14%, 2% |

- **The clearest sign is size at entry:** a trend that enters at more than twice its list's usual metric (searches on Google, posts on Bluesky) is on another list 37% of the time, against 14% for one under half.
- **Most of the spread is Google with X:** 126 of Google's 160 spread trends were matched on X, and 118 of X's 142 on Google. Reddit's and Hacker News's long titles rarely match anything.
- **Category matters as much as anything known at entry.** Sports and calendar moments are near 28%, tech 2%. Category isn't known live yet (task 5.14).
- **Put together, these say little.** A logistic model of spread on the platform, a top-3 entry, a one-word title and the evening explains 4% of the variation; only "it's on Reddit" is a clear effect. Whether a trend spreads depends mostly on what it's about, which a rank and an hour don't say.

**The first run found none in 96.** That was the five all-day lists on one afternoon, before X joined; on those five lists over four days it's 90 of 1,415 (6%).

**Cautions.** "Also on another list" here is at any time within a day, not only after the first sighting, so it's breadth, not yet a forecast target; the training table's labels look forward (task 5.2). Matching on titles at 0.86 has some wrong pairs. And the live site would count fewer: its matcher currently splits same-name topics on Google and X (`findings/matching.md`).

## What it means for the forecasts

- **On the phase-1 lists alone, spreading is rare,** about 5% of trends with the new matcher. A model of spread for those lists would have to beat a "never spreads" rule that's right about 95% of the time. Precision and lead time, not accuracy, are the right scores (PLAN.md › Evaluation).
- **The features that matter will come from X, Google and Instagram,** where the stories cross over. Cut B is where RQ3 can start. At RQ6's rates (a fifth to a third of those lists' trends matched elsewhere), it should reach 30 spread trends within a few days (a rough estimate).
- **This can't answer the real breakout question yet** (3 or more platforms within 6 hours). That needs topic snapshots and weeks of data.

## Limits

- One day, and only the five lists without X, TikTok, Instagram or Pinterest have a full day.
- The features are titles, ranks and metrics only. There are no headlines, and Google's news links don't vary.
- The outcome depends on RQ6's matching. At 0.70 it misses some right matches, and at 0.60 half of the borderline ones are wrong.
