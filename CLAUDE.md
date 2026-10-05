# Top 10 Social Trends

A personal, non-commercial website that shows the top 10 trending topics on each social platform plus one combined cross-platform top 10. It refreshes every hour and covers English-language trends in the US and worldwide.

## Read first

- `PLAN.md` holds the design and the reasons behind every decision. It is the source of truth: update it in the same PR whenever a decision changes.
- `TASKS.md` is the phase checklist. Work on one phase at a time and tick each task's box in the same commit as the task.
- `SETUP.md` lists the accounts, API keys and secrets that the human creates. You cannot create accounts or keys; point to the SETUP.md step instead.

## Stack (decided; change it only by updating PLAN.md first)

- TypeScript everywhere on Node 22 with npm. One package at the repo root, plus `worker/` with its own package for the Cloudflare Worker. Exclude `worker/` from the root tsconfig, ESLint and Vitest.
- Website: Next.js App Router, deployed on Vercel Hobby (personal, non-commercial use only).
- Database: Postgres on Supabase Free, accessed with Drizzle ORM and the `postgres` (postgres-js) driver.
- Pipeline: `pipeline/run.ts`, executed by GitHub Actions in `.github/workflows/collect.yml`, which has a `workflow_dispatch` trigger only (with a `dry_run` input).
- Scheduler: a Cloudflare Workers Free cron in `worker/` calls GitHub's workflow-dispatch API once an hour. Never add a `schedule:` trigger to the workflow (GitHub delays or drops scheduled runs at busy times) and never use Vercel cron (Hobby runs crons at most once a day).
- Embeddings: `@huggingface/transformers` running `nomic-ai/nomic-embed-text-v1.5` (8-bit, "clustering: " prefix, cut to 384 dimensions, English) inside the pipeline, one text at a time.
- Tests: Vitest. TypeScript scripts run with tsx.
- Research (phase 5): Python notebooks in `research/` (pandas, lifelines, statsmodels, LightGBM) for analysis and training only. They read Supabase through a read-only Postgres role. Production never runs Python: a trained model ships as a small JSON or ONNX file that the TypeScript pipeline loads. Exclude `research/` from the root tsconfig, ESLint and Vitest.

## Layout

```
app/                  Next.js routes: /, /p/[platform], /t/[slug], /archive/[date], /status, /api/revalidate
collectors/           one file per source, plus registry.ts and types.ts; __fixtures__/ holds small synthetic responses
pipeline/             run.ts (collect → merge → rank → write → purge → revalidate) and one module per step
lib/                  db clients, env validation, HTTP helper, embeddings, text normalization
db/                   Drizzle schema and generated migrations
config/               ranking.ts (weights, thresholds, caps), costs.ts, blocklist.txt and words-en.txt (hashtag word splitting)
scripts/              one-off tools such as eval.ts
research/             phase 5: Python notebooks, findings/ write-ups, requirements (never imported by the site or pipeline)
worker/               Cloudflare Worker: src/index.ts, wrangler.toml, package.json
.github/workflows/    ci.yml, collect.yml, migrate.yml, deploy-worker.yml
```

## Commands

- `npm run dev`: run the site locally (copy `.env.example` to `.env.local` first).
- `npm run pipeline -- --dry-run`: fetch every enabled source and print its list. Needs no database. From a phone, run the `collect` workflow with `dry_run` checked.
- `npm run pipeline`: full run against `SESSION_DATABASE_URL`.
- `npm test`: unit tests. Tests never touch the network; they use fixtures.
- `npm run db:generate` and `npm run db:migrate`: create and apply Drizzle migrations (against `SESSION_DATABASE_URL`).
- `npm run eval -- --hours 5`: print the combined list and its clusters for 5 random past runs (from phase 2).
- `npm run replay -- tune`: replay the stored lists at several matching thresholds in memory (read-only). `npm run replay -- rebuild --threshold X --yes` rebuilds topics, rankings and snapshots in the database from stored lists; it deletes derived data first, so confirm with the human before running it against production.

## Invariants (keep these true in every change)

