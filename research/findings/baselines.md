# Baselines (task 5.5)

**Status: scored on two held-out weeks under r7, one set of rules (2026-10-28, below); before that on two weeks of lists and the r6 table (2026-10-13). As first written (2026-10-01):** These are the rules any forecast model has to beat. The lifespan rules are scored; the breakout rule needs more data first.
- Task 5.5's version is scored on the latest 2 weeks held out, once the dataset (5.2) has them.
- Re-run `notebooks/07_baselines.ipynb` as the data grows.

## What's measured

`topnews.baselines`, tested in `tests/test_baselines.py`. The data is split by time: the first 70% trains (2026-09-30 11:32 to 20:21 UTC), the rest tests (to 2026-10-01 00:07). Nothing after the split reaches training: stays still running at the split are cut off there.

- **Lifespan, the days horizon, here per list.** At every hourly fetch, for every item in a list's top 10, the rules forecast how many more hours it stays:
  - `median_left`: the Kaplan–Meier median of the time left at the item's age, from training;
  - `as_long_again`: it lasts as long again as it has so far (the Lindy rule);
  - `one_more_hour`.
- **Breakout, the hours horizon.** PLAN.md's rule, "on 2 platforms within 2 hours of first appearing", forecasts a story reaching 3 or more platforms within 6 hours. It's scored by precision, recall and lead time.

## How to score a lifespan fairly

Error in hours can only be scored on stays that have ended. On a short test stretch those are the short ones, so "one more hour" looks perfect: it was scored on 23 Bluesky forecasts with no error at all. The fair score asks **"still listed k hours later?"**.
- It's scored on every forecast made at least k hours before the end of the data.
- For those, the answer is known whether the stay ended or not, so long stays aren't dropped.
- A rule must beat always giving the more common answer.

Building this exposed two bugs, both fixed and tested:
- **RQ1's running stays were credited with an hour they weren't observed for.** RQ1's numbers are corrected.
- **"Still listed" was counted for a stay left open by the missed-fetch tolerance after its last sighting.** Those forecasts now count as unknown.

## Result

"Still listed 1 hour later?", accuracy on the test stretch:

| List | Forecasts | Truly still listed | median_left | as_long_again | one_more_hour |
| --- | --- | --- | --- | --- | --- |
| Google Trends (US) | 30 | 0% | 100% | 100% | 100% |
| Bluesky | 27 | 15% | 81% | 81% | 85% |
| Hacker News | 28 | 79% | 82% | 57% | 21% |
| Twitch | 12 | 83% | 83% | 50% | 17% |
| Mastodon | 12 | 100% | 100% | 92% | 0% |

- **No rule beats the majority answer.**
  - `median_left` comes closest everywhere, because for each list it learns the more common answer: gone within the hour on Google and Bluesky, still there on Hacker News, Mastodon and Twitch.
  - "Lasts as long again" (the Lindy rule) is worse on the lists where things last (57% against 79% on Hacker News).
