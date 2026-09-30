import { and, count, eq, gte, inArray } from "drizzle-orm";
import type { SourcePlan } from "@/collectors/registry";
import { X_DAILY_REQUEST_CAP } from "@/config/ranking";
import { fetchRuns } from "@/db/schema";
import type { Db } from "./db";

// Paid sources (CLAUDE.md invariant 11). X is billed per request, so it gets
// a hard daily cap counted from fetch_runs, and dry runs leave it out unless
// asked, because a dry run's requests cost money too but write no rows.

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// X requests made so far today (UTC): every run that reached X, successful or not.
export async function xRequestsToday(db: Db, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(fetchRuns)
    .where(and(eq(fetchRuns.sourceId, "x"), inArray(fetchRuns.status, ["ok", "error"]), gte(fetchRuns.startedAt, startOfUtcDay(now))));
  return Number(row?.n ?? 0);
}

export function applyPaidLimits(
  plans: readonly SourcePlan[],
  options: { dryRun: boolean; includePaid: boolean; xRequestsToday: number | null; cap?: number },
): SourcePlan[] {
  const cap = options.cap ?? X_DAILY_REQUEST_CAP;
  return plans.map((plan): SourcePlan => {
    if (plan.source.id !== "x" || plan.action !== "run") return plan;
    if (options.dryRun && !options.includePaid) {
      return { source: plan.source, action: "skip", reason: "dry run: X is billed per request (add --include-paid)" };
    }
    if (options.xRequestsToday !== null && options.xRequestsToday + plan.source.regions.length > cap) {
      return { source: plan.source, action: "skip", reason: `daily cap (${options.xRequestsToday} of ${cap} requests used today)` };
    }
    return plan;
  });
}
