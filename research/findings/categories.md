# Topic categories

**Status: first set labeled and checked (2026-10-01).**
- **What's labeled:** all 528 trends from the stored lists of 2026-09-30 11:32 to 2026-10-01 02:08 UTC (no YouTube).
- **How:** the local model drafted a category and a news flag for each; a person checked them. New trends get drafts on later runs; their checks come with each re-run.
- **Where they feed in:** RQ1's lifecycles by category and RQ4's news by kind.

## How

`topnews.categories`, tested in `tests/test_categories.py`.
- **The draft:** Qwen3.5-9B, running locally on this PC's GPU (`topnews.llm`), drafted one category per trend from `sports, politics, entertainment, tech, gaming, business, science, health, weather, incident, lifestyle, calendar, meme, other`. It also said whether a news event drives it. That took about 1 second per trend.
- **Context:** it saw where each trend was listed. For Google Trends and Hacker News, it also saw the site and the headline words of the article the trend linked to, which turned guesses into answers: "jorge kahwagi" became politics, from "fallecio el ex diputado jorge kahwagi".
- **The check:** a person checked every draft and corrected 61 of 528 (the model agreed on 88%). Most corrections:
  - weekday and observance hashtags (#TuneTuesday, #orangeshirtday) drafted as lifestyle or entertainment, which are calendar;
  - bare baseball names on X drafted as business or politics ("Mahle", "Wheeler");
  - wrestlers drafted as sports, which are entertainment.
- **The news flag** wasn't checked trend by trend. It's reliable where there's context (Google, Hacker News, Bluesky's sentences) and weak on X, whose titles are bare names.
- **Storage:** labels are kept per trend in the gitignored `research/data/categories.csv`; a later run asks only about new trends.

## Result

Each platform has a signature. These are shares of each platform's trends on one day, heavy on the MLB playoffs:

| Platform | Trends | Main categories |
| --- | --- | --- |
| Bluesky | 83 | politics 53%, sports 13%, entertainment 12% |
| Google Trends (US) | 119 | sports 53%, entertainment 15%, politics 12% |
| X | 80 | sports 50%, entertainment 16%, other 15% |
| Hacker News | 77 | tech 62%, science 19% |
| Twitch | 49 | gaming 98% |
| Mastodon | 41 | calendar 41%, meme 20% |
| TikTok | 30 | entertainment 33%, calendar 27%, lifestyle 17% |
| Pinterest | 25 | lifestyle 48%, calendar 24%, tech 16% (new iPhones) |
| Instagram | 15 | other 33%, calendar 20%, sports 20% |

By category, on the lists that refresh hourly: time in the top 10 allows one missed fetch (RQ1), and spread means matched on another list besides Google at 0.70 (RQ4's measure):

| Category | Stays (lists) | Median time in top 10 | Still listed after 3 h | Trends | Spread to another list | News-driven |
| --- | --- | --- | --- | --- | --- | --- |
| sports | 83 (3) | 1 h | 2% | 108 | **23%** | 60% |
| calendar | — | — | — | 37 | **22%** | 0% |
| gaming | 14 (4) | 1 h | 40% | 57 | 7% | 11% |
| tech | 30 (4) | 3 h | 43% | 62 | 5% | 55% |
| politics | 40 (2) | 1 h | 18% | 62 | **3%** | 95% |
| entertainment | 32 (3) | 2 h | 15% | 52 | 0% | 44% |
| business | 10 (3) | 1 h | 13% | 16 | 0% | 88% |
| lifestyle, meme, science, incident, weather | | | | 64 | 0% | |

- **The most news-driven category spreads least.** Politics is 95% news-driven, yet only 3% of its trends were matched on another list. It lives on Bluesky.
- **What crossed platforms was sports and calendar moments.** For RQ4, "news-driven" alone doesn't predict spread; the kind of news does.
- **Sports trends were the shortest-lived** (2% still in a top 10 after 3 hours). That's mostly Google's newest-first queue during the playoffs.
- **Tech lasted longest** (43% after 3 hours), mostly Hacker News's rise and fall (RQ1).
- **Category and platform are tangled.** Sports is mostly Google and X, tech mostly Hacker News, and politics mostly Bluesky. Separating them, for example category within one platform, needs more days.

## What it means for the forecasts

- **Category is a feature.** For breakout, sports and calendar moments are the candidates, politics rarely is. For lifespan, a sports trend's time on a list is short.
- **Calendar moments recur, and they cross platforms.** Together with Wikipedia's yearly peaks, they're the weeks horizon's first case.
- **Labels carry over to topics.** Once topic snapshots exist, a topic takes the category its member trends agree on, which is RQ1's categories without clustering the centroids first. Clustering can still check it.

## Limits

- One day, heavy on the MLB playoffs, and one person's check.
- The categories are a fixed list. "Other" holds X's bare names that even context couldn't place.
- Matching for spread used the research default at the time (all-minilm-l6-v2 at 0.70). The pipeline has since moved to nomic-embed-text-v1.5 (task 2.15), and the next re-run will use it.
