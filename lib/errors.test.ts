import { describe, expect, it } from "vitest";
import { describeError } from "./errors";

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
