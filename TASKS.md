# Tasks

Work top to bottom, one phase per branch and pull request. Tick each task's box in the same commit as the task. Steps marked **[You]** need the human (accounts, keys, approvals, gate checks); everything else is for Claude Code. Design details are in `PLAN.md`; account steps are in `SETUP.md`.

## Prompt to start a phase

Paste this into a new Claude Code session, replacing `N` with the phase number (use `0` for the first session):

```
Read CLAUDE.md, PLAN.md, TASKS.md and SETUP.md. Work on phase N only; the previous phase's gate has passed.
Write a short plan for the phase's unticked tasks, then start implementing right away without waiting for my approval.
Make one commit per task, tick its box in TASKS.md in that same commit, and keep CI green.
If a task needs a key, account, approval or network host that isn't set up yet, name the SETUP.md step,
leave that source disabled and continue with the rest.
When the tasks are done, open a pull request and list anything I must do by hand.
```

## Phase 0 · Setup (week 1)

- [ ] **[You]** Create the public GitHub repo, upload these four files, connect it to Claude Code and allow the data-source hosts in the cloud environment (SETUP.md §1).
- [ ] **[You]** Request Reddit Data API access and open an X developer account now, because approvals take time (SETUP.md §9, §10).
- [ ] **[You]** Create the Supabase project and copy both pooler connection strings (SETUP.md §2).
- [ ] **[You]** Create the Cloudflare API token and the GitHub fine-grained token for the hourly trigger (SETUP.md §5, §6).
- [ ] **0.1 Scaffold.** Next.js App Router with TypeScript and ESLint, plus Vitest, tsx and `.nvmrc` set to 22. create-next-app refuses a non-empty directory, so scaffold in a temp directory and copy the files in without overwriting `CLAUDE.md` or `README.md`; if the scaffold has `AGENTS.md`, keep it and append `@AGENTS.md` to `CLAUDE.md`. Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `pipeline`, `db:generate`, `db:migrate`, `eval` (stub for now). Done when `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` pass with no environment variables set.
- [ ] **0.2 Environment.** `lib/env.ts` validates variables with zod per consumer, at first use:
    - The site needs `DATABASE_URL`; `/api/revalidate` also needs `REVALIDATE_SECRET`.
    - The pipeline needs `SESSION_DATABASE_URL`, except with `--dry-run`. `SITE_URL` and `REVALIDATE_SECRET` are optional (without them it skips revalidation).
    - Each source's keys are optional: a missing key skips that source. `DISABLED_SOURCES` (comma-separated ids) skips sources on purpose.
    - App code never reads `GH_DISPATCH_TOKEN` or `CLOUDFLARE_*`; only workflows and the Worker do.

    `.env.example` lists every variable in SETUP.md › Environment variables with a one-line comment; `.gitignore` covers `.env*` except `.env.example`.
- [ ] **0.3 Database.** `db/schema.ts` defines the six tables exactly as in PLAN.md › Data model; `drizzle.config.ts` uses `SESSION_DATABASE_URL`; generate the first migration. Two clients: `lib/db.ts` for the site (`DATABASE_URL`, `{ prepare: false, max: 1, ssl: 'require' }`) and `pipeline/db.ts` for the pipeline (`SESSION_DATABASE_URL`).
- [ ] **0.4 Source registry.** `collectors/registry.ts` lists all ten sources plus `heartbeat`: id, name, role, weight, regions, required env vars and the phase that adds it. A source runs when its collector exists, its keys are present and its id isn't in `DISABLED_SOURCES`. The pipeline upserts the registry into `sources` at the start of each run.
- [ ] **0.5 Pipeline skeleton.** `pipeline/run.ts` parses `--dry-run`, upserts sources, writes a `fetch_runs` row for `heartbeat` with status `ok`, prints a one-line summary and exits 0. With `--dry-run` it only prints.
- [ ] **0.6 Workflows.** Commit the workflow files in their own commit. If the push is refused for lack of workflow permission, move them to `ci/workflows/` and tell me to create each one with GitHub's web editor (Add file › Create new file at `.github/workflows/<name>.yml`).
    - `ci.yml`: on pull requests and pushes to `main`, run `npm ci`, lint, typecheck, test and build, with no secrets.
    - `collect.yml`: `workflow_dispatch` only (no `schedule:`), with a boolean `dry_run` input that adds `--dry-run`; `concurrency: { group: collect, cancel-in-progress: false }`; `timeout-minutes: 10`; Node 22 with npm cache; `npm ci` then `npm run pipeline`, with secrets and variables passed as env.
    - `migrate.yml`: on pushes to `main` that touch `db/migrations/**`, plus `workflow_dispatch`, run `npm run db:migrate` with `SESSION_DATABASE_URL`.
