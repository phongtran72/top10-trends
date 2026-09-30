# RQ2 · Lead and lag

**Status: method ready, no result yet (2026-09-30).** Only one usable story pair so far. The main obstacle is that X, TikTok, Instagram and Pinterest joined the data at 22:08 UTC. Everything they had then is censored, meaning we can't tell when it really started. Re-run `notebooks/02_rq2_leadlag.ipynb` weekly.
- **Within a few days:** Google against X should have about 20 usable stories, the fastest pair to fill (see below).
- **Most other pairs:** will take weeks.
- **After phase 2:** repeat it on topic snapshots.

## Question

Which platform tends to have a story first, and by how long? A platform that leads is an early-warning feed for the hours horizon ("should I post about this now?"). Its lead time is the most a forecast could gain from watching it.

## Data

- Stored lists (`trend_items`) from 2026-09-30 11:32 to 22:08 UTC, through RQ6's matching: 369 trends after the filters.
- YouTube is left out and Reddit isn't collected yet.

## Method

`topnews.leadlag`, tested in `tests/test_leadlag.py`.
- **Matching:** trends are matched as in RQ6 (the pipeline's filters and model), but at 0.70 rather than 0.60. RQ6 found matches near 0.60 about half right, and a wrong match gives a meaningless lead.
- **Stories:** matched trends are grouped into stories, so Google's "phillies", "phillies - braves" and "braves vs phillies" count once.
- **The lead:** for each story and pair of platforms, the lead is the gap between each platform's earliest sighting.
- **Censoring:** a trend already on its list at that source's first fetch started at an unknown earlier time, so its story pairs are left out.
- **Slow sources:** TikTok, Instagram and Pinterest appear on their refresh schedule, not when a story broke, so they're left out too.
- **Resolution:** fetches are hourly, so leads are good to about an hour, and sightings under 30 minutes apart are a tie.

## Result

- **Counts:** 17 matched trend pairs formed 8 stories and 12 story pairs. Of those, 11 were censored (3 of them also slow), which left 1 usable pair.
- **The one lead:** Google Trends had the Phillies–Braves game ("phillies game today", 19:08 UTC) 3 hours before Bluesky ("Phillies force Game 3 in Atlanta", 22:08).
- **What the censored pairs show:** they show why censoring matters. For example, Google had "braves" at 18:10 and X had "Braves" at 22:08. Read naively, that's a 4-hour lead for Google. But X wasn't being collected before 22:08, so that lead is unknown, not 4 hours.

## What it means for the forecasts

Nothing yet. Some expectations to test as the data grows:

- **Google against X should fill first.** RQ6 found they share the most stories (22% of Google's trends were on X). At that rate, about 20 usable stories should take a few days of X data (a rough estimate from one hour).
- **A lead measures when a story enters a platform's list, not when people there start talking about it.** Google's feed lists new trends as soon as they start (RQ5), and Bluesky ranks by velocity. X and Twitch rank by size, so they may look late by construction. For creators, list entry is what matters: it's when a story becomes visible. For research, it's a caveat.
- **Most pairs will need weeks.** Only a few stories a day cross platforms (RQ6), so pairs such as Hacker News against Mastodon may stay near zero.

## Limits

- One day of data and one usable pair.
- The 0.70 threshold misses right matches written as one-word hashtags, which task 2.9 may fix with word splitting.
- Stories are only as good as the matches that link them. At 0.70, X's separate "Phillies" and "Braves" trends formed two stories for one game.
- Leads are good to about an hour.
- Censored pairs are dropped rather than bounded. A later version could keep the pairs where the censored side still certainly led.
