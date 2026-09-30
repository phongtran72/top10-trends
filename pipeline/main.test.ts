import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchRuns, sources } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { parseArgs, runPipeline } from "./main";

let t: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

function capture() {
  const lines: string[] = [];
  return { lines, log: (line: string) => lines.push(line) };
}

const sessionUrl = "postgresql://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres";

describe("parseArgs", () => {
  it("accepts --dry-run and rejects anything else", () => {
    expect(parseArgs([])).toEqual({ dryRun: false });
    expect(parseArgs(["--dry-run"])).toEqual({ dryRun: true });
    expect(() => parseArgs(["--dryrun"])).toThrow(/unknown argument/);
  });
});

describe("runPipeline", () => {
  it("dry run prints the plan and never opens the database", async () => {
    const out = capture();
    await runPipeline(["--dry-run"], { DISABLED_SOURCES: "tiktock" }, {
      openDb: () => {
        throw new Error("should not open the database");
      },
      log: out.log,
    });
    expect(out.lines[0]).toBe("warning: DISABLED_SOURCES has unknown ids: tiktock");
    expect(out.lines).toContain("sources:");
    expect(out.lines.at(-1)).toMatch(/^dry run: nothing written, 0 sources run, 0 skipped, 10 not built yet \(\d+ ms\)$/);
  });

  it("full run upserts sources and writes one heartbeat row", async () => {
    const out = capture();
    let closed = false;
    const times = [new Date("2026-09-29T12:07:00Z"), new Date("2026-09-29T12:07:01Z")];
    await runPipeline([], { SESSION_DATABASE_URL: sessionUrl }, {
      openDb: (url) => {
        expect(url).toBe(sessionUrl);
        return { db: t.db, close: async () => void (closed = true) };
      },
      log: out.log,
      now: () => times.shift() ?? new Date("2026-09-29T12:07:01Z"),
    });

    expect(closed).toBe(true);
    expect(await t.db.select().from(sources)).toHaveLength(11);
    const runs = await t.db.select().from(fetchRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      sourceId: "heartbeat",
      region: "global",
      status: "ok",
      itemCount: 0,
      startedAt: new Date("2026-09-29T12:07:00Z"),
      finishedAt: new Date("2026-09-29T12:07:01Z"),
    });
    expect(out.lines).toEqual(["run ok: heartbeat written, 0 sources run, 0 skipped, 10 not built yet (1000 ms)"]);
  });

  it("fails a full run without SESSION_DATABASE_URL", async () => {
    await expect(runPipeline([], {}, { openDb: () => ({ db: t.db, close: async () => {} }), log: () => {} })).rejects.toThrow(
      /SESSION_DATABASE_URL/,
    );
  });
});
