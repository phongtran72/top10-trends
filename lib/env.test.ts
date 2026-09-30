import { describe, expect, it } from "vitest";
import { EnvError, pipelineEnv, readKeys, revalidateEnv, siteEnv } from "./env";

const dbUrl = "postgresql://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
const sessionUrl = "postgresql://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres";
const secret = "s".repeat(32);

describe("siteEnv", () => {
  it("accepts a postgres URL", () => {
    expect(siteEnv({ DATABASE_URL: dbUrl })).toEqual({ DATABASE_URL: dbUrl });
  });

  it("names the missing variable without leaking values", () => {
    expect(() => siteEnv({})).toThrow(EnvError);
    expect(() => siteEnv({})).toThrow(/DATABASE_URL/);
    expect(() => siteEnv({ DATABASE_URL: "https://secret-host" })).not.toThrow(/secret-host/);
  });

  it("treats a blank value as missing", () => {
    expect(() => siteEnv({ DATABASE_URL: "  " })).toThrow(/DATABASE_URL/);
  });
});

describe("revalidateEnv", () => {
  it("requires at least 32 characters", () => {
    expect(() => revalidateEnv({ REVALIDATE_SECRET: "short" })).toThrow(/REVALIDATE_SECRET/);
    expect(revalidateEnv({ REVALIDATE_SECRET: secret }).REVALIDATE_SECRET).toBe(secret);
  });
});

describe("pipelineEnv", () => {
  it("needs no database for a dry run", () => {
    const env = pipelineEnv({ dryRun: true }, {});
    expect(env.dryRun).toBe(true);
    expect(env.revalidate).toBeNull();
    expect(env.DISABLED_SOURCES).toEqual([]);
    expect(env.MASTODON_INSTANCE).toBe("mastodon.social");
  });

  it("requires SESSION_DATABASE_URL for a full run", () => {
    expect(() => pipelineEnv({ dryRun: false }, {})).toThrow(/SESSION_DATABASE_URL/);
    const env = pipelineEnv({ dryRun: false }, { SESSION_DATABASE_URL: sessionUrl });
    expect(env.SESSION_DATABASE_URL).toBe(sessionUrl);
  });

  it("enables revalidation only when both SITE_URL and REVALIDATE_SECRET are set", () => {
    expect(pipelineEnv({ dryRun: true }, { SITE_URL: "https://example.com" }).revalidate).toBeNull();
    expect(
      pipelineEnv({ dryRun: true }, { SITE_URL: "https://example.com/", REVALIDATE_SECRET: secret }).revalidate,
    ).toEqual({ siteUrl: "https://example.com", secret });
  });

  it("parses DISABLED_SOURCES as a lowercase list", () => {
    expect(pipelineEnv({ dryRun: true }, { DISABLED_SOURCES: " TikTok, twitch ,," }).DISABLED_SOURCES).toEqual([
      "tiktok",
      "twitch",
    ]);
  });

  it("rejects a Mastodon instance given as a URL", () => {
    expect(() => pipelineEnv({ dryRun: true }, { MASTODON_INSTANCE: "https://mastodon.social" })).toThrow(
      /MASTODON_INSTANCE/,
    );
  });
});

describe("readKeys", () => {
  it("splits present and missing keys, treating blank as missing", () => {
    expect(readKeys(["A", "B", "C"], { A: "1", B: "" })).toEqual({ values: { A: "1" }, missing: ["B", "C"] });
  });
});
