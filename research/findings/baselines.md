# Baselines (task 5.5)

**Status: built and scored on one evening (2026-10-01).** These are the rules any forecast model has to beat. The lifespan rules are scored; the breakout rule needs more data first.
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

## Limits

- Under 4 hours of test data, on one evening.
- Lifespans are per list, not in the combined top 10. That needs topic snapshots.
- The breakout rule depends on RQ6's matching and is unscored.
