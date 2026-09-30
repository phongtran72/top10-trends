# RQ1 · Lifecycle

**Status: preliminary (2026-09-30).** This covers each platform's own lists over one day: 12 hours of the phase-1 lists and 2 runs of X.
- **The full answer comes later.** Lifecycles across platforms and in the combined top 10, by topic category, need topic snapshots (after phase 2). Gate 5's RQ1 write-up is that version.
- **What's known already:** three facts about how each list behaves, and the shape of Hacker News's rise and fall.
- **Next:** re-run `notebooks/01_rq1_lifecycle.ipynb` weekly.

## Question

How do trends rise, peak and fade, and how long do they last? The half-life sets the days horizon's baseline ("will it still matter when my video is ready?"), and the shape of the rise says how early a trend can be caught.

## Data

- Stored lists (`trend_items`) from 2026-09-30 11:32 to 23:08 UTC, each list's top 10.
- Bluesky, Google Trends (US), Hacker News, Mastodon and Twitch have 13 hourly runs. X (Worldwide and US) has 2.
- TikTok, Instagram and Pinterest refresh daily or less often and are left out. YouTube is left out by default.

## Method

`topnews.lifecycle`, tested in `tests/test_lifecycle.py`.
- **Spell:** a spell is one stay in a list's top 10, from the fetch where the item entered to the first fetch where it's missing. Items are matched by url for Bluesky and Hacker News, and by title elsewhere.
- **Durations** are in whole hours, because fetches are hourly. "Still listed after 1 hour" means it was there at the next fetch.
- **Left-censored spells are left out.** These were already listed at a list's first fetch, or right after a gap, so their start is unknown. That's 10 per list, the first fetch's top 10.
- **Right-censored spells count as ongoing.** These were still listed at the end of the data. The survival curves are Kaplan–Meier estimates (`lifelines`).
- **A second version** lets a spell carry on through one missed fetch, because Bluesky's list drops and re-adds topics (below).

## Result

Median time in the top 10 (the half-life), and the share still listed after 1, 2, 3 and 6 hours:

| List | Spells (ended) | Median | 1 h | 2 h | 3 h | 6 h |
| --- | --- | --- | --- | --- | --- | --- |
| Bluesky | 66 (57) | 1 h | 30% | 22% | 8% | 0% |
| Bluesky, one missed fetch allowed | 50 (33) | 2 h | 54% | 48% | 26% | 7% |
| Google Trends (US) | 81 (71) | 1 h | 37% | 20% | 4% | 0% |
| Hacker News | 29 (20) | 3 h | 76% | 52% | 40% | 11% |
| Mastodon | 7 (3) | over 12 h | 71% | 57% | 57% | 57% |
| Twitch | 7 (3) | over 12 h | 71% | 57% | 57% | 57% |
| X, Worldwide and US | 9 (0) | not yet | | | | |

1. **The lists work in three different ways.**
   - *Google Trends is a queue.* Trends enter near the top (median rank 4), never climb (0 of 81), slide down as newer trends push in (median rank 4, then 7, then 8.5) and never come back.
   - *Hacker News has a real rise and fall.* 38% of its stories climb after entering (median entry rank 7), and the median rank goes 6, 5, 5, 4.5, then falls to 8 by hour 5.
   - *Bluesky flickers.* 47% of its spells are returns, and 55% even in its full 25-item list. Most come back after missing one hourly fetch (38 of 65 returns), and 78% within two. Bluesky's trending list is re-cut every hour, and a topic near the edge drops in and out.
2. **Mastodon and Twitch barely move.** Most of their top 10 stays all day (more than half of the entries were still listed after 12 hours). Their trends are long-running tags and games, not moments.
3. **On the fast lists, most trends are brief.** Two-thirds of Bluesky and Google entries were gone at the next hourly fetch. The longest finished stays were 6 to 7 hours: Hacker News stories, and Bluesky's "Canada marks Truth and Reconciliation Day".

## What it means for the forecasts

- **A day of one list's attention is rare.** On Bluesky, Google and Hacker News almost nothing stayed in the top 10 for 6 hours. So "hours left in the combined top 10" will come mostly from breadth, a topic kept alive by several platforms, and from Google's 3-hour window (task 2.12), not from long stays on one list.
- **Google's time in the list isn't lifespan.** It's the time until 10 newer trends start, and the 3-hour window keeps a Google-only topic in the snapshots for up to 3 hours after it leaves the feed. Google-led lifespans need that tail taken off (RQ5).
- **Bluesky's lifespans need tolerance for gaps.** Counting a one-hour absence as the end halves Bluesky's half-life, 1 hour instead of 2. Snapshot labels should treat a return within an hour or two as the same life, or they'll teach the model that Bluesky topics die and are reborn.
- **Hacker News is the one list with a catchable rise.** It's the natural first test for the hours horizon's "rising" forecast within a single list.

## Limits

- 12 hours of daytime data on one weekday (07:30 to 19:00 US Eastern). Nights and weekends may differ, so RQ5 comes back into this.
- Mastodon, Twitch and X have too few finished spells to estimate a half-life.
- Durations are good to an hour. A trend seen once may have lasted a few minutes or nearly two hours.
- Per-list lifecycles only. No topic categories yet: they need the topic centroids from phase 2.
