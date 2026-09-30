# RQ3 · Breakout

**Status: method ready, no result yet (2026-09-30).** No trend on the five all-day lists spread to another one. The day's shared stories ran on X, Google and Instagram in the evening, and X and Instagram joined the data then. Re-run `notebooks/03_rq3_breakout.ipynb` as days go by: its second cut (every list) fills first, and its model cell starts once 30 trends have spread. After phase 2, repeat it on topic snapshots, with `news_count`.

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

## What it means for the forecasts

- **On the phase-1 lists alone, spreading is rare,** under 4% of trends. A model of spread for those lists would have to beat a "never spreads" rule that's right more than 96% of the time. Precision and lead time, not accuracy, are the right scores (PLAN.md › Evaluation).
- **The features that matter will come from X, Google and Instagram,** where the stories cross over. Cut B is where RQ3 can start. At RQ6's rates (a fifth to a third of those lists' trends matched elsewhere), it should reach 30 spread trends within a few days (a rough estimate).
- **This can't answer the real breakout question yet** (3 or more platforms within 6 hours). That needs topic snapshots and weeks of data.

## Limits

- One day, and only the five lists without X, TikTok, Instagram or Pinterest have a full day.
- The features are titles, ranks and metrics only. There are no headlines, and Google's news links don't vary.
- The outcome depends on RQ6's matching. At 0.70 it misses some right matches, and at 0.60 half of the borderline ones are wrong.
