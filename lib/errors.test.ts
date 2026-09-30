import { describe, expect, it } from "vitest";
import { describeDatabaseUrl, describeError } from "./errors";

describe("describeError", () => {
  it("follows the cause chain and includes error codes", () => {
    const cause = Object.assign(new Error('password authentication failed for user "postgres.abc"'), { code: "28P01" });
    const error = new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"', { cause });
    expect(describeError(error)).toBe(
      'Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle" <- caused by: password authentication failed for user "postgres.abc" [28P01]',
    );
  });

  it("handles non-Error values", () => {
    expect(describeError("boom")).toBe("boom");
  });
});

describe("describeDatabaseUrl", () => {
  const base = "postgresql://postgres.abc:PW@aws-0-us-east-2.pooler.supabase.com:5432/postgres";

  it("outlines the string without the password", () => {
    const text = describeDatabaseUrl(base.replace("PW", "secret123"));
    expect(text).toBe(
      "user=postgres.abc host=aws-0-us-east-2.pooler.supabase.com port=5432 database=postgres password looks well formed",
    );
    expect(text).not.toContain("secret123");
  });

  it("flags the placeholder, brackets and a missing database", () => {
    expect(describeDatabaseUrl(base.replace("PW", "[YOUR-PASSWORD]"))).toContain("placeholder");
    expect(describeDatabaseUrl(base.replace("PW", "[secret123]"))).toContain("remove the brackets");
    expect(describeDatabaseUrl(base.replace(":5432/postgres", ":5432/"))).toContain("database=(none; add /postgres)");
  });
});
