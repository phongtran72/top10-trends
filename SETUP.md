# Setup: accounts, keys and secrets

These steps are yours; Claude Code can't create accounts or keys. Every step works in a browser, though a computer makes phase 0 quicker. Never paste keys into a chat. Put them where each step says: GitHub secrets, Vercel or Cloudflare. If a Claude Code cloud session needs a key for live testing, add it to the cloud environment as an API credential (Pro and Max plans), which stays outside the sandbox. Plain environment variables in a cloud environment are readable inside the session.

Sections 1–8 cover phases 0–1. Sections 9–13 are for later phases or optional sources; start 9 and 10 in week 1 because approval takes time.

## 1. GitHub repository and Claude Code (phase 0)

1. Create a **public** repository, for example `top10-trends`, with a README. Public keeps GitHub Actions minutes free; keys live in secrets, never in the code.
2. Upload `CLAUDE.md`, `PLAN.md`, `TASKS.md` and `SETUP.md` to the repo root: **Add file › Upload files**, then commit.
3. Connect the repo to Claude Code: follow the [cloud quickstart](https://code.claude.com/docs/en/web-quickstart) to connect GitHub, and install the [Claude GitHub App](https://github.com/apps/claude) on this repo, which also enables Auto-fix for pull requests.
4. Let cloud sessions reach the data sources. The default network access blocks most of them. In your cloud environment's settings ([Configure cloud environments](https://code.claude.com/docs/en/cloud-environments)), choose custom network access, keep the default domains, and add:
    - Phase 1: `public.api.bsky.app`, `trends.google.com`, `mastodon.social`, `hacker-news.firebaseio.com`, `id.twitch.tv`, `api.twitch.tv`
    - Phase 2 (local embedding model): `huggingface.co`, plus any download host a blocked request names
    - Phase 3, only for the sources you add: `api.x.com`, `www.reddit.com`, `api.apify.com`, `api.anthropic.com`, `api.openai.com`

    The hourly job itself runs in GitHub Actions, which has no such limit; this list only lets Claude test sources inside its sessions.
5. Start a session from the **Code** tab in the Claude app (or claude.ai/code) with the phase 0 prompt in `TASKS.md`.

## 2. Supabase database (phase 0)

1. Create a free project at [supabase.com](https://supabase.com) in a US East region. This project uses **East US (Ohio)**, `us-east-2`; §7 puts the Vercel functions next to it. Use a letters-and-digits database password: symbols have to be escaped inside connection strings.
2. Open **Connect** and copy two pooler connection strings. Don't use the direct connection: it is IPv6-only without a paid add-on, and GitHub's hosted runners are IPv4-only.
    - **Transaction pooler** (port 6543) → `DATABASE_URL`, used only by the website on Vercel
    - **Session pooler** (port 5432) → `SESSION_DATABASE_URL`, used by the hourly pipeline and by migrations
3. Or, on Windows with the GitHub CLI logged in, run `powershell -ExecutionPolicy Bypass -File scripts/set-db-secrets.ps1` from the repo root. It asks for the password once (hidden), sets the `SESSION_DATABASE_URL` secret and writes both strings to `.env.local`, encoding any symbols. Use it again after resetting the password. A failed `migrate` or pipeline run prints the string's user, host, port and database with warnings about the password's format, never the password.

## 3. YouTube Data API key (phase 1)

1. In [Google Cloud Console](https://console.cloud.google.com), create a project.
2. **APIs & Services › Library**: enable **YouTube Data API v3**.
3. **APIs & Services › Credentials › Create credentials › API key**. Restrict the key to YouTube Data API v3 → `YOUTUBE_API_KEY`.

The free quota is 10,000 units a day; this site uses 24 a day (96 once phase 3 adds UK, Canada and Australia).

## 4. Twitch app (phase 1)

1. Open the [Twitch developer console](https://dev.twitch.tv/console) with a Twitch account. Twitch requires two-factor authentication before you can register an app.
2. **Register Your Application**: a unique name, OAuth redirect URL `http://localhost`, category **Website Integration**. If asked for a client type, choose **Confidential**.
3. Copy the **Client ID** → `TWITCH_CLIENT_ID`. Create a **New Secret** → `TWITCH_CLIENT_SECRET`.

## 5. Cloudflare, for the hourly trigger (phase 0)

1. Create a free Cloudflare account.
2. **My Profile › API Tokens › Create Token**, using the **Edit Cloudflare Workers** template → `CLOUDFLARE_API_TOKEN`.
3. Copy your account ID from the Cloudflare dashboard → `CLOUDFLARE_ACCOUNT_ID`.

## 6. GitHub token for the trigger (phase 0)

1. GitHub **Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token**.
2. Repository access: **only this repository**. Permissions: **Actions: Read and write**. Pick an expiration date and set a reminder to renew the token before it lapses.
3. Save it as the GitHub secret `GH_DISPATCH_TOKEN` (section 8). The deploy workflow copies it into the Worker; after renewing the token, update the secret and run the `deploy-worker` workflow by hand.

Runs triggered with this token count as yours, so GitHub can email you when one fails (turn on Actions notifications for failed runs only).

## 7. Vercel website (after merging phase 0)

1. Sign up at [vercel.com](https://vercel.com) with GitHub, on the Hobby plan.
2. **Add New › Project** and import the repo once phase 0's pull request is merged; Vercel detects Next.js.
3. Environment variables: `DATABASE_URL` now; `REVALIDATE_SECRET` in phase 1. Vercel applies changed variables only to new deployments, so redeploy after adding one.
4. Deploy, then copy the production domain (for example `https://top10-trends.vercel.app`) → `SITE_URL`.
5. **Settings › Functions › Function Region**: choose the region next to the database. For Supabase in `us-east-2` (Ohio) that is **Cleveland, `cle1`**; for `us-east-1` (North Virginia) keep Vercel's default, Washington `iad1`. Hobby allows one region.

Hobby is for personal, non-commercial use. Adding ads or sponsors means moving to Pro ($20 a month).

## 8. GitHub Actions secrets and variables (phases 0–1)

In the repo: **Settings › Secrets and variables › Actions**. Add each value from the table below under **Secrets** or **Variables** as listed. For `REVALIDATE_SECRET`, generate a random string of 32 or more characters and use the same value in Vercel. To pause a source without a code change, list its id in the `DISABLED_SOURCES` variable.

## 9. Reddit (nothing to set up)

Reddit refused the Data API request on 2026-10-01, so the collector reads r/popular's public Atom feed, which needs no account, key or variable. To turn Reddit off, add `reddit` to `DISABLED_SOURCES`. If Reddit's [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) approval ever comes through, the API would add scores and NSFW flags.

## 10. X (open the account in week 1; add in phase 3)

1. Create a developer account and an app ([getting access](https://docs.x.com/x-api/getting-started/getting-access)).
2. Buy a small amount of pay-per-use credit. Hourly polling of Worldwide and US costs about $14.40 a month at [$0.010 per request](https://docs.x.com/x-api/getting-started/pricing). Set a spending limit if the console offers one; the code also caps X at 60 requests a day.
3. Copy the app's Bearer token → `X_BEARER_TOKEN`.

## 11. Pinterest (optional, phase 3)

Pinterest is read through Apify: see §12, step 5. Pinterest's own trends API is free, but it needs a business account and an app at [developers.pinterest.com](https://developers.pinterest.com/docs/getting-started/set-up-app/) that passes review for Trial access; if you ever get that, it can replace the scraper.

## 12. Apify, for TikTok, Instagram and Pinterest (optional, phase 3)

1. Create an [Apify](https://apify.com/pricing) account. The free plan includes $5 of usage a month and blocks, rather than bills, beyond it.
2. Copy your API token (**Settings › API & Integrations**) into the GitHub secret `APIFY_TOKEN`, and set the GitHub variables `TIKTOK_ENABLED`, `INSTAGRAM_ENABLED` and `PINTEREST_ENABLED` to `true` for the sources you want.
3. Open the actor [data_xplorer/tiktok-trends](https://apify.com/data_xplorer/tiktok-trends) and create a **schedule** (**Schedules › Create**) that runs it daily (cron `0 6 * * *`, UTC) with this input and a maximum cost per run of $0.25:

    ```json
    { "trendType": "hashtags", "maxItems": 30, "countryCode": "US", "hashtagPeriod": "7", "industryId": "", "saveMedia": false }
    ```

    A run costs $0.025 plus $0.001 per hashtag: 30 hashtags are $0.055 in events and about $0.07 on the bill with platform usage, so about $2.10 a month, inside the free $5. Each hashtag also carries a 7-day daily popularity curve and an up/down direction, which the collector passes on for phase 5. The pipeline only reads the latest run's results. If no run has succeeded for 48 hours, TikTok shows as failing on /status. (Since July 2026 TikTok's Creative Center shows logged-out visitors only its top 3; automation-lab/tiktok-trends-scraper returned just those 3, while this actor returned all 30.)
4. Open the actor [s-r/instagram-trending-scraper](https://apify.com/s-r/instagram-trending-scraper) and create a schedule that runs it three times a day, at 01:50, 13:50 and 19:50 (cron `50 1,13,19 * * *`, UTC), with this input and a maximum cost per run of $0.10:

    ```json
    { "maxKeywords": 10, "expandRelatedTopics": false }
    ```

    It costs $0.002 per topic with no start fee, and the free plan caps a run at 10 topics: $0.02 a run, about $1.80 a month. Instagram refreshes its list every 3 hours, at about 01, 04, 07, 10, 13, 16, 19 and 22 UTC, so each run at :50 reads a list that has just changed; three runs a day cover the US day and fit the budget (every refresh would cost $4.80 a month). Together with TikTok and Pinterest that is about $4.20 of the free $5, which Apify counts per billing period (from the day you signed up), not per calendar month. If no run has succeeded for 24 hours, Instagram shows as failing on /status.
5. Open the actor [automation-lab/pinterest-trends-scraper](https://apify.com/automation-lab/pinterest-trends-scraper) and create a schedule that runs it on Mondays and Thursdays at 07:23 (cron `23 7 * * 1,4`, UTC; off the hour, because Pinterest rate-limited the first run at exactly 07:00) with this input and a maximum cost per run of $0.10:

    ```json
    { "countries": ["US"], "trendTypes": ["growing"], "maxResultsPerCountry": 25 }
    ```

    25 keywords cost $0.03 in a test, so about $0.26 a month. Pinterest Trends refreshes weekly, so twice a week is enough. If no run has succeeded for 180 hours (7.5 days), Pinterest shows as failing on /status.

TikTok's, Instagram's and Pinterest's terms ban scraping, so these sources are your call.

## 13. Anthropic and OpenAI (optional)

- Anthropic Console API key → `ANTHROPIC_API_KEY`, for Claude Haiku 4.5 topic names (about $3.24 a month).
- OpenAI API key → `OPENAI_API_KEY`, only if you chose OpenAI embeddings in phase 2 (about $0.06 a month).

## 14. Read-only role for research (phase 5)

The research notebooks read the database as `research_reader`, a role that can only read. Migration `0002_research_reader` creates it without a login, so no password is ever in the public repository.

1. Wait until migration 0002 has been applied: it runs with the `migrate` workflow when its branch reaches `main`, or run `migrate` from the Actions tab.
2. In Supabase, open **SQL Editor › New query** and run the line below, putting in a new password of letters and digits (not the main database password):

    ```sql
    alter role research_reader with login password 'NEW-PASSWORD';
    ```

    Then clear that query from the editor so the password isn't kept in your query history.
3. On your computer, from the repo root, run `powershell -ExecutionPolicy Bypass -File scripts/set-research-url.ps1`. It asks for that password once, hidden, and writes `RESEARCH_DATABASE_URL` to `.env.local`.
4. Don't add it to GitHub or Vercel; only the notebooks use it. To revoke access at any time, run `alter role research_reader nologin;`.

## Environment variables

| Variable | What it is | Used by | Where it goes | Phase |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Supabase transaction pooler string (port 6543) | Website | Vercel env var; `.env.local` for local dev | 0 |
| `SESSION_DATABASE_URL` | Supabase session pooler string (port 5432) | Pipeline, migrations | GitHub secret; `.env.local` for local dev | 0 |
| `GH_DISPATCH_TOKEN` | Fine-grained token with Actions read and write on this repo | Cloudflare Worker | GitHub secret (copied to the Worker on deploy) | 0 |
| `CLOUDFLARE_API_TOKEN` | Token from the "Edit Cloudflare Workers" template | Worker deploy workflow | GitHub secret | 0 |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID | Worker deploy workflow | GitHub secret | 0 |
| `DISABLED_SOURCES` | Optional comma-separated source ids to skip, for example `tiktok,twitch` | Pipeline | GitHub variable | 0 |
| `SITE_URL` | The site's production domain | Pipeline (revalidation call) | GitHub variable | 1 |
| `REVALIDATE_SECRET` | Random string, 32+ characters | Website, pipeline | Vercel env var; GitHub secret | 1 |
| `COLLECTOR_USER_AGENT` | For example `top10-trends/0.1 (+https://top10-trends.vercel.app)` | Collectors | GitHub variable | 1 |
| `YOUTUBE_API_KEY` | Google Cloud API key | YouTube collector | GitHub secret | 1 |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Twitch app credentials | Twitch collector | GitHub secrets | 1 |
| `MASTODON_INSTANCE` | Optional; defaults to `mastodon.social` | Mastodon collector | GitHub variable | 1 |
| `OPENAI_API_KEY` | Only if you chose OpenAI embeddings | Embeddings | GitHub secret | 2 |
| `X_BEARER_TOKEN` | X app Bearer token | X collector | GitHub secret | 3 |
| `APIFY_TOKEN` | Apify API token | TikTok, Instagram and Pinterest collectors | GitHub secret | 3 |
| `TIKTOK_ENABLED` | `true` to turn TikTok on | TikTok collector | GitHub variable | 3 |
| `INSTAGRAM_ENABLED` | `true` to turn Instagram on | Instagram collector | GitHub variable | 3 |
| `PINTEREST_ENABLED` | `true` to turn Pinterest on | Pinterest collector | GitHub variable | 3 |
| `ANTHROPIC_API_KEY` | Anthropic API key | Topic names | GitHub secret | 3 |
| `RESEARCH_DATABASE_URL` | Session pooler string for the read-only `research_reader` role (§14) | Research notebooks | `.env.local` only, never GitHub or Vercel | 5 |

`GH_OWNER` and `GH_REPO` are not secrets; they live in `worker/wrangler.toml`, filled in by task 0.7.
