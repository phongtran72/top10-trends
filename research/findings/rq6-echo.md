# RQ6 · Echo chambers

**Status: preliminary (2026-09-30).** One day of the phase-1 lists, and two hourly runs with every list. The pattern is already strong: almost every trend stays on its own platform.
- Re-run `notebooks/06_rq6_echo.ipynb` weekly.
- Once topic snapshots exist (after phase 2), repeat it on them: a topic's `platform_count` answers the same question with the pipeline's own matching.
- The numbers below use the pipeline as of phase-2 377374f: hashtag splitting (task 2.13) and embeddings one title at a time.

## Question

What share of each platform's trends appears on no other platform? The answer shows how much each platform has its own conversation and which platforms share stories. It also shows how rare a breakout (3 or more platforms) is, which sets the balance of the forecasts' labels.

## Data

- Stored lists (`trend_items`) from 2026-09-30 11:32 to 23:08 UTC.
- **Cut A:** the five phase-1 lists over the whole stretch (Bluesky, Google Trends, Hacker News, Mastodon and Twitch). That's 301 trends after the filters.
- **Cut B:** every list, over the 22:08 and 23:07 runs, the first two with X, TikTok, Instagram and Pinterest. That's 217 trends.
- Two lists are missing. YouTube is left out because its policy forbids derived metrics, and Reddit isn't collected yet.
- No `algo_version`, since this reads the lists before any matching.

## Method

`topnews.echo`, tested in `tests/test_echo.py`.

