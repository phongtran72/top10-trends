# Wikipedia pageviews (task 5.8, first outside source)

**Status: research module working (2026-10-01).** `topnews.wiki` links topics to English Wikipedia articles and reads their daily views since July 2015, with no key. `notebooks/08_wikipedia.ipynb` runs it. A pipeline collector waits until a model needs these figures live.

## What it gives

- **How known a topic was before it trended:** the median daily views of its article over the 28 days before. That's a feature for lifespan: a famous name and a new one fade differently.
- **How big it got:** views on the day it trended against that baseline. Wikimedia publishes each day's figures about a day later, so this works for the days and weeks horizons and for research labels, not for alerts within hours.
- **Seasons and calendar moments:** which months an article peaks in, across years. It's the history our own data won't have for a year.

## First results (topics that reached the top 10 in the replay of 2026-09-30)

- **Linking.** Of 62 topics:
  - **32 got an exact link.** All the trend's words are in the article title, or the title covers at least half the trend. 30 of those aren't disambiguation pages, and they're right for names and places ("ronaldo" → Cristiano Ronaldo, "flyers" → Philadelphia Flyers, "strait of hormuz news" → Strait of Hormuz). A lone first name, such as X's "Reggie", stays ambiguous.
  - **22 got a partial link, about half of them right.** Bluesky's sentence titles mostly fail: "Schmitt confuses Hawks with Hawkeyes" found "Gulf War". 5 got no match and 3 found nothing.
  - **Only exact, non-disambiguation links are used.**
- **How known before.** The day's top-10 topics ranged from Cristiano Ronaldo (19,499 views a day) and Novak Djokovic (8,311) down to playoff pitchers with about 100 a day (Hunter Brown, Andrew Painter, Tyler Mahle). Several names that trended on X and Google were near-unknowns the day before, which is the "new name" case for lifespan.
- **How big.** Not yet: 2026-09-30's figures weren't published when this ran. The module reports them as unknown, not as 0.
- **Seasons.** Each calendar moment's article peaks in its month, every year. Median daily views that month against the article's overall median, over 2016–2025:

| Article | Peak month | vs. overall |
| --- | --- | --- |
| National Day for Truth and Reconciliation | September | 6.7× |
| Fat Bear Week | October | 4.6× (September 3.4×) |
| International Coffee Day | September | 3.4× |
| Autumn | September | 2.4× (October 2.0×) |

## What it means for the forecasts

- **For lifespan models:** "how known before" is ready as a feature for exact-linked topics. A day-of-the-trend spike follows a day later, for the days horizon and for labels.
- **For the weeks horizon:** an article's yearly profile can say when a calendar moment comes back, and how big it was last time, which RQ4 found our own data can't. A day-of-year profile, finer than months, is the next step for one-day events.
- **For linking:** searching on Bluesky's sentence titles needs something better before it's used, such as the topic's label from a lead list, or names pulled from the sentence.

## Limits and care

- English Wikipedia only, and daily: no hours.
- Linking depends on Wikipedia's search, so check the links by eye.
- Days before an article existed (Fat Bear Week's starts in October 2022), and days not yet published, are unknown rather than 0.
- Requests go one at a time with the repository's URL as the User-Agent, as Wikimedia asks, and are cached in the gitignored `research/data/wiki/`.
