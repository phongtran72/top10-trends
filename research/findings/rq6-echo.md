# RQ6 · Echo chambers

**Status: preliminary (2026-09-30; updated the same day for task 2.13's hashtag splitting).** One day of the phase-1 lists, and one hour with every list. The pattern is already strong: almost every trend stays on its own platform. Re-run `notebooks/06_rq6_echo.ipynb` weekly. Once topic snapshots exist (after phase 2), repeat it on them: a topic's `platform_count` answers the same question with the pipeline's own matching.

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

Share of each platform's trends with no match on any other list, at 0.60. Cut B is shown before and after task 2.13's hashtag splitting (see below). Cut A barely changes with splitting, and repeated runs move it by up to 2 points (batch noise, below).

| Platform | Cut A: phase-1 lists, whole day | Cut B, before splitting | Cut B, with splitting |
| --- | --- | --- | --- |
| Hacker News | 98% | 91% | 91% |
| Bluesky | 96% | 88% | 92% |
| Mastodon | 96% | 94% | 100% |
| Google Trends (US) | 95% | 78% | 78% |
| Twitch | 95% | 100% | 100% |
| TikTok | not collected | 97% | 93% |
| Pinterest | not collected | 96% | 80% |
| X | not collected | 71% | 71% |
| Instagram | not collected | 70% | 60% |

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

The hand check was made before hashtag splitting.

## Hashtag splitting (task 2.13)

The pipeline now splits hashtags written as one lowercase word ("#nationalcoffeeday" becomes "national coffee day"). The same data was compared with splitting off and on (`scripts/embed-titles.ts --no-segment`):

| Pair | Right? | Off | On |
| --- | --- | --- | --- |
| #firstdayoffall · first day of fall | yes | 0.60 | 1.00 |
| #jacksmith · jack smith | yes | 0.62 | 1.00 |
| #nationalcoffeeday · national coffee day | yes | 0.52 | 1.00 |
| #nationsleague · nations league | yes | 0.76 | 1.00 |
| #flydubai · Flydubai flight diverts to Saudi Arabia | yes | 0.61 | 0.45 |
| yankees · Astros | no | 0.70 | 0.66 |
| Jorge Jesus · jorge kahwagi | no | 0.66 | 0.63 |

- **Splitting rescues the right tag matches,** at 0.60 and at 0.65. Pinterest's "first day of fall" searches now match TikTok's tag, which is why Pinterest drops from 96% to 80% alone.
- **Brands suffer.** "#flydubai" becomes "fly dubai", while Bluesky's sentence keeps "Flydubai" as one word, so that match is lost.
- **Short names aren't affected,** because splitting touches only hashtags and single-word titles, and names aren't over-split ("kahwagi", "astros" and "hegseth" stay whole). Their small changes are batch noise.

## Batch noise in the embeddings

The pipeline embeds titles in batches of 64. The 8-bit model scales its values over the whole padded batch, so a title's vector depends a little on its batch-mates.
- **Measured:** embedding the 369 titles twice in shuffled order moved pair similarities by a median of 0.008, a 99th percentile of 0.034 and at most 0.06.
- **Effect:** 11 of the 111 pairs at or above 0.60 fell on opposite sides of it between the two orderings (7 of 80 at 0.65, 2 of 50 at 0.70). A borderline match can merge one hour and not the next.
- **Fix:** embedding one title at a time gives identical vectors in any order, and took 0.4 s instead of 0.2 s per 400 titles.

This is sent to the web-app session for task 2.9. Until it's fixed, RQ6's shares move by a point or two between runs.

## What it means for the forecasts

- **Breakouts are rare, so the labels will be very unbalanced.** Perhaps two stories a day reach 3 or more platforms. A 60% precision target has to be judged against that low base rate. "2 or more platforms" may be worth adding as an easier, more common label.
- **Cross-platform forecasts will mostly be about news and sports names on X, Google and Instagram.** Trends on TikTok, Pinterest, Twitch and Hacker News are mostly native to their platform. For creators, a TikTok-only trend is a TikTok opportunity, not an early sign of a wider story.
- **Matching quality bounds every cross-platform label.** Three problems showed up, all matters for task 2.9:
  - short names pass 0.60 as different people or teams;
  - hashtags written as one lowercase word matched plain text poorly. That's 47% of TikTok's titles and 28% of Mastodon's. Task 2.13's splitting now fixes this, except for brands written as one word elsewhere;
  - batch noise flips about 1 in 10 borderline matches.

  With splitting in place, a stricter threshold such as 0.65 keeps the right tag matches and drops some short-name errors.

## Limits

- One day, and only one hour with every list. X, TikTok, Instagram and Pinterest have a single fetch each.
- TikTok (7 days) and Pinterest (30 days) cover windows much longer than the data they're matched against, so they can look lonelier than they are.
- Only titles: stored lists keep no headlines, which the pipeline uses for Google.
- YouTube and Reddit are missing, so "nowhere else" means none of these nine lists.
- The hand check is small, 26 pairs, and near 0.60 it runs about half right, so the headline shares move a few points with the threshold. From 0.55 up, every list except X, Google and Instagram stays at 88% or more in both cuts.
