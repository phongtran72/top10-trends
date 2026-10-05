# RQ4 · News and memes

**Status: answered inside each platform on five days (2026-10-05, below). As first written (2026-10-01):** One day of stored lists. The lifespans are too thin to compare yet, but two patterns are already visible.
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

## Re-run on the pipeline's new matcher (2026-10-01)

With nomic-embed-text-v1.5 at the pipeline's 0.86 and data to 2026-10-01 03:08 UTC (513 trends), "news-linked" now finds 25 trends, where it found 11.

| Category | Trends | Also on another list besides Google |
| --- | --- | --- |
| calendar | 20 | 40% |
| news-linked | 25 | 40% |
| google | 121 | 20% |
| other | 347 | 6% |

News-linked trends now spread as often as calendar moments. With the hand-checked categories (`findings/categories.md`), the split is sharper: calendar 30%, sports 29%, gaming 10%, politics 6%, entertainment 2%.

**Correction (2026-10-01, data to 13:07 UTC):** calendar moments cross mostly through the slow lists. Over every list 25% of them were matched on another list; on the hourly lists only 7% (3 of 42), because the rest of the matches are on Instagram, Pinterest and TikTok, and the TikTok–Pinterest ones are a week apart. Sports is the one kind that clearly spreads on the hourly lists (25%). The tables are in `findings/categories.md` › Second set.

## Re-run on five days, inside each platform (2026-10-05)

Stored lists to 2026-10-05 10:08 UTC, Google's US feed, the hourly lists. Each trend's news flag is the local model's (2,901 labeled trends; the flag isn't checked trend by trend), and trends are matched on titles at 0.86.

Comparing news-driven trends with the rest across all lists mostly compares Google and Bluesky with Mastodon and Twitch. So the comparison here is inside each platform:

| Platform | Stays: news, rest | Median time in the top 10: news, rest | Still listed after 3 h: news, rest | Difference? |
| --- | --- | --- | --- | --- |
| X | 81, 500 | 2 h, 2 h | 29%, 28% | no (p = 0.97) |
| Hacker News | 117, 60 | 3 h, 3 h | 41%, 42% | no (p = 0.64) |
| Reddit | 44, 154 | 3 h, 2 h | 39%, 30% | no (p = 0.38) |
| Bluesky | 333, 41 | 1 h, 2 h | 25%, 32% | no (p = 0.14) |
| Google Trends (US) | 694, 73 | 1 h, 1 h | 0%, 0% | none that matters |

| Platform | Also on another list: news | The rest |
| --- | --- | --- |
| X | 27% of 79 | 20% of 538 |
| Google Trends (US) | 23% of 599 | 18% of 66 |
| Bluesky | 22% of 191 | 5% of 20 |
| Reddit | 16% of 62 | 3% of 272 |
| All hourly lists | 19% of 1,099 | 13% of 1,210 |

- **News-driven trends don't last longer on a list.** Inside X, Hacker News, Reddit and Bluesky the two kinds stay about as long. The large differences in lifespan are between lists, not between news and the rest.
- **They do spread a little more:** 19% against 13% over the hourly lists, and in the same direction on every platform. The gap is widest where the rest is personal or playful (Reddit's clips and jokes, 3%).
- **The calendar result shrank to its real size.** On the hourly lists a fifth of calendar trends are on another list (17 of 80), the same as sports, where the first runs suggested 35–40% from two stories.

So for the question as asked: a news story is no longer-lived than a meme on any one list, and somewhat more likely to be on a second one.

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
