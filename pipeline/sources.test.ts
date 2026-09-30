import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { planSources } from "@/collectors/registry";
import { sources } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { upsertSources } from "./sources";

let t: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

describe("upsertSources", () => {
  it("inserts every source, then updates in place", async () => {
    await upsertSources(t.db, planSources({ collectors: new Set(["bluesky"]), disabled: [], env: {} }));
    const first = await t.db.select().from(sources);
    expect(first).toHaveLength(11);
    expect(first.find((s) => s.id === "bluesky")).toMatchObject({ enabled: true, role: "lead", regions: ["global"] });
    expect(first.find((s) => s.id === "x")).toMatchObject({ enabled: false, regions: ["global", "us"] });

    await upsertSources(t.db, planSources({ collectors: new Set(["bluesky"]), disabled: ["bluesky"], env: {} }));
    const [bluesky] = await t.db.select().from(sources).where(eq(sources.id, "bluesky"));
    expect(bluesky.enabled).toBe(false);
    expect(await t.db.select().from(sources)).toHaveLength(11);
  });
});