- **Trend:** one platform's distinct item, keyed by url for Bluesky and Hacker News and by title elsewhere. It carries its first and last sighting.
- **Titles:** each title goes through the pipeline's own filters, text cleanup and model (`scripts/embed-titles.ts`, which uses `lib/title-vectors.ts`). That way "the same story" means what it means on the site.
  - As in the rank step, a hashtag's run stays whole when the other titles in its hour use it as a plain word; here that's the hour the trend was first seen.
  - The filters that read unstored flags (NSFW and Bluesky's status) can't run.
- **Match:** two trends on different platforms match when their titles are at least 0.60 alike and their sightings are within 24 hours. 0.60 is the value phase 2's replay chose; the notebook also shows 0.50 to 0.80.
- **Upper bound:** this compares trend with trend. The pipeline matches items to topic centroids and adds Google's headlines, so it may merge a little differently.

## Result

Share of each platform's trends with no match on any other list, at 0.60:

| Platform | Cut A: phase-1 lists, whole day | Cut B: every list, two runs |
| --- | --- | --- |
| Hacker News | 99% | 92% |
| Mastodon | 97% | 100% |
| Bluesky | 94% | 91% |
| Google Trends (US) | 94% | 79% |
| Twitch | 93% | 92% |
| TikTok | not collected | 93% |
| Pinterest | not collected | 84% |
| X | not collected | 73% |
| Instagram | not collected | 67% |

- **Sharing runs through X, Google and Instagram,** mostly on sports and news names.
- **TikTok, Pinterest, Twitch, Hacker News and Mastodon each run their own conversation.** TikTok and Pinterest share one story: "#firstdayoffall", and Pinterest's "first day of fall" searches.
- **Reaching 3 or more platforms is rare.** Over the whole day, only 2 stories truly did:
  - the MLB wild card round, above all the Phillies–Braves game (Google, X, Bluesky, Instagram);
  - Jack Smith's Senate testimony (Instagram, Bluesky, Mastodon).
- **The matches are right at high similarity and unreliable near 0.60.** A hand check of each trend's best match (26 pairs, made before hashtag splitting):

| Similarity | Right | Examples |
| --- | --- | --- |
| 0.80 and up | 8 of 8 | "astros" and "Astros"; "Gemini 4 Argon" on Hacker News and X |
| 0.65 to 0.80 | 6 of 7 | wrong: "yankees" and "Astros" |
| 0.60 to 0.65 | 3 of 6 | wrong: "Jorge Jesus" and "jorge kahwagi", "Dom Smith" and "jack smith" |
| 0.55 to 0.60 | 2 of 5 | wrong: "Grand Theft Auto V" and a GTA VI story, "phil mickelson" and "Phillies" |

  Since then, the second run added another short-name error: "cam smith" and "Dom Smith", between 0.65 and 0.70.

## Hashtag splitting (task 2.13)

The pipeline now splits hashtags written as one lowercase word, so "#nationalcoffeeday" becomes "national coffee day". It keeps a run whole when the same hour's titles use it as a plain word. Compared on the same titles with splitting off and on (`scripts/embed-titles.ts --no-segment`), embedding one at a time:

| Pair | Right? | Off | On |
| --- | --- | --- | --- |
| #firstdayoffall · first day of fall | yes | 0.60 | 1.00 |
| #jacksmith · jack smith | yes | 0.59 | 1.00 |
| #nationalcoffeeday · national coffee day | yes | 0.53 | 1.00 |
| #nationsleague · nations league | yes | 0.77 | 1.00 |
| #flydubai · Flydubai flight diverts to Saudi Arabia | yes | 0.59 | 0.59 (kept whole) |
| #nationsleague · nation (Instagram) | no | below 0.60 | 0.64 |
| yankees · Astros | no | 0.70 | 0.70 |
| Jorge Jesus · jorge kahwagi | no | 0.64 | 0.64 |
| Dom Smith · jack smith | no | 0.61 | 0.61 |

- **Splitting rescues the right tag matches and loses none.** Over all the data at 0.60, 10 trends gained a match, 8 of them rightly, and none lost one.
- **Short names aren't affected.** Their errors run from 0.61 to 0.70.
- **0.65 to 0.70 is also about half right.** It holds:
  - 3 right matches: "mlb playoffs" and "MLB wild card series begins", "Deadlock", "#jacksmith" and a Jack Smith story;
  - 3 wrong: "yankees" and "Astros", two different Senate bills, "cam smith" and "Dom Smith";
  - 1 unclear.

  So a stricter threshold trades right matches for fewer wrong ones, and at 0.70 it would also drop "Mahle" and "tyler mahle" (0.704).

## Batch noise in the embeddings (fixed)

Until phase-2 377374f, the pipeline embedded titles in batches of 64, and the 8-bit model's output depended slightly on a title's batch-mates.
- **Measured:** embedding the 369 titles twice in shuffled order moved pair similarities by up to 0.06. 11 of the 111 pairs at or above 0.60 fell on opposite sides of it (7 of 80 at 0.65).
- **The fix:** the pipeline now embeds one title at a time. The same check now gives identical vectors and no flips, at about 0.2 s more per run.
- **Earlier numbers:** some from before the fix were noise. "#flydubai" matched at 0.61 only by chance; it's 0.59 one at a time.

## Re-run on the pipeline's new matcher (2026-10-01)

The pipeline moved to nomic-embed-text-v1.5 at a threshold of 0.86 (task 2.15, `findings/matching.md`). Research now reads its threshold from the pipeline's config, and the data runs to 2026-10-01 03:08 UTC: 17 hours of the phase-1 lists (376 trends) and 6 hours with every list (342 trends). The numbers above were made with all-minilm-l6-v2 at 0.60.

Share of each platform's trends with no match on any other list:

| Platform | Cut A: phase-1 lists, 17 hours | Cut B: every list, 6 hours |
| --- | --- | --- |
| Hacker News | 100% | 94% |
| Mastodon | 97% | 100% |
| Twitch | 96% | 94% |
| Bluesky | 93% | 90% |
| Google Trends (US) | 93% | 75% |
| TikTok | not collected | 90% |
| Instagram | not collected | 73% |
| X | not collected | 72% |
| Pinterest | not collected | 72% |

- **The picture holds:** most trends stay on their own platform, and sharing runs through Google and X (25% of Google's trends were also on X), Instagram, and Pinterest with TikTok (28% of Pinterest's trends, the fall and yellow-flower searches).
- **Four stories reached 3 or more platforms:**
  - the Phillies–Braves game (Google, X, Bluesky, Instagram);
  - the Yankees–Red Sox game (the same four);
  - Jack Smith's testimony (Instagram, Bluesky, Mastodon);
  - Ronaldo leaving Portugal's camp (Google, X, Bluesky).
- **Matches just above 0.86 are nearly all right.** Of the 23 trends between 0.86 and 0.90, the wrong ones are "Luis Rojas" with "luis garcia" and X's "Flores" with TikTok's "#floresamarillas".

## TikTok pairs only with Pinterest (2026-10-01)

TikTok's list describes the week before (see Limits), so the pipeline no longer matches or scores it (task 2.16, `UNSCORED_SOURCES`). Research follows with a narrower rule, `echo.LAGGED_PARTNERS`: TikTok is compared only with Pinterest, whose 30-day window covers TikTok's week, and never with the hourly lists. Every tool built on these matches (lead and lag, breakout, news and memes, the baselines) inherits it.

Measured on the stored lists to 2026-10-01 12:08 UTC (718 trends over 26 hours), with the rule off and on:

- **Two matches go.** Both paired TikTok with an hourly list:
  - Twitch's "Aniimo" with "#aniimo" (1.00): the same game, a week apart;
  - X's "Flores" with "#floresamarillas" (0.90): a wrong match.
- **TikTok with Pinterest stays:** "#firstdayoffall" and "#floresamarillas", with 7 of Pinterest's 25 searches.
- **The shares barely move:** TikTok's trends found nowhere else go from 87% to 90%, Twitch's from 93% to 95%, and no other list changes.
- **Still wrong:** X's "Flores" now pairs with Pinterest's "flores amarillas" searches at 0.865. That's the short-name problem, not the lag, so the rule doesn't touch it.

## What it means for the forecasts

- **Breakouts are rare, so the labels will be very unbalanced.** Perhaps two stories a day reach 3 or more platforms. A 60% precision target has to be judged against that low base rate. "2 or more platforms" may be worth adding as an easier, more common label.
- **Cross-platform forecasts will mostly be about news and sports names on X, Google and Instagram.** Trends on TikTok, Pinterest, Twitch and Hacker News are mostly native to their platform. For creators, a TikTok-only trend is a TikTok opportunity, not an early sign of a wider story.
- **Matching quality bounds every cross-platform label.** Splitting and one-at-a-time embedding fixed two of the three problems found here. The third, short names that pass as different people or teams, is task 2.9's threshold question. Here both 0.60–0.65 and 0.65–0.70 run about half right. So any threshold in that range trades wrong merges against missed ones, and the week-long replay should decide. For research labels, a stricter threshold (0.70) with a check by hand of the stories that cross platforms is the safer choice.

## Limits

- One day, and only two runs with every list.
- TikTok (7 days) and Pinterest (30 days) cover windows much longer than the data they're matched against, so they can look lonelier than they are.
- TikTok's list also lags. On 2026-10-01 its 7-day window was 2026-09-21 to 2026-09-27, so its hashtags describe the week before. A match between TikTok and a fast list is the same story a week apart, not at the same time; TikTok with Pinterest (the first day of fall) matches because Pinterest's window is 30 days. Since 2026-10-01 the tools compare TikTok only with Pinterest (the section above); the tables before that section still include TikTok's matches with the hourly lists.
- Only titles: stored lists keep no headlines, which the pipeline uses for Google and for deciding which runs to keep whole.
- YouTube and Reddit are missing, so "nowhere else" means none of these nine lists.
- The hand check is small, and near 0.60 it runs about half right. From 0.60 up, every list except X, Google and Instagram stays at 84% or more alone in both cuts.
