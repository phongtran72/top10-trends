# RQ5 · Rhythms: hour of day

**Status: preliminary (2026-09-30).** The method is ready, but there's only one weekday afternoon of data, which can't show a daily rhythm. What this first run did show is how fast each list churns, and three facts about the lists themselves that change how they can be used (below). Re-run `notebooks/05_rq5_rhythms.ipynb` from 2026-10-03, when each list has 3 days; the hour-of-day result becomes trustworthy after about a week (2026-10-07), and weekdays after about 3 weeks.

## Question

Does attention have a daily rhythm? When do the lists churn fastest, when do new topics arrive, and when is activity highest? Weekdays come later, and seasons once Wikipedia pageviews are in (task 5.8).

## Data

- Stored lists (`trend_items`) from 2026-09-30 11:32 to 21:08 UTC, which is 07:32 to 17:08 US Eastern on one Wednesday.
- 12 fetches each for Bluesky, Google Trends (US), Hacker News, Mastodon and Twitch: 1,260 rows, without YouTube.
- No `algo_version`: stored lists are the sources' own lists, before any matching.
- X, TikTok, Instagram and Pinterest start later. TikTok, Instagram and Pinterest refresh daily or less often, so they're left out of hourly measures.

## Method

`topnews.rhythms`, tested with synthetic data in `tests/test_rhythms.py`. Per list and fetch, using each list's top 10:

- **Turnover:** the share of the top 10 that wasn't in the list about an hour earlier. Each fetch is compared with the latest fetch at least 45 minutes older, and not at all when that one is more than 90 minutes older.
- **Novelty:** items in the top 10 for the first time since the data starts.
- **Flow:** the median hourly growth of the metric, across top-10 items that were also in the list an hour earlier.
- **Hour effect:** `value ~ C(hour) + C(day)` by least squares, so one busy day isn't read as a time-of-day pattern. It runs once a list has 3 days. With 5 lists and 3 measures, a rhythm counts only at p < 0.01, and only if it holds the following week.

Items are matched across hours by url for Bluesky and Hacker News, and by title elsewhere (see finding 3). Hours are US Eastern.

## Result

Churn levels on one day, not rhythms:

| List | New in the top 10 per hour | Hours with no change (of 10) | Median growth per item |
| --- | --- | --- | --- |
| Google Trends (US) | 61%; all 10 in each of the last 3 hours (3–5 p.m.) | 0 | none (searches are bucketed) |
| Bluesky | 53% | 0 | 91 posts an hour |
| Hacker News | 26% | 0 | 22 points an hour |
| Mastodon | 8% (about 1 tag) | 2 | 2.8 uses an hour |
| Twitch | 7% | 5 | none (no viewer count) |

Three facts about the lists:

1. **Google Trends' feed is the 10 newest US trends, not the 10 biggest.**
   - Each hour the new trends go on top and the older ones shift down. At 15:08 UTC the list was 3 new trends, then the previous list's first 7, in the same order.
   - The live feed, checked at about 22:00 UTC, held exactly 10 items sorted by start time over 40 minutes. The one with 50,000+ searches was #2, and one with 20,000+ was #3.
   - On a busy afternoon (baseball playoffs, the market close), 10 or more new trends an hour replaced the whole list every hour.
2. **Every stored metric is a running total for its item.** That holds for Bluesky posts, Hacker News points, Google searches (in buckets) and Mastodon's "uses today", which restarts at midnight UTC.
   - One Bluesky topic went from 265 posts to 1,171 over ten hours.
   - The median total of the top 10 measures how old the list's items are, not how active the platform is. Bluesky's morning top 10 (7 and 8 a.m.) had 4.5 times the day's median total because it still held the previous day's big stories. Yet its growth at 9 and 10 a.m. was just below the day's median (0.89 and 0.99 times).
3. **Bluesky rewrites a topic's title as the story moves on.** 7 of its 72 topics were renamed within the day under the same feed url. Hacker News titles get edited too. Google's url is its first news link, which changes: 14 of 71 titles had more than one.

## What it means for the forecasts

- **Google's rank means age, not size.** In the combined score, `weight / log2(rank + 1)` gave Google's newest trend the most weight, not its biggest. And a Google trend leaves the feed when 10 newer ones start, which on a busy afternoon takes under an hour, so its time on the feed isn't its lifespan.
  - **Decided the same day** (task 2.12, PLAN.md › Ranking › Google Trends window): Google's list is now every trend it published in the last 3 hours, ranked by searches. That applies to the combined score, the snapshots and the site; `trend_items` keeps the feed's order.
  - **For research,** a topic that only Google has stays in the snapshots for up to 3 hours after its last sighting. Google-led lifespans (RQ1, the lifespan labels) carry that tail, so measure Google's own time on the feed from `trend_items`.
- **Features use growth, never totals.** Posts per hour, points per hour, uses per hour.
- **The hours horizon has to be fast on Bluesky and Google,** where about half the top 10 changes every hour. Twitch and Mastodon change about one item an hour, so their hourly fetches add little new information.

## Limits

- One weekday, daytime only: no night, no weekend, and a single news day.
- Nothing here separates an hour of day from that day's own course.
- Novelty runs high early in the data: a topic that trended just before the data starts looks new when it comes back.
- Mastodon's trends update in steps, so some hours show no growth.
- For Google, turnover is capped: 100% means 10 or more new trends.
