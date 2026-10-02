import { ZodError } from "zod";
import type { SourceDef, SourceId, SourcePlan } from "@/collectors/registry";
import type { Collector, CollectorContext, Region, TrendItem } from "@/collectors/types";
import { fetchRuns, trendItems } from "@/db/schema";
import { HttpError, shortReason } from "@/lib/http";
import type { Db } from "./db";

// Collect step (CLAUDE.md invariant 2): every runnable collector fetches each
// of its regions in parallel, each with a 30-second budget and its own
// try/catch, so one failing source never fails the run. Skipped sources get a
// `skipped` row with the reason.

export interface ListResult {
  source: SourceDef;
  region: Region;
  status: "ok" | "error" | "skipped";
  items: TrendItem[];
  error?: string;
  startedAt: Date;
  finishedAt: Date;
}

export const COLLECTOR_BUDGET_MS = 30_000;

// Status code, host and a short reason; never a URL (invariant 12).
export function describeCollectorError(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const path = issue?.path.join(".") || "(root)";
    return shortReason(`unexpected response: ${path}: ${issue?.message ?? "invalid"}`);
  }
  if (error instanceof Error) return shortReason(error.message) || error.name;
  return shortReason(String(error));
}

function withBudget<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`over the ${ms / 1000}s budget`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function collect(
  plans: readonly SourcePlan[],
  collectors: ReadonlyMap<SourceId, Collector>,
  ctx: CollectorContext,
  options: { budgetMs?: number; now?: () => Date } = {},
): Promise<ListResult[]> {
  const now = options.now ?? (() => new Date());
  const budgetMs = options.budgetMs ?? COLLECTOR_BUDGET_MS;
  const tasks: Promise<ListResult>[] = [];

  for (const plan of plans) {
    if (plan.source.role === "system" || plan.action === "absent") continue;
    const collector = collectors.get(plan.source.id);
    for (const region of plan.source.regions) {
      if (plan.action === "skip" || !collector) {
        const at = now();
        const reason = plan.action === "skip" ? plan.reason : "no collector";
        tasks.push(
          Promise.resolve({ source: plan.source, region, status: "skipped", items: [], error: reason, startedAt: at, finishedAt: at }),
        );
        continue;
      }
      tasks.push(
        (async (): Promise<ListResult> => {
          const startedAt = now();
          try {
            const items = await withBudget(collector.fetch(region, ctx), budgetMs);
            return { source: plan.source, region, status: "ok", items, startedAt, finishedAt: now() };
          } catch (error) {
            return {
              source: plan.source,
              region,
              status: "error",
              items: [],
              error: describeCollectorError(error),
              startedAt,
              finishedAt: now(),
            };
          }
        })(),
      );
    }
  }

  return Promise.all(tasks);
}

// The extra text matching reads (Google Trends' headlines, Bluesky's
// descriptions), kept so a replay of stored lists reads what the live run
// read. Null, not an empty array, when a source provides none.
const MATCH_TEXT_MAX = 5;
const MATCH_TEXT_LENGTH = 1000;
export function storedMatchText(texts: readonly string[] | undefined): string[] | null {
  const kept = (texts ?? []).map((text) => text.trim().slice(0, MATCH_TEXT_LENGTH)).filter(Boolean).slice(0, MATCH_TEXT_MAX);
  return kept.length > 0 ? kept : null;
}

// One fetch_runs row per source and region, plus that list's trend_items in
// one batch. Only the columns in PLAN.md › Data model are stored. Returns each
// saved item's trend_items id, for topic matching.
export async function writeResults(db: Db, results: readonly ListResult[]): Promise<Map<TrendItem, number>> {
  const ids = new Map<TrendItem, number>();
  for (const result of results) {
    await db.transaction(async (tx) => {
      const [run] = await tx
        .insert(fetchRuns)
        .values({
          sourceId: result.source.id,
          region: result.region,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          status: result.status,
          itemCount: result.items.length,
          error: result.error ?? null,
        })
        .returning({ id: fetchRuns.id });
      if (result.status !== "ok" || result.items.length === 0) return;
      const inserted = await tx
        .insert(trendItems)
        .values(
          result.items.map((item) => ({
            runId: run.id,
            sourceId: item.source,
            region: item.region,
            rank: item.rank,
            title: item.title.slice(0, 500),
            url: item.url,
            metricValue: item.metricValue ?? null,
            metricLabel: item.metricLabel ?? null,
            // Only Bluesky sets flags.status. Lists are saved before the filters, so the label is kept for
            // every item, including the stale ones the rank step drops.
            status: item.flags?.status?.trim().toLowerCase().slice(0, 32) || null,
            matchText: storedMatchText(item.matchText),
            fetchedAt: result.finishedAt,
          })),
        )
        .returning({ id: trendItems.id, rank: trendItems.rank });
      // Ranks are unique within a list.
      const idByRank = new Map(inserted.map((row) => [row.rank, row.id]));
      for (const item of result.items) ids.set(item, idByRank.get(item.rank)!);
    });
  }
  return ids;
}

const numberFormat = new Intl.NumberFormat("en-US");

// Dry-run output: each list as a small table.
export function formatResults(results: readonly ListResult[]): string[] {
  const lines: string[] = [];
  for (const result of results) {
    const ms = result.finishedAt.getTime() - result.startedAt.getTime();
    const head = `${result.source.id} (${result.region}): ${result.status}`;
    if (result.status !== "ok") {
      lines.push(`${head}: ${result.error ?? ""}`);
      continue;
    }
    lines.push(`${head}, ${result.items.length} items in ${ms} ms`);
    for (const item of result.items) {
      const title = item.title.length > 70 ? `${item.title.slice(0, 67)}...` : item.title;
      const metric = item.metricValue === undefined ? "" : ` · ${numberFormat.format(item.metricValue)} ${item.metricLabel ?? ""}`.trimEnd();
      const flag = item.flags?.status ? ` [${item.flags.status}]` : item.flags?.nsfw ? " [nsfw]" : "";
      lines.push(`  ${String(item.rank).padStart(2)}. ${title}${metric}${flag}  ${item.url}`);
    }
  }
  return lines;
}
