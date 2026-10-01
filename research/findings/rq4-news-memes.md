# RQ4 · News and memes

**Status: preliminary (2026-10-01).** One day of stored lists. The lifespans are too thin to compare yet, but two patterns are already visible.
- On this day, the trends linked to news were mostly sports names on X.
- The one non-news kind that crossed platforms was the recurring calendar moment.
- Re-run `notebooks/04_rq4_news.ipynb` weekly. After phase 2, repeat it with snapshots' `news_count`, and later with GDELT's news volume (task 5.8).

## Question

Do news-driven trends last longer, or spread further, than memes? It decides how much the forecasts should lean on news signals, and whether recurring calendar moments deserve their own place in the weeks horizon.

## Data

- Stored lists (`trend_items`) from 2026-09-30 11:32 to 2026-10-01 00:08 UTC, through RQ6's matching: 421 trends after the filters, every list but YouTube.
- Lifespans use the lists that refresh hourly, as in RQ1.

## Method

`topnews.news`, tested in `tests/test_news.py`. Each trend gets one category:

| Category | Rule | Trends |
| --- | --- | --- |
| google | a Google Trends trend; every one comes with a news story (140 of 140 items), so Google is news by construction | 94 |
| calendar | a recurring calendar moment: a weekday hashtag (#WIPWednesday), a "national … day", a season's first day | 20 |
| news-linked | matched to a Google trend at 0.70, so a news story stands behind it | 11 |
| other | everything else: games, tech stories, memes, culture | 296 |

- **Spread:** counts a match on another list besides Google, because "news-linked" means matched to Google.
- **Lifespans:** RQ1's stays in the top 10, as Kaplan–Meier estimates.
- **The labels were checked by hand.** All 20 calendar and 11 news-linked labels look right.

## Result

- **News-linked meant sports on this day.** 9 of the 11 are X trends during the MLB wild card round: "Braves", "Phillies", "Astros", "Hunter Brown", "Andrew Painter", "Altuve", "Mahle", plus the WNBA's "Mystics" and "Ronaldo". The other two are Bluesky's "Phillies force Game 3 in Atlanta" and Instagram's "braves".
- **Calendar moments came mostly from Mastodon:**
  - 12 Mastodon weekday tags and observances, from #WIPWednesday and #TuneTuesday to #internationalpodcastday;
  - 5 of Pinterest's "first day of fall" searches;
  - TikTok's #firstdayoffall and #nationaldaughtersday;
  - Instagram's "national coffee day".
- **Spread, on another list besides Google:**

| Category | Trends | Also elsewhere |
| --- | --- | --- |
| calendar | 20 | 35% (2 stories: the first day of fall, national coffee day) |
| news-linked | 11 | 18% (one story: X's and Instagram's "Braves") |
| google | 94 | 13% |
| other | 296 | 4% (Gemini 4 Argon, Silent Hill: Townfall, Aniimo, Jack Smith, and one wrong match) |

- **Lifespans can't be compared yet.** Outside "other", no category has more than 5 spells on a list that refreshes hourly. That's partly because X, where most news-linked trends are, has only 3 runs.

## What it means for the forecasts

- **"News" needs subtypes.** On a playoff day, news-driven means sports. RQ4 should split news by kind (sports, politics, entertainment), for example by clustering topic centroids as RQ1 plans, before asking whether news lasts longer than memes.
- **Calendar moments are the predictable kind of cross-platform trend.**
  - Everyone observes the same calendar, so national coffee day and the first day of fall show up on several platforms with no news behind them, on dates known in advance. That's the weeks horizon's best case.
  - PLAN.md's event calendars (task 5.8) cover sports, public holidays and releases, not observances such as national days. A calendar of those would be worth adding.
  - Until then, last year's dates come round again.
- **News-linked is only as good as Google's coverage.** A news story that doesn't trend on Google US leaves its trends in "other". Snapshots' `news_count` has the same blind spot; GDELT would close it.

## Limits

- One day, dominated by the MLB wild card round.
- The calendar result rests on 2 stories, and Pinterest's search variants inflate its trend count.
- Titles only. Stored lists keep no headlines, and Google's news links don't vary.
- The categories are rules, not a model. They miss calendar moments without a date word ("Fat Bear Week"), and they call any trend that matches Google "news-linked".
