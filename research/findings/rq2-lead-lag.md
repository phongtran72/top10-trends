# RQ2 · Lead and lag

**Status: first result for Google against X (2026-10-04, below); other pairs still too few. As first written (2026-09-30):** Only one usable story pair so far. The main obstacle is that X, TikTok, Instagram and Pinterest joined the data at 22:08 UTC. Everything they had then is censored, meaning we can't tell when it really started. Re-run `notebooks/02_rq2_leadlag.ipynb` weekly.
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

## Re-run on the pipeline's new matcher (2026-10-01)

This uses nomic-embed-text-v1.5 at the pipeline's 0.86, with data to 2026-10-01 03:08 UTC, and a stricter censoring rule: a sighting from before the other source was collected can't be compared, because that source may have had the story too, unseen. Google's "flyers" at noon against X's "Flyers" after midnight is no 13-hour lead: X joined at 22:08.

- **Counts:** 26 stories and 42 story pairs, of which 29 are censored and 13 usable.
- **Google against X, 8 stories:** Google had it first in 5, 3 were ties, and X was never first. The median lead is 1 hour: "max fried" and the MLB wild card 2 hours, "sonny gray", "willson contreras" and the Dream–Mystics game 1 hour.
- **Bluesky against Google, 3 stories:** Google first twice (the Phillies game by 4 hours, Ronaldo by 2), Bluesky once (the US–Iran proposals by 1 hour).
- **One each:** Bluesky before X by 3 hours (the Christa Pike case), and Twitch before Bluesky by 1 hour (Silent Hill: Townfall).

That's a first sign, on one evening of playoff baseball, that Google's feed shows a story about an hour before X's list does. It fits how the lists work: Google lists a trend as it starts, and X's list ranks by size.

## First result: Google against X (2026-10-04)

Stored lists from 2026-09-30 11:32 to 2026-10-04 21:08 UTC, Google's US feed only (`leadlag.one_clock`), matched on titles at 0.86.

- **191 stories on two or more lists; 280 pairs of platforms within them.** 45 are censored and 53 involve a slow list, which leaves 203 usable pairs.
- **Google against X has 118 stories,** enough for a first answer:

| | Share of stories |
| --- | --- |
| Google listed it first | 54% |
| Within half an hour of each other | 26% |
| X listed it first | 19% |

  - **The median lead is 1 hour for Google;** half the stories fall between a tie and Google 4 hours ahead.
  - **It holds day by day:** Google first in 43% to 67% of each day's stories, X first in 0% to 26%.
  - **The long leads are different things.** Where Google is a day ahead ("dominic west", "burkina faso", "payton talbott"), it's a search for a person or place before any talk about it. Where X is days ahead ("Thursday Night Football", "#GeneralConference", "Good Friday"), it's a standing tag that Google only listed once.
- **Bluesky against Google: 22 stories,** Bluesky first in 12, Google in 9, median 1 hour for Bluesky. Too few to call.
- **Bluesky against X (13) and Mastodon against X (13) are even.**
- **Over all pairs, Google is the list most often first** (53% of its 155 pairs, 25% later) and X the one most often later (26% first, 52% later).

**What it means.** A search trend on Google is, more often than not, an hour ahead of the same name trending on X. That fits what each list measures: Google's feed lists what is newly searched, and X's lists what many are already posting about. For the hours forecast, "on Google now, not yet on X" is a usable early sign for names; it's not a sign for standing tags.

**Cautions.** Fetches are hourly, so a 1-hour lead is one fetch. X joined 10 hours after Google, which the censoring rule covers. Matching on titles at 0.86 has a few wrong pairs (two different players sharing a surname), which add noise in both directions.

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
