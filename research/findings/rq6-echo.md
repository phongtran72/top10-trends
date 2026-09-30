# RQ6 · Echo chambers

**Status: preliminary (2026-09-30).** One day of the phase-1 lists, and one hour with every list. The pattern is already strong: almost every trend stays on its own platform. Re-run `notebooks/06_rq6_echo.ipynb` weekly. Once topic snapshots exist (after phase 2), repeat it on them: a topic's `platform_count` answers the same question with the pipeline's own matching.

## Question

What share of each platform's trends appears on no other platform? The answer shows how much each platform has its own conversation and which platforms share stories. It also shows how rare a breakout (3 or more platforms) is, which sets the balance of the forecasts' labels.

## Data

- Stored lists (`trend_items`) from 2026-09-30 11:32 to 22:08 UTC: 1,470 rows and 401 distinct trends, of which the filters kept 369.
- **Cut A:** the five phase-1 lists over the whole stretch (Bluesky, Google Trends, Hacker News, Mastodon and Twitch), 13 fetches each. That's 283 trends.
- **Cut B:** every list at the 22:08 UTC run, the first one with X, TikTok, Instagram and Pinterest. That's 185 trends.
- Two lists are missing. YouTube is left out because its policy forbids derived metrics, and Reddit isn't collected yet.
- No `algo_version`, since this reads the lists before any matching.

## Method

`topnews.echo`, tested in `tests/test_echo.py`.

- **Trend:** one platform's distinct item, keyed by url for Bluesky and Hacker News and by title elsewhere. It carries its first and last sighting.
- **Titles:** each title goes through the pipeline's own filters, text cleanup and model (`scripts/embed-titles.ts`, which uses `lib/title-vectors.ts`). That way "the same story" means what it means on the site. The filters that read unstored flags (NSFW and Bluesky's status) can't run.
- **Match:** two trends on different platforms match when their titles are at least 0.60 alike and their sightings are within 24 hours. 0.60 is the value phase 2's replay chose; the notebook also shows 0.50 to 0.80.
- **Upper bound:** this compares trend with trend. The pipeline matches items to topic centroids and adds Google's headlines, so it may merge a little differently.

## Result

Share of each platform's trends with no match on any other list, at 0.60:

| Platform | Cut A: phase-1 lists, whole day | Cut B: every list, one hour |
| --- | --- | --- |
| Hacker News | 98% | 91% |
| Bluesky | 96% | 88% |
| Mastodon | 96% | 94% |
| Google Trends (US) | 95% | 78% |
| Twitch | 95% | 100% |
| TikTok | not collected | 97% |
| Pinterest | not collected | 96% |
| X | not collected | 71% |
| Instagram | not collected | 70% |

- **Sharing runs through X, Google and Instagram.** In cut B, 22% of Google's trends were also on X, and 30% of Instagram's were too. They share sports and news names.
- **TikTok, Pinterest, Twitch and Hacker News each run their own conversation.** TikTok and Pinterest matched only each other, on one story ("#firstdayoffall" and "first day of fall").
- **Reaching 3 or more platforms is rare.** Over the whole day, only 2 stories truly did, out of 369 trends:
  - the MLB wild card round, above all the Phillies–Braves game (Google, X, Bluesky, Instagram);
  - Jack Smith's Senate testimony (Instagram, Bluesky, Mastodon).

  A third, the Astros, reached 3 only through a wrong match with Instagram's "yankees".
- **The matches are right at high similarity and unreliable near 0.60.** A hand check of each trend's best match, over all the data:

| Similarity | Right | Examples |
| --- | --- | --- |
| 0.80 and up | 8 of 8 | "astros" and "Astros"; "Gemini 4 Argon" on Hacker News and X |
| 0.65 to 0.80 | 6 of 7 | wrong: "yankees" and "Astros" (0.68) |
| 0.60 to 0.65 | 3 of 6 | wrong: "Jorge Jesus" and "jorge kahwagi", "Dom Smith" and "jack smith"; right: "#firstdayoffall" and "first day of fall" |
| 0.55 to 0.60 | 2 of 5 | wrong: "Grand Theft Auto V" and a GTA VI story, "phil mickelson" and "Phillies" |

## What it means for the forecasts

- **Breakouts are rare, so the labels will be very unbalanced.** Perhaps two stories a day reach 3 or more platforms. A 60% precision target has to be judged against that low base rate. "2 or more platforms" may be worth adding as an easier, more common label.
- **Cross-platform forecasts will mostly be about news and sports names on X, Google and Instagram.** Trends on TikTok, Pinterest, Twitch and Hacker News are mostly native to their platform. For creators, a TikTok-only trend is a TikTok opportunity, not an early sign of a wider story.
- **Matching quality bounds every cross-platform label.** Two problems showed up, both matters for task 2.9:
  - short names pass 0.60 as different people or teams;
  - hashtags written as one lowercase word match plain text poorly. That's 47% of TikTok's titles and 28% of Mastodon's, and "#nationalcoffeeday" scored 0.53 against "national coffee day".

  Splitting those hashtags into words would let a stricter threshold, such as 0.65, keep the right matches.

## Limits

- One day, and only one hour with every list. X, TikTok, Instagram and Pinterest have a single fetch each.
- TikTok (7 days) and Pinterest (30 days) cover windows much longer than the data they're matched against, so they can look lonelier than they are.
- Only titles: stored lists keep no headlines, which the pipeline uses for Google.
- YouTube and Reddit are missing, so "nowhere else" means none of these nine lists.
- The hand check is small, 26 pairs, and near 0.60 it runs about half right, so the headline shares move a few points with the threshold. From 0.55 up, every list except X, Google and Instagram stays at 88% or more in both cuts.
