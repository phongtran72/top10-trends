# Topic categories

**Status: five sets labeled and checked (2026-10-02).**
- **What's labeled:** all 1,332 trends from the stored lists of 2026-09-30 11:32 to 2026-10-02 03:08 UTC (no YouTube). The first set was the 528 trends up to 02:08 UTC; the second set, 348 more, is in *Second set* below; the third, 245 more, in *Third set*; the fourth, 127 more, in *Fourth set*; the fifth, 84 more, in *Fifth set*.
- **How:** the local model drafted a category and a news flag for each, and every draft was then checked. New trends get drafts on later runs; their checks come with each re-run.
- **Who checked:** the research assistant (Claude, which also writes these notes), not the owner. Where this page says "checked", that's what it means.
- **Where they feed in:** RQ1's lifecycles by category and RQ4's news by kind.

## How

`topnews.categories`, tested in `tests/test_categories.py`.
- **The draft:** Qwen3.5-9B, running locally on this PC's GPU (`topnews.llm`), drafted one category per trend from `sports, politics, entertainment, tech, gaming, business, science, health, weather, incident, lifestyle, calendar, meme, other`. It also said whether a news event drives it. That took about 1 second per trend.
- **Context:** it saw where each trend was listed. For Google Trends and Hacker News, it also saw the site and the headline words of the article the trend linked to, which turned guesses into answers: "jorge kahwagi" became politics, from "fallecio el ex diputado jorge kahwagi".
- **The check:** every draft of the first set was checked, and 61 of 528 were corrected (the model agreed on 88%). Most corrections:
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

## Second set (2026-10-01, data to 13:07 UTC)

348 more trends: 310 new ones, and 38 drafted earlier but not yet checked. They include the first 30 Reddit posts and X's worldwide list.

**The check corrected 65 of 348** (the model agreed on 81%; over all 876 trends, 126 corrected, 86%).

| Platform | Checked | Corrected | Model agreed |
| --- | --- | --- | --- |
| Hacker News | 24 | 0 | 100% |
| Twitch | 9 | 0 | 100% |
| Google Trends (US) | 98 | 6 | 94% |
| Instagram | 9 | 1 | 89% |
| Bluesky | 30 | 7 | 77% |
| Mastodon | 20 | 5 | 75% |
| Reddit | 30 | 8 | 73% |
| X | 128 | 38 | 70% |

- **The model is right where it has context and wrong on bare names.** With an article link (Google, Hacker News) it agreed on 94–100%. X's bare names need the hour's other trends to place:
  - "Crochet" was drafted as lifestyle; it's the Red Sox pitcher, in the hour of the Yankees–Red Sox game;
  - "HOLY SHEETS" was drafted as a meme; it's Gavin Sheets's home run;
  - "Hilton" was drafted as business; it's Steve Hilton in the California governor debate;
  - "Porter", "Pickens" and "Palencia" were drafted as other; all three are players Google listed in the same hours.
- **It read one name as a word.** "jihad ward" (a Giants signing) was drafted as an incident.
- **Protests were drafted as incidents.** They're politics here; incident is kept for accidents, crimes and disasters.
- **Reddit posts are hard to place.** A title such as "Permanent" or "Peetah ??" says little, and the stored link doesn't name the subreddit. 13 of 30 ended as other.
- **X's worldwide list is mostly not English.** 80 of X's 208 trends were dropped by the pipeline's filters, nearly all for language (Japanese, Thai, Hindi, Indonesian). They got labels too, with a lighter check, and they're left out of the tables below.

**Platform signatures**, on the 747 trends the pipeline's filters keep:

| Platform | Trends | Main categories |
| --- | --- | --- |
| Google Trends (US) | 199 | sports 48%, entertainment 17%, politics 9% |
| X | 128 | sports 45%, entertainment 16%, other 16% |
| Bluesky | 116 | politics 47%, sports 13%, entertainment 11% |
| Hacker News | 93 | tech 67%, science 13%, business 10% |
| Twitch | 56 | gaming 98% |
| Mastodon | 49 | calendar 51%, other 16%, meme 10% |
| TikTok | 30 | entertainment 33%, calendar 27%, lifestyle 17% |
| Reddit | 27 | other 44%, politics 19%, incident 7% |
| Pinterest | 25 | lifestyle 48%, calendar 24%, tech 16% |
| Instagram | 24 | other 33%, sports 21%, calendar 17% |

The signatures held on the second day's data: each platform's top category is the same as in the first set.

**By category**, on the pipeline's matcher (nomic-embed-text-v1.5 at 0.86), with TikTok compared only with Pinterest. Spread means matched on another list besides Google. Stays, as before, are on the hourly lists and allow one missed fetch.

