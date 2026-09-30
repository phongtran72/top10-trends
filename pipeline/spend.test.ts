import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planSources } from "@/collectors/registry";
import { fetchRuns } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { upsertSources } from "./sources";
import { applyPaidLimits, startOfUtcDay, xRequestsToday } from "./spend";

let t: Awaited<ReturnType<typeof createTestDb>>;
const now = new Date("2026-10-08T12:07:00Z");

beforeAll(async () => {
  t = await createTestDb();
  await upsertSources(t.db, planSources({ collectors: new Set(), disabled: [], env: {} }));
  const run = (at: string, status: string) => ({ sourceId: "x", region: "global", startedAt: new Date(at), finishedAt: new Date(at), status });
  await t.db.insert(fetchRuns).values([
    run("2026-10-07T23:07:00Z", "ok"), // yesterday
    run("2026-10-08T00:07:00Z", "ok"),
    run("2026-10-08T01:07:00Z", "error"), // reached X, so it counts
    run("2026-10-08T02:07:00Z", "skipped"), // never reached X
  ]);
});

afterAll(async () => {
  await t.close();
});

const xPlans = () => planSources({ collectors: new Set(["x", "bluesky"]), disabled: [], env: { X_BEARER_TOKEN: "t" } });
const xAction = (plans: ReturnType<typeof xPlans>) => plans.find((p) => p.source.id === "x")!;

describe("X spend limits", () => {
  it("counts today's X requests that reached X", async () => {
    expect(startOfUtcDay(now).toISOString()).toBe("2026-10-08T00:00:00.000Z");
    await expect(xRequestsToday(t.db, now)).resolves.toBe(2);
  });

  it("allows X while today's requests plus this run's two regions fit under the cap", () => {
    expect(xAction(applyPaidLimits(xPlans(), { dryRun: false, includePaid: false, xRequestsToday: 58 })).action).toBe("run");
  });

  it("skips X at the daily cap", () => {
    expect(xAction(applyPaidLimits(xPlans(), { dryRun: false, includePaid: false, xRequestsToday: 59 }))).toMatchObject({
      action: "skip",
      reason: "daily cap (59 of 60 requests used today)",
    });
  });

  it("skips X in a dry run unless paid sources are asked for", () => {
    expect(xAction(applyPaidLimits(xPlans(), { dryRun: true, includePaid: false, xRequestsToday: null }))).toMatchObject({
      action: "skip",
      reason: "dry run: X is billed per request (add --include-paid)",
    });
    expect(xAction(applyPaidLimits(xPlans(), { dryRun: true, includePaid: true, xRequestsToday: null })).action).toBe("run");
  });

  it("leaves other sources alone", () => {
    const plans = applyPaidLimits(xPlans(), { dryRun: true, includePaid: false, xRequestsToday: 60 });
    expect(plans.find((p) => p.source.id === "bluesky")!.action).toBe("run");
  });
});
