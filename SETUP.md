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
    - Phase 3, only for the sources you add: `api.x.com`, `www.reddit.com`, `oauth.reddit.com`, `api.pinterest.com`, `api.apify.com`, `api.anthropic.com`, `api.openai.com`

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

## 9. Reddit (apply in week 1; add in phase 3)

1. Read Reddit's [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy), then request non-commercial access as described in [Accessing Reddit data](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data).
2. Once approved, create the app as instructed → `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`. Set `REDDIT_USERNAME`, which goes into Reddit's required User-Agent.

If Reddit refuses, the site runs without it.

## 10. X (open the account in week 1; add in phase 3)

1. Create a developer account and an app ([getting access](https://docs.x.com/x-api/getting-started/getting-access)).
2. Buy a small amount of pay-per-use credit. Hourly polling of Worldwide and US costs about $14.40 a month at [$0.010 per request](https://docs.x.com/x-api/getting-started/pricing). Set a spending limit if the console offers one; the code also caps X at 60 requests a day.
3. Copy the app's Bearer token → `X_BEARER_TOKEN`.

## 11. Pinterest (optional, phase 3)

A business account, then an app at [developers.pinterest.com](https://developers.pinterest.com/docs/getting-started/set-up-app/). Wait for the review that grants Trial access, then generate an access token with the `user_accounts:read` scope → `PINTEREST_ACCESS_TOKEN`. Pinterest tokens expire; task 3.4 handles the refresh.

## 12. Apify, for TikTok (optional, phase 3)

Create an [Apify](https://apify.com/pricing) account (the free plan includes $5 of usage a month), copy your API token → `APIFY_TOKEN`, and set `TIKTOK_ENABLED` to `true`. TikTok's terms ban scraping, so this source is your call.

## 13. Anthropic and OpenAI (optional)

- Anthropic Console API key → `ANTHROPIC_API_KEY`, for Claude Haiku 4.5 topic names (about $3.24 a month).
- OpenAI API key → `OPENAI_API_KEY`, only if you chose OpenAI embeddings in phase 2 (about $0.06 a month).

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
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | Reddit app credentials | Reddit collector | GitHub secrets | 3 |
| `REDDIT_USERNAME` | Your Reddit username, for the User-Agent | Reddit collector | GitHub variable | 3 |
| `PINTEREST_ACCESS_TOKEN` | Pinterest token (plus any refresh credentials) | Pinterest collector | GitHub secret | 3 |
| `APIFY_TOKEN` | Apify API token | TikTok collector | GitHub secret | 3 |
| `TIKTOK_ENABLED` | `true` to turn TikTok on | TikTok collector | GitHub variable | 3 |
| `ANTHROPIC_API_KEY` | Anthropic API key | Topic names | GitHub secret | 3 |

`GH_OWNER` and `GH_REPO` are not secrets; they live in `worker/wrangler.toml`, filled in by task 0.7.
