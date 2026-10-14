# Baselines (task 5.5)

**Status: scored on two weeks, and on the live training table (2026-10-13, below). As first written (2026-10-01):** These are the rules any forecast model has to beat. The lifespan rules are scored; the breakout rule needs more data first.
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

## Limits

- Under 4 hours of test data, on one evening.
- Lifespans are per list, not in the combined top 10. That needs topic snapshots.
- The breakout rule depends on RQ6's matching and is unscored.