| Category | Trends, every list | Spread, every list | Trends, hourly lists | Spread, hourly lists | Stays | Median time in top 10 | Still listed after 3 h | News-driven |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sports | 175 | **27%** | 169 | **25%** | 140 | 1 h | 6% | 67% |
| calendar | 60 | **25%** | 42 | 7% | 14 | 7 h | 76% | 0% |
| politics | 91 | 10% | 89 | 8% | 68 | 1 h | 20% | 89% |
| gaming | 75 | 8% | 73 | 8% | 29 | 1 h | 22% | 19% |
| incident | 26 | 8% | 25 | 8% | 21 | 1 h | 18% | 100% |
| other | 59 | 7% | 50 | 6% | 19 | 2 h | 29% | 16% |
| entertainment | 86 | 6% | 73 | 5% | 60 | 1 h | 17% | 59% |
| tech | 81 | 4% | 75 | 4% | 44 | 3 h | 46% | 65% |
| business | 25 | 0% | 25 | 0% | 14 | 1 h | 15% | 80% |
| meme, lifestyle, science, health, weather | 69 | 3% | 47 | 2% | | | | |

- **Correction: calendar moments cross platforms mostly through the slow lists.** Over every list, 15 of 60 calendar trends were matched elsewhere (25%), close to sports. But 12 of those 15 are on Instagram, Pinterest or TikTok, and the TikTok–Pinterest ones (the first day of fall, the yellow flowers) are a week apart by TikTok's lag. On the hourly lists it's 3 of 42 (7%), all Mastodon tags matched with Instagram: #nationalcoffeeday, #orangeshirtday and #internationalcoffeeday.
  - The table in *Result* above gave calendar 22% under a heading that said hourly lists. Its spread column covered every list; only its stays columns were hourly. The 30% in *Limits* was also over every list.
  - One of the three is loose: #internationalcoffeeday (October 1) matched Instagram's "national coffee day" (September 29) at 0.93. They're two occasions.
- **Sports is the only category that clearly spreads on the hourly lists:** 43 of 169 trends, 25%. Every other category is at 8% or less.
- **Politics is at 8%** (3% on the old matcher, 6% on this one a day earlier). Seven politics trends crossed: Jack Smith's testimony, the Pentagon naming Musk and Gingrich (Bluesky and Reddit), Kaliningrad, and US–Iran. It's still far below sports, though 89% news-driven.
- **Calendar trends stay longest** (median 7 hours, 76% still listed after 3 hours), though from only 14 stays. Sports stays shortest (6% after 3 hours), still mostly Google's newest-first queue.

## Third set (2026-10-01, data to 20:08 UTC)

245 more trends, drafted and checked for the category classifier (task 5.14, `findings/category-model.md`). The tables above aren't re-run on them.

- **The check corrected 50 of 245** (the model agreed on 80%). Over all 1,121 trends, 176 are corrected (84% agreed).
- **The store now says which labels were checked** (`checked` in `research/data/categories.csv`), so a model is scored only on checked labels. All 1,121 are.
- **The same kinds of error as before:**
  - bare names on X: "Ray Kerr" (a Braves pitcher) drafted as entertainment, "Denmark" and "#grened" (football matches) as politics and a meme;
  - a word read as its everyday meaning: "korn ferry tour" (golf) drafted as an incident;
  - hashtags on Mastodon: "#tbt" and "#musiquinta" (weekday tags) drafted as a meme and other, "#gersrb" (Germany–Serbia) as other.
- **One rule made explicit:** a celebrity's arrest or court case takes the celebrity's category ("rick ross battery charge" is entertainment), and incident is kept for people known only for the event.

## Fourth set (2026-10-02, data to 00:08 UTC)

127 more trends, checked the same way: 21 corrected (the model agreed on 83%). All 1,248 trends are now checked, with 197 corrected (84% agreed). X's bare names were again the weak spot (12 of 46 corrected): "Kevin Warren" and "Taylor Rooks" (sports) drafted as other and entertainment, "#LightningStrikes" (the hockey team) as an incident.

## Fifth set (2026-10-02, data to 03:08 UTC)

84 more trends: 15 corrected (the model agreed on 82%). All 1,332 trends are checked, with 212 corrected (84% agreed). Most were Thursday Night Football names on X, which the model drafted as other ("Boswell", "Igor", "Jaleel McLaughlin").

## What it means for the forecasts

- **Category is a feature.** For breakout, sports and calendar moments are the candidates, politics rarely is. For lifespan, a sports trend's time on a list is short.
- **Calendar moments recur.** Together with Wikipedia's yearly peaks, they're the weeks horizon's first case. Whether they cross platforms at the same time isn't shown yet: so far they cross through the slow lists (*Second set*).
- **Labels carry over to topics.** Once topic snapshots exist, a topic takes the category its member trends agree on, which is RQ1's categories without clustering the centroids first. Clustering can still check it.

## Limits

- Two days, heavy on the MLB playoffs, and one reviewer's check: the research assistant's, not the owner's. Titles in Japanese, Thai, Hindi and Indonesian got a lighter check.
- The news flag still isn't checked trend by trend. On Hacker News the model flags most stories as news, including tools and essays.
- The categories are a fixed list. "Other" holds X's bare names that even context couldn't place.
- Matching for the spread column used all-minilm-l6-v2 at 0.70. Re-run on the pipeline's new matcher (nomic-embed-text-v1.5 at 0.86, data to 2026-10-01 03:08 UTC), spread is higher for every kind and the order holds: calendar 30%, sports 29%, gaming 10%, politics 6%, tech 5%, entertainment 2%. Those trends are checked in *Second set*.