1. **Page views never call a platform API.** Pages read precomputed rows and are served from cache. The pipeline refreshes them with `POST /api/revalidate` and the header `x-revalidate-secret`.
2. **One failing source never fails the run.** Every HTTP request has a 10-second timeout and one retry; every collector has a 30-second budget and runs in its own try/catch. Each run writes one `fetch_runs` row per collector and region. A source is skipped (status `skipped`) when its keys are missing or its id is listed in `DISABLED_SOURCES`.
3. **Collectors only fetch and map.** Each returns `TrendItem[]` in the source's own order (rank 1 is first). Filtering, matching and scoring happen in `pipeline/`.
4. **Store only the columns listed in PLAN.md › Data model.** Never store full API responses or item embeddings.
5. **28-day retention.** Every run deletes `trend_items`, `topic_items` and per-platform `rankings` older than 28 days, because YouTube's policy caps stored API data at 30 days. Topics, combined rankings, topic snapshots and TikTok curves (`tiktok_curves`) are kept; snapshots never include YouTube data.
6. **Source roles.** Lead sources: X, Google Trends, Bluesky, Mastodon. Corroborating-only sources: YouTube, Reddit, TikTok, Instagram, Twitch, Hacker News, Pinterest. X's Worldwide list is mostly non-English names, so it only backs up other lists (`CONFIRM_ONLY_LISTS`): a trend on it never starts a topic and counts only when another lead list (X's US list, Google Trends, Bluesky, Mastodon) has the topic, and when X's US list has the topic, the US rank is X's rank; X's page shows its US list. Weights live in `config/ranking.ts`; their starting values are in PLAN.md › Ranking.
7. **Combined score** = sum over platforms of `weight / log2(rank + 1)`. A corroborating source counts only when a lead source also has the topic. Only lists fetched in the last 3 hours count. TikTok's list runs about a week behind, so it isn't matched or counted at all (`UNSCORED_SOURCES`); its page still shows it. There are two views (`VIEWS`, `?region=`): Global counts every list, with Google Trends' four countries ranked as one list by search volume; US counts the US feeds and the worldwide lists. Topics are shared; each view has its own combined ranking and snapshots (PLAN.md › Ranking › Regions).
8. **Topic matching** first joins an item to the topic that has exactly its name (its label's or a member's, by `nameKey`); otherwise it assigns the item to the nearest topic centroid from the last 48 hours when cosine similarity is at least `MATCH_THRESHOLD` (0.86 for nomic at 384 dimensions, confirmed in task 2.9; see PLAN.md › Ranking › Matching model and threshold); otherwise a lead item starts a new topic. Never cluster item to item.
9. **Topic names** (`topics.label`) come only from lead-source items (an X trend, Google query, Bluesky topic or Mastodon tag), never from video or post titles. Claude's display name, reason and category (task 3.6, when `ANTHROPIC_API_KEY` is set) go in `topics.name`, `topics.reason` and `topics.category`; the name and reason are display text only and the category is for research: never write them to `label` or `summary`, never use them in matching, and never send Claude a YouTube title.
10. **English only.** Drop NSFW items, Bluesky trends whose status is `stale` (`cooling` ones are kept), profanity, and evergreen tags listed in `config/blocklist.txt`.
11. **X spend cap.** At most 60 X trend requests per UTC day, counted from `fetch_runs`. The X collector turns itself off when the cap is reached.
12. **Secrets stay secret.** They come only from environment variables. Never commit `.env*` files except `.env.example`, and keep `.env.example` in sync with SETUP.md. Send API keys in headers, not URLs (YouTube: `X-goog-api-key`). Errors stored in `fetch_runs` or shown on `/status` hold only the status code, host and a short reason, never a URL with a key. The repository is public.
13. **Fixtures are small and synthetic.** At most 5 items, only the fields a schema reads, invented YouTube data, and no Bluesky `actors` (real profiles). The repo is public, and YouTube's 30-day storage rule applies.

## Gotchas

- Supabase: never use the direct host; it is IPv6-only without a paid add-on, and GitHub's hosted runners are IPv4-only. The pipeline and migrations use `SESSION_DATABASE_URL` (session pooler, port 5432). Only the Vercel site uses `DATABASE_URL` (transaction pooler, port 6543), with `postgres(url, { prepare: false, max: 1, ssl: 'require' })` and queries awaited one at a time.
- `next build` runs in CI with no secrets, so never query the database at build time; database pages render per request (they read `?region=`) from data cached in `lib/cached.ts`.
- Revalidate dynamic routes with a pattern and type, for example `revalidatePath('/p/[platform]', 'page')`. Cached HTML freezes relative times, so render "updated N min ago" in the browser from a timestamp.
- `export const dynamic = 'force-dynamic'` sets `fetchCache` to `force-no-store`, which makes `unstable_cache` skip its cache. To render a static route per request with cached data, call `await connection()` instead (PLAN.md › Tech stack).
- postgres-js rejects a JavaScript `Date` passed into a raw `sql` fragment (PGlite accepts it, so tests pass). Pass `date.toISOString()` and cast it: `${since}::timestamptz`.
- create-next-app refuses a non-empty directory and writes its own `CLAUDE.md`. Scaffold in a temp directory and copy files in, never overwriting `CLAUDE.md` or `README.md`. If the scaffold includes `AGENTS.md`, keep it and append the line `@AGENTS.md` to this file.
- If nextjs.org is blocked from a cloud session, use the docs bundled in the installed package (`node_modules/next/dist/docs/`).
- Cloud sessions reach only allowed hosts. When a request is blocked, name the host so the human can allow it (SETUP.md §1).
- Pushing `.github/workflows/*` from a cloud session can be refused for lack of workflow permission. Commit workflow files separately; if the push is refused, move them to `ci/workflows/` and ask the human to create each file through GitHub's web editor.
- Reddit refused Data API access (2026-10-01), so the collector reads r/popular's public Atom feed with the normal collector User-Agent: titles and post ids only, no scores or NSFW flags. The XML parser ignores attributes, so the post link is built from the entry's `id`, not its `<link href>`.
- Bluesky's trends endpoints are "unspecced": `link` is a relative path, `status` is free text (seen: `trending`, `saturating`, `cooling`, `stale`) and `topic` is an opaque id. Validate with zod so a schema change fails only that source.
- YouTube's `chart=mostPopular` has no worldwide option and, since July 2025, draws from the music, movies and gaming charts.
- Google Trends' "Trending now" RSS is per country with no worldwide feed, and each item's `<link>` is only the feed URL. It lists the 10 newest trends, not the biggest, so the pipeline, the platform page and the dashboard rank its last 3 hours by approximate traffic (`lib/window.ts`, PLAN.md › Ranking › Google Trends window).
- Keep a pipeline run under 5 minutes: cache npm and the embedding model in Actions, and fetch sources in parallel.

## How to work

- One phase per branch and pull request; one task per commit, with the task id in the message (for example `1.3 bluesky collector`), ticking the task's box in the same commit.
- For any task that touches more than two files, write a short plan, then start implementing without waiting for approval.
- Every collector gets a fixture-based test before it is wired into the pipeline.
- When a key, account, approval or network host is missing, name the SETUP.md step that provides it, leave that source disabled and carry on with the rest.
- Don't start the next phase until the current phase's gate in TASKS.md passes; the human confirms each gate.
- When you change a decision, update PLAN.md in the same pull request.

@AGENTS.md
