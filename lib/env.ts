import { z } from "zod";

// Environment variables are validated per consumer, at first use, so that
// `next build` and `--dry-run` work with nothing set. Error messages name the
// variables only, never their values. App code never reads GH_DISPATCH_TOKEN
// or CLOUDFLARE_*; only the workflows and the Worker use those.

export type RawEnv = Record<string, string | undefined>;

export class EnvError extends Error {
  override name = "EnvError";
}

// GitHub Actions passes an unset secret or variable as "", so treat blank as unset.
function clean(raw: RawEnv): RawEnv {
  const out: RawEnv = {};
  for (const [key, value] of Object.entries(raw)) {
    const trimmed = value?.trim();
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

function parse<T extends z.ZodType>(schema: T, consumer: string, raw: RawEnv): z.output<T> {
  const result = schema.safeParse(clean(raw));
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new EnvError(
      `${consumer}: missing or invalid environment variables: ${names.join(", ")} (see .env.example and SETUP.md)`,
    );
  }
  return result.data;
}

const postgresUrl = z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string");
const secret = z.string().min(32, "must be at least 32 characters");
const list = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );

// Site (Vercel): transaction pooler string.
const siteSchema = z.object({ DATABASE_URL: postgresUrl });
export type SiteEnv = z.output<typeof siteSchema>;
export function siteEnv(raw: RawEnv = process.env): SiteEnv {
  return parse(siteSchema, "site", raw);
}

// POST /api/revalidate.
const revalidateSchema = z.object({ REVALIDATE_SECRET: secret });
export type RevalidateEnv = z.output<typeof revalidateSchema>;
export function revalidateEnv(raw: RawEnv = process.env): RevalidateEnv {
  return parse(revalidateSchema, "revalidate", raw);
}

// Pipeline (GitHub Actions): session pooler string, optional revalidation and
// per-source settings. Source API keys are read through readKeys().
const pipelineSchema = z.object({
  SESSION_DATABASE_URL: postgresUrl.optional(),
  SITE_URL: z
    .url({ protocol: /^https?$/ })
    .optional()
    .transform((url) => url?.replace(/\/+$/, "")),
  REVALIDATE_SECRET: secret.optional(),
  DISABLED_SOURCES: list,
  COLLECTOR_USER_AGENT: z.string().optional(),
  MASTODON_INSTANCE: z
    .string()
    .regex(/^[a-z0-9.-]+$/i, "must be a bare host name such as mastodon.social")
    .default("mastodon.social"),
});

type PipelineBase = Omit<z.output<typeof pipelineSchema>, "SESSION_DATABASE_URL">;
export type PipelineEnv = PipelineBase &
  (
    | { dryRun: true; SESSION_DATABASE_URL?: string }
    | { dryRun: false; SESSION_DATABASE_URL: string }
  ) & {
    // Revalidation runs only when both SITE_URL and REVALIDATE_SECRET are set.
    revalidate: { siteUrl: string; secret: string } | null;
  };

export function pipelineEnv(options: { dryRun: boolean }, raw: RawEnv = process.env): PipelineEnv {
  const env = parse(pipelineSchema, "pipeline", raw);
  const revalidate =
    env.SITE_URL && env.REVALIDATE_SECRET ? { siteUrl: env.SITE_URL, secret: env.REVALIDATE_SECRET } : null;
  if (options.dryRun) return { ...env, dryRun: true, revalidate };
  if (!env.SESSION_DATABASE_URL) {
    throw new EnvError(
      "pipeline: missing or invalid environment variables: SESSION_DATABASE_URL (or pass --dry-run; see SETUP.md §2)",
    );
  }
  return { ...env, SESSION_DATABASE_URL: env.SESSION_DATABASE_URL, dryRun: false, revalidate };
}

// A source's API keys. Every key is optional: a missing one skips that source.
export function readKeys(
  names: readonly string[],
  raw: RawEnv = process.env,
): { values: Record<string, string>; missing: string[] } {
  const env = clean(raw);
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const value = env[name];
    if (value) values[name] = value;
    else missing.push(name);
  }
  return { values, missing };
}
