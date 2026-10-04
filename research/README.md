# Research (phase 5)

Python notebooks for the research questions and forecast models in PLAN.md › Predictions and research. Nothing here runs in production: the site, the pipeline and the Worker stay TypeScript, and a trained model ships to them as a small JSON or ONNX file.

## Set up (once)

1. Python 3.12 or newer.
2. Create the read-only database role and your connection string: SETUP.md §14. The notebooks refuse any other role.
3. From this folder:

   ```bash
   python -m venv .venv
   .venv\Scripts\activate          # macOS or Linux: source .venv/bin/activate
   pip install -r requirements.txt
   pytest                          # quick check; needs no database
   jupyter lab
   ```

## Using the data

```python
from topnews import db

engine = db.engine()                  # reads RESEARCH_DATABASE_URL from ../.env.local
db.table_counts(engine)
snaps = db.snapshots(engine, days=7)  # hourly topic snapshots, ranks and metrics spread into columns
runs = db.fetch_runs(engine, days=7)
items = db.trend_items(engine, days=7)
```

- **Topic snapshots** (`topic_snapshots`) are the main dataset. They're kept permanently, never include YouTube, and each row's `algo_version` says how it was made. Keep an analysis to one version, or compare versions on purpose (live hours are `…/r1` from the 2026-10-01 15:07 UTC run to the 21:07 run, `…/r2` from the 22:07 UTC run, when Bluesky's filter changed to drop only stale topics, to the 2026-10-02 17:07 UTC run; `…/r3` from the 18:07 UTC run to the 2026-10-04 01:07 UTC run (32 hours), when X's Worldwide list became confirm-only; and `…/r4` from the 02:07 UTC run on 2026-10-04, when X's rank became its US list's. Every r3 and r4 hour has stored match text); rows marked `+replay` were rebuilt from stored lists and have `news_count` 0. Rebuilt hours (2026-09-30 11:32 to 2026-10-01 14:08 UTC) also couldn't apply Bluesky's status filter, so they hold about 38 Bluesky topics an hour against about 4 in live hours: describe with them, but train on live hours (`is_replay` in the training table). `python -m topnews.dataset` takes the newest version by default, so from 2026-10-01 22:07 UTC it builds from r2 hours only (about 25 Bluesky topics an hour, against 1 to 9 in r1's).
- **TikTok curves** (`tiktok_curves`, via `db.tiktok_curves`) are kept permanently: each listed hashtag's 7-day daily popularity curve, one new curve a day. Values run 0–100 within a curve, so compare days inside one curve (`window_end`) rather than across curves.
- **Stored lists** (`trend_items`) are kept only 28 days. `db.trend_items` leaves YouTube out unless you pass `include_youtube=True`. Don't save YouTube rows to disk: its policy caps stored data at 30 days.
- **Match text** (`trend_items.match_text`, from the 2026-10-02 18:07 UTC run): Google's headlines and Bluesky's description for each stored item, the extra text the pipeline matches on. `db.trend_items` returns it as a list, `echo.trends` keeps each trend's latest, and the vectors from `echo.embed` include it as the pipeline's do (`use_text=False` gives titles only). Items stored before that run, and every other source, have none, so their vectors are still from the title alone.
- **Views and country feeds (r5, task 3.2):** from the first r5 run on 2026-10-04, `topic_snapshots` holds every hour twice, once per view (`region` is `global` or `us`), with the same topics. `python -m topnews.dataset` builds from the US view, the continuation of the single list before r5; `--view global` builds the other, where Google's rank is its place across four countries. `trend_items` gains Google's UK, Canada and Australia feeds (`region` gb, ca, au): each is its own list for lifecycles and rhythms, a query on several is one trend in `echo.trends`, and lead and lag drops them first (`leadlag.one_clock`), because their day starts at another hour.
- **Slow sources:** TikTok is fetched once a day, Instagram three times a day (its source refreshes about every 3 hours) and Pinterest twice a week (its source about weekly). Between fetches the same list repeats in every hourly row, so hour-to-hour changes there aren't signal. Their schedules changed on 2026-10-01; PLAN.md's source cadence log has the times to cut analyses at. TikTok's list also lags: on 2026-10-01 it described the week of 2026-09-21 to 2026-09-27 and on 2026-10-02 the week of 2026-09-24 to 2026-09-30, so never read it as same-time with other platforms. The pipeline doesn't match or score TikTok at all (task 2.16), so snapshots have no TikTok rank from then on; `topnews.echo` compares TikTok only with Pinterest (`LAGGED_PARTNERS`). Instagram's `posts` metric is an all-time count, not momentum. X can show `skipped` runs with the reason `daily cap`: no X ranks that hour, not low ones.
- **Google Trends' rank is age, not size:** its feed holds the 10 newest trends, newest first, so a trend's time on the feed isn't its lifespan (findings/rq5-rhythms.md). `trend_items` keeps that feed order. The snapshots and combined rankings rank Google over a 3-hour window by searches (task 2.12), so a Google-only topic stays in the snapshots for up to 3 hours after its last sighting.
- **Bluesky's grace (task 2.14):** the snapshots and combined rankings keep a Bluesky topic at its newest rank for 2 hours after it drops out of Bluesky's list, so a snapshot's Bluesky rank can be up to 2 hours old, and two topics can hold the same Bluesky rank in one hour (the current one and one kept by grace). `trend_items` has only what each list actually showed. One flawed live hour: in the 2026-10-01 15:07 UTC run, a topic that Bluesky still listed but had marked cooling got the grace at its old rank, so `ranks.bluesky` in that hour's snapshots can belong to a topic Bluesky was already cooling. The 16:07 UTC run has the fix (PR #16).
- **Metrics are running totals** (Bluesky posts, Hacker News points, Google searches in buckets, Mastodon's uses today, which restart at midnight UTC). Measure activity as growth between fetches, not as the level.
- **Matching an item across hours:** Bluesky rewrites a topic's title as the story moves on and Hacker News titles get edited, so match those by url; Google's url is its first news link and changes, so match Google by title. `topnews.rhythms` does this.

## Rules

- Read only. The role can't write, and every session is also set read-only.
- No secrets in notebooks. Connection details come only from `.env.local`.
- Clear notebook outputs before committing (`jupyter nbconvert --clear-output --inplace notebooks/*.ipynb`), so no data rows end up in the public repository.
- Exports go to `data/`, which git ignores.
- Findings go in `findings/` as short Markdown write-ups. The key numbers also go into PLAN.md.

## Layout

```
research/
  requirements.txt   pinned packages (pandas 2.x because lifelines needs it)
  pyproject.toml     makes topnews/ importable
  topnews/db.py      read-only data access
  topnews/rhythms.py RQ5: turnover, novelty and flow of the stored lists by hour
  topnews/lifecycle.py RQ1: spells in each list's top 10, half-lives (Kaplan–Meier), rank paths
  topnews/dataset.py 5.2: the training table from topic snapshots
                     (python -m topnews.dataset [--source replay]; before production
                     has snapshots, npx tsx scripts/replay-snapshots.ts at the repo
                     root rebuilds them from the stored lists, read-only)
  topnews/llm.py     a local model (Qwen3.5-9B in LM Studio, this PC's GPU) that drafts labels for
                     a person to check: same story or not, topic categories. Research only
  topnews/matching.py the checked matching pairs, and scoring an embedding model on them
  topnews/categories.py a category and news flag per trend (model drafts, a person's check; data/categories.csv)
  topnews/category_model.py 5.14: a small classifier from the pipeline's title vectors to the category,
                     split by time and scored on checked labels; it may answer "unknown"
  topnews/wiki.py    5.8: Wikipedia links and daily pageviews (no key; cached in data/wiki/)
  topnews/baselines.py 5.5: rule-based lifespan and breakout forecasts, scored by time split
  topnews/news.py    RQ4: google, calendar, news-linked or other, with lifespans and spread
  topnews/breakout.py RQ3: which trends spread to other lists, by what was known at first sighting
  topnews/leadlag.py RQ2: which platform has a story first, from RQ6's matches
  topnews/echo.py    RQ6: cross-platform matches of the stored lists' trends, using
                     the pipeline's own filters and model (scripts/embed-titles.ts;
                     needs npm ci at the repo root; vectors go to data/)
  notebooks/         one notebook per question, numbered
  findings/          write-ups: rq1-lifecycle.md and so on
  tests/             pytest, no database needed
  data/              local exports (ignored by git)
```