- **The bar for a model is per list:** better than "Google and Bluesky trends are gone within the hour, the others stay" (79% to 100% right one hour ahead). Two hours ahead, Hacker News is close to a coin toss: 63% still listed, and `median_left` is right 58% of the time.
- **Rules learned in the daytime can miss the evening.**
  - Before the bug fix, `median_left` learned "2 hours" for Google from the slower daytime feed, while in the evening nothing survived an hour (RQ5's full turnover).
  - A lifespan model needs hour of day as a feature, and its training stretch should cover whole days.
- **Breakout: nothing to score yet.** Since every list was collected (2026-09-30 22:08), 9 stories have matched across lists, but no hour has its next 6 hours in the data yet.

## Re-run on two weeks (2026-10-13)

Stored lists from 2026-09-30 to 2026-10-13 UTC. The rules learn on the first nine days (to 2026-10-09 07:21 UTC) and are scored on the last four. Three missing hours are treated as gaps.

**Lifespan per list: "still in the top 10 k hours later?"** Share of forecasts each rule gets right, beside always giving the more common answer:

| List | k | More common answer | Median time left at its age | As long again |
| --- | --- | --- | --- | --- |
| Bluesky | 1 h | 61% | **70%** | 68% |
| Bluesky | 2 h | 54% | **72%** | 73% |
| Bluesky | 3 h | 63% | **73%** | 74% |
| Hacker News | 3 h | 51% | 56% | 56% |
| X, US | 3 h | 67% | 63% | 58% |
| X, worldwide | 3 h | 82% | 80% | 74% |
| Reddit | 3 h | 61% | 61% | 61% |
| Mastodon | 3 h | 82% | 82% | 68% |

- **The first run's answer changes for one list.** On one evening no rule beat the more common answer anywhere. On two weeks the rules beat it on Bluesky by 9 to 18 points: how long a Bluesky topic has already been listed says how much longer it will be. Hacker News gains 5 points at 3 hours.
- **Everywhere else the more common answer is still the bar,** and on X it beats the rules. A model for those lists has to bring something the item's age doesn't.
- **Google's feeds need no forecast:** a US trend is gone an hour later 95% of the time.

**Breakout: PLAN.md's rule is far from the target.**
- On the lists, scored hour by hour over 644 matched stories: "on 2 platforms within 2 hours of first appearing" raises an alert in 42% of story-hours and is right in 0.6% of them. Scored that way the rule fires on almost every shared story, every hour, so this isn't a useful measure.
- On the training table (the live snapshots under r6, US view, test rows from 2026-10-10 16:08 UTC), where 2.3% of rows break out within 6 hours:

| Rule | Alerts | Right | Of all breakouts, caught |
| --- | --- | --- | --- |
| On 2 platforms now, first seen under 2 hours ago (PLAN.md's rule) | 23 | 4% | 1% |
| On 2 platforms now | 154 | 18% | 26% |
| At position 4 to 10 now | 350 | 16% | 54% |
| At position 4 to 6 now | 145 | 27% | 38% |

- **The best simple rule is right about a quarter of the time,** against a target of 60%. A model has a long way to go, and the bar it has to beat is "position 4 to 6", not the rule in the plan.

**Time left in the combined top 10** (same table, 521 test rows with a known answer): always answering the training median of 2 hours is off by 1.6 hours on average; the median for the topic's position (3 hours in the top 3, 2 at 4 to 6, 1 at 7 to 10) by 1.5; "one more hour" by 1.8. 61% are still there an hour later, 40% two hours later, 24% three and 8% six.

## Re-run on two weeks of r7 (2026-10-28)

The first two weeks under one set of ranking rules: r7 ran from 2026-10-14 03:07 UTC with no missed hour, 338 runs to 2026-10-28 02:08 UTC.

**Lifespan per list.** Learned on the stored lists before r7 (2026-09-30 11:32 to 10-14 03:00 UTC) and scored on r7's two weeks: 36,097 forecasts. The lists don't depend on the ranking rules, so the earlier lists are fair training data.

| List | k | More common answer | Median time left at its age | As long again |
| --- | --- | --- | --- | --- |
| Bluesky | 1 h | 51% | **70%** | 68% |
| Bluesky | 2 h | 65% | **73%** | 73% |
| Bluesky | 3 h | 73% | **78%** | 78% |
| Hacker News | 3 h | 51% | **57%** | 56% |
| Reddit | 3 h | 62% | **65%** | 64% |
| X, US | 3 h | 71% | 70% | 62% |
| X, worldwide | 3 h | 81% | 81% | 74% |
| Mastodon | 3 h | 83% | 83% | 70% |

- **The Bluesky result holds on held-out weeks:** a topic's age beats the more common answer by 19, 9 and 5 points at 1, 2 and 3 hours (9, 17 and 10 points when one missed fetch is allowed).
- **Hacker News and Reddit gain a little at 3 hours** (6 and 4 points). X, Mastodon, Twitch and Google's feeds don't: there the more common answer is still the bar. A US Google trend is gone an hour later 95% of the time.
- On the stays that ended, "one more hour" has the smallest error in hours on every list, but that score favours short stays (*How to score a lifespan fairly*).

**Breakout within 6 hours, on the r7 training table.** US view, one row per story and hour (a story carries on across the 48-hour topic limit): 31,442 rows, 4,594 stories. 1.9% of the rows with a known answer break out (554 rows, 189 stories). The rules learn nothing, so they're scored on both weeks:

| Rule | Alerts | Right | Of breakout rows, caught | Breakout stories warned | Median lead |
| --- | --- | --- | --- | --- | --- |
| On 2 platforms now, first seen under 2 hours ago (PLAN.md's rule) | 172 | 19% | 6% | 22 of 189 | 1 h |
| On 2 platforms now | 913 | 15% | 25% | 47 | 2 h |
| At position 4 to 6 now | 917 | 17% | 29% | 99 | 1 h |
| At position 4 to 10 now | 2,209 | 12% | 47% | 141 | 1 h |
| Climbed in the last hour, in the top 20 | 1,681 | 7% | 23% | | |

- **The best simple rule is right about one time in six,** against a 60% target. The 27% that "position 4 to 6" scored on r6 came from 145 alerts over three days; on 917 alerts over two weeks it's 17%. Week 2 alone (from 2026-10-21 03:00 UTC) gives the same order, one or two points lower.
- **PLAN.md's rule is now as precise as the best one** (19%, against 4% on r6), but it fires rarely and warns only 22 of the 189 stories that broke out.
- **A right alert comes about one run early:** the median lead is 1 hour (2 for "on 2 platforms now"), the mean 1.6 to 2.3 hours. A model's lead time is judged against that.
- **The classifier's category alone says nothing:** rows with one break out at 1.7%, rows without at 2.0%.

**Spread to a second platform within 6 hours** (week 2, 1.9% of the rows on one platform): the best rule, "in the top 10 now", is right 4% of the time and catches 17%. "On X now" and "first seen under an hour ago" do worse than the base rate. Spread is harder to call than breakout.

**Time left in the combined top 10** (learned on week 1, scored on 1,635 week-2 rows with a known answer; 43 more are censored): the training median of 2 hours is off by 2.0 hours on average, the median for the topic's position (3, 2 and 1 hours, as on r6) by 1.9, and "one more hour" by 2.3. 64% are still there an hour later, 43% two hours later, 27% three and 11% six: a little longer than on r6.

**What this closes:** 5.5 is scored on two held-out weeks under one set of rules, with precision, lead time and lifespan error. The models (5.6) are planned to train on r8 hours, so 5.6 re-scores these rules on its own held-out weeks. r8 isn't live yet: the 2026-10-29 rebuild stopped before its swap and wrote nothing, so r7 carries on. The r7 hours are saved locally by `topnews.live_copy` before any rebuild.

## Limits

- Under 4 hours of test data, on one evening.
- Lifespans are per list, not in the combined top 10. That needs topic snapshots.
- The breakout rule depends on RQ6's matching and is unscored.