- [ ] **0.7 Hourly trigger.** `worker/` holds a Cloudflare Worker whose `scheduled` handler POSTs to `https://api.github.com/repos/{GH_OWNER}/{GH_REPO}/actions/workflows/collect.yml/dispatches` with body `{"ref":"main"}` and headers `Authorization: Bearer {GH_DISPATCH_TOKEN}`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` and `User-Agent: top10-trends-cron`, and logs any non-2xx response. `wrangler.toml` sets `workers_dev = false`, `[triggers] crons = ["7 * * * *"]` and the `GH_OWNER` and `GH_REPO` vars. `deploy-worker.yml` runs on pushes to `main` that touch `worker/**`, and on `workflow_dispatch` so a renewed token can be pushed without a code change. It deploys with wrangler using `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, then sets the Worker secret `GH_DISPATCH_TOKEN` from the GitHub secret of the same name.
- [ ] **0.8 Placeholder site.** A home page that says the site is coming soon and lists the planned sources from the registry, grouped by phase; a README with the architecture summary and a pointer to SETUP.md.
- [ ] **[You]** Merge the pull request (creating any workflow files by hand if 0.6 asked you to). Then import the repo into Vercel (SETUP.md §7), add the GitHub secrets and variables (SETUP.md §8), and run `migrate` and then `collect` once from the repo's Actions tab (GitHub Mobile works too).

**Gate 0.** A heartbeat lands every hour for 24 hours. In Supabase's SQL editor:

```sql
select count(*) as heartbeats
from fetch_runs
where source_id = 'heartbeat' and status = 'ok'
  and started_at > now() - interval '24 hours';
-- pass: 23 or more
```

## Phase 1 · Per-platform lists (weeks 2–3)

- [ ] **[You]** Add the phase 1 keys and variables: `YOUTUBE_API_KEY`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `REVALIDATE_SECRET`, `SITE_URL`, `COLLECTOR_USER_AGENT` (SETUP.md §3, §4, §7, §8), and redeploy on Vercel after adding `REVALIDATE_SECRET` there.
- [ ] **1.1 Types.** `collectors/types.ts`:

    ```ts
    export type Region = 'global' | 'us' | 'gb' | 'ca' | 'au';
    export interface TrendItem {
      source: SourceId;         // registry id
      region: Region;           // the feed's real region
      rank: number;             // 1-based, in the source's own order
      title: string;            // display text as the source gives it
      url: string;              // absolute link to the trend, search or post
      metricValue?: number;     // post count, views, approximate searches…
      metricLabel?: string;     // 'posts', 'views', 'searches'…
      matchText?: string[];     // extra text for topic matching only (e.g. news headlines); not stored
      flags?: { nsfw?: boolean; status?: string }; // read by filters; not stored
    }
    export interface Collector {
      id: SourceId;
      fetch(region: Region, ctx: { http: Http; env: Env; now: Date }): Promise<TrendItem[]>;
    }
    ```
- [ ] **1.2 HTTP helper.** `lib/http.ts`: a 10-second timeout and one retry with jitter per request (on network errors, 429 and 5xx), User-Agent from `COLLECTOR_USER_AGENT`, JSON and XML (RSS) parsing helpers, and errors that carry only the status code, host and a short reason, never the full URL.
- [ ] **1.3 Collectors.** Each gets a zod-validated response, a fixture in `collectors/__fixtures__/` and a unit test. Fixtures follow CLAUDE.md invariant 13: at most 5 items, only fields the schema reads, invented YouTube data, no Bluesky `actors`.
    - **Bluesky** (`global`): `GET https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends?limit=25`. Title is `displayName` (skip items without one; `topic` is an opaque id); URL is `https://bsky.app` plus the relative `link`; metric is `postCount` (`posts`); `flags.status` is `status`, validated as any string.
    - **Google Trends** (`us`): `GET https://trends.google.com/trending/rss?geo=US`. Title is the item title; metric is `ht:approx_traffic` parsed to a number ("20000+" becomes 20000, `searches`); `matchText` holds the `ht:news_item_title` values; URL is the first `ht:news_item_url`, or a Google search link for the query (the item's own `<link>` is only the feed URL).
    - **YouTube** (`us`): `GET https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=US&maxResults=25`, with the key in the `X-goog-api-key` header. Title is `snippet.title`; URL is `https://www.youtube.com/watch?v={id}`; metric is `statistics.viewCount` (`views`).
    - **Mastodon** (`global`): `GET https://{MASTODON_INSTANCE}/api/v1/trends/tags?limit=20`. Title is `#` plus `name`; URL is the tag's `url`. `history` is newest first and its values are strings; the metric is today's `uses` parsed to a number (`uses today`, a partial day).
    - **Hacker News** (`global`): `GET https://hacker-news.firebaseio.com/v0/topstories.json`, take the first 25 ids, then fetch `item/{id}.json` five at a time. Title and URL come from the item (fall back to `https://news.ycombinator.com/item?id={id}`); metric is `score` (`points`).
    - **Twitch** (`global`): get an app token with `POST https://id.twitch.tv/oauth2/token` (`grant_type=client_credentials`), then `GET https://api.twitch.tv/helix/games/top?first=25` with the `Client-Id` and `Authorization: Bearer` headers. Title is `name`; URL is `https://www.twitch.tv/search?term=` plus the encoded name; no metric.
- [ ] **1.4 Collect step.** Run the runnable collectors in parallel with `Promise.allSettled`. Write one `fetch_runs` row per collector and region (status, item count, sanitized error) and insert each source's `trend_items` in one batch. With `--dry-run`, print each list as a table instead of writing.
- [ ] **1.5 Purge step.** Every run deletes `trend_items` older than 28 days (which cascades to `topic_items` and per-platform `rankings`) and `fetch_runs` older than 90 days.
- [ ] **1.6 Revalidation.** `POST /api/revalidate` checks the `x-revalidate-secret` header against `REVALIDATE_SECRET`, then calls `revalidatePath('/')`, `revalidatePath('/p/[platform]', 'page')` and `revalidatePath('/status')` (plus `/t/[slug]` from phase 2). The pipeline calls `{SITE_URL}/api/revalidate` as its last step and logs a failure without failing the run.
- [ ] **1.7 Pages.** `/p/[platform]` shows the latest successful top 10 with "updated N min ago" (computed in the browser from a timestamp), a link out per item and the platform's name as attribution. `/status` shows, per source, the last success, the last sanitized error, and the run count and success rate over 24 hours. The home page links to every platform page until phase 2 replaces it.
- [ ] **[You]** Run `collect` with `dry_run` checked from the Actions tab and confirm every phase 1 source prints items.

**Gate 1.** Every phase 1 source succeeds in at least 95% of runs over a 7-day soak (this runs into week 4). Then the per-platform lists can go public.

```sql
select source_id,
       count(*) as runs,
       round(100.0 * avg((status = 'ok')::int), 1) as success_pct
from fetch_runs
where started_at > now() - interval '7 days'
  and source_id <> 'heartbeat'
group by source_id
order by success_pct;
-- pass: every phase 1 source at 95 or more
```

## Phase 2 · Combined top 10 (weeks 4–5)

- [ ] **[You]** Choose the embedding model now: the local model (free; allow `huggingface.co` in the cloud environment, SETUP.md §1) or OpenAI `text-embedding-3-small` (about $0.06 a month, needs `OPENAI_API_KEY`). Switching later means re-embedding topic centroids and re-tuning the threshold.
- [ ] **2.1 Text utilities.** `lib/text.ts`: `normalize` (lowercase; strip `#`, URLs and emoji; split camelCase and letter-digit boundaries in hashtags; collapse spaces) and `prettyLabel` (display form that splits hashtags into words and keeps the source's capitalization). Table-driven tests include `#WorldSeries2026`, `#GRAMMYs`, an emoji-only item and an already-clean phrase.
- [ ] **2.2 Filters.** `pipeline/filter.ts`: keep English using a language detector suited to short text plus a Latin-script check (Latin-script items with no confident language pass); drop items flagged NSFW, Bluesky trends whose status is `cooling` or `stale`, profanity from a word list, and terms in `config/blocklist.txt` (one per line, case-insensitive, `#` starts a comment). Tests for each rule.
- [ ] **2.3 Embeddings.** `lib/embed.ts` embeds a batch of strings (title plus `matchText`) with the chosen model. Local: `@huggingface/transformers` feature extraction with `Xenova/all-MiniLM-L6-v2`, mean pooling, normalized. `collect.yml` caches the model files with `actions/cache`.
- [ ] **2.4 Topic matching.** `pipeline/match.ts` loads topics whose `last_seen` is within 48 hours. It processes lead-source items first (best rank first), then corroborating items. Each item joins the nearest topic when cosine similarity is at least `MATCH_THRESHOLD` (0.80); otherwise a lead item starts a new topic and a corroborating item joins nothing. Update the centroid as a running mean (re-normalized) and `last_seen`, and write `topic_items`. Tests use hand-made vectors.
- [ ] **2.5 Scoring.** `pipeline/score.ts`: score = sum over platforms of `weight / log2(best rank + 1)`. A corroborating platform counts only if the topic has a lead-platform item in the current lists, and only lists fetched within 3 hours count. Write the top 10 to `rankings` (`list = 'combined'`) and each platform's top 10 (`list` = source id, with `item_id`). Unit tests reproduce PLAN.md's examples (1.0 and 1.81).
- [ ] **2.6 Labels and context.** A new topic's label is `prettyLabel` of its best-ranked lead item; its summary is the first Google Trends headline attached to the topic, if any.
- [ ] **2.7 Pages.** Home: the combined top 10 with label, context line, platform badges and rank change against the ranking computed about 24 hours earlier ("new" when absent). `/t/[slug]`: platforms and ranks now, 7-day rank history from `rankings`, and the top links per platform from items still stored.
- [ ] **2.8 Eval script.** `npm run eval -- --hours 5` picks 5 random past runs and prints each combined top 10 with its member items and scores, for manual review. Add an `eval` workflow with the same output so it can run from a phone.
- [ ] **2.9 Tuning.** Tune `MATCH_THRESHOLD` and the weights in `config/ranking.ts` from the eval output, and record the final values and reasons in PLAN.md.

**Gate 2.** Run the eval for 5 hours. In each hour, at least 8 of the 10 topics make sense and none is a duplicate.

## Phase 3 · Paid and approved sources (week 6)

- [ ] **[You]** Buy X pay-per-use credits and add `X_BEARER_TOKEN` (SETUP.md §10). Add Reddit, Pinterest, Apify and Anthropic keys only for the sources you want (SETUP.md §9, §11, §12, §13), and allow their API hosts in the cloud environment if a session needs to test them.
- [ ] **3.1 X collector.** `GET https://api.x.com/2/trends/by/woeid/{woeid}?max_trends=20` for WOEID 1 (`global`) and 23424977 (`us`) with the app's Bearer token. Title is `trend_name`; metric is `tweet_count` when present (`posts`); URL is an X search link for the trend. Before each call, count today's X rows in `fetch_runs` (UTC); at 60, skip with status `skipped` and reason `daily cap`.
- [ ] **3.2 Regions.** Add `gb`, `ca` and `au` feeds for Google Trends and YouTube. Compute rankings for two views as described in PLAN.md › Ranking › Regions (`rankings.region` is the view). Add a Global / US toggle (`?region=`) to the home, platform and topic pages, defaulting to Global.
- [ ] **3.3 Reddit collector** (once approved). App-only OAuth with `POST https://www.reddit.com/api/v1/access_token` (`grant_type=client_credentials`), then `GET https://oauth.reddit.com/r/popular/hot?limit=25` with the required User-Agent. Title is `title`; URL is `https://www.reddit.com` plus `permalink`; metric is `score` (`upvotes`); `flags.nsfw` is `over_18`.
- [ ] **3.4 Pinterest collector** (after app review). `GET https://api.pinterest.com/v5/trends/keywords/US/top/growing?limit=25`; keywords in rank order; handle token refresh as Pinterest's docs describe.
- [ ] **3.5 TikTok** (optional). When `TIKTOK_ENABLED=true`, run the chosen Apify actor once a day through Apify's API and read its dataset of hashtags (weight 0.5, corroborating). Disable it after 3 failed days in a row.
- [ ] **3.6 Claude topic names** (optional). When `ANTHROPIC_API_KEY` is set, name each new topic with Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) from its member titles and headlines: a short name plus a one-line reason of at most 120 characters, stored in `topics.label` and `topics.summary`. Never rename existing topics.
- [ ] **3.7 Spend on /status.** Show a month-to-date estimate and a projection: X requests this month × $0.010, plus topics created this month × about $0.0009 when Claude naming is on (600 input and 60 output tokens at Haiku prices).

**Gate 3.** `/status` projects the month's spend within your chosen tier (Starter about $18, Plus about $19–24).

## Phase 4 · Polish and launch (weeks 7–8)

- [ ] **4.1 Archive.** `/archive/[date]` shows the combined lists for each hour of that day, and per-platform lists only for the last 28 days. The home page links to it.
- [ ] **4.2 Sharing and search.** Open Graph images for the home and topic pages, page titles and descriptions, `sitemap.xml` and `robots.txt`.
- [ ] **4.3 Failure alerts.** GitHub emails you about failed runs triggered with your token (turn on Actions notifications for failed runs only). `/status` and the home page show a banner when any source has failed for 6 hours or more.
- [ ] **4.4 Analytics.** Add privacy-friendly page analytics, such as Vercel Web Analytics.
- [ ] **4.5 README.** What the site is, screenshots, architecture, how to run locally, and attribution for every data source.
- [ ] **[You]** Check the site on a phone and a desktop, then share the link.

**Gate 4.** Launch.
