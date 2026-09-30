import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./test-db";

// Migration 0002: the research_reader role can read every table through its
// row-level-security policies, and can't write anything. Every later table
// needs its own research_read policy; the table list here comes from the
// database, so a new table without one fails this test.

let t: Awaited<ReturnType<typeof createTestDb>>;
let TABLES: string[];

beforeAll(async () => {
  t = await createTestDb();
  await t.client.exec(`insert into sources (id, name, role, weight, enabled, regions) values ('bluesky', 'Bluesky', 'lead', 0.5, true, '{global}')`);
  const { rows } = await t.client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );
  TABLES = rows.map((r) => r.tablename);
});

afterAll(async () => {
  await t.close();
});

async function asReader<T>(query: string): Promise<T[]> {
  await t.client.exec("set role research_reader");
  try {
    return (await t.client.query<T>(query)).rows;
  } finally {
    await t.client.exec("reset role");
  }
}

describe("research_reader", () => {
  it("exists without a login and defaults to read-only transactions", async () => {
    const { rows } = await t.client.query<{ rolcanlogin: boolean; rolconfig: string[] | null }>(
      "select rolcanlogin, rolconfig from pg_roles where rolname = 'research_reader'",
    );
    expect(rows).toEqual([{ rolcanlogin: false, rolconfig: ["default_transaction_read_only=on"] }]);
  });

  it("has a read policy on every table", async () => {
    const { rows } = await t.client.query<{ tablename: string }>(
      "select tablename from pg_policies where policyname = 'research_read' and 'research_reader' = any(roles) order by tablename",
    );
    expect(TABLES).toContain("tiktok_curves");
    expect(rows.map((r) => r.tablename)).toEqual(TABLES);
  });

  it("reads rows despite row-level security", async () => {
    expect(await asReader<{ id: string }>("select id from sources")).toEqual([{ id: "bluesky" }]);
    for (const table of TABLES) await expect(asReader(`select count(*) from ${table}`)).resolves.toHaveLength(1);
  });

  it("cannot insert, update or delete", async () => {
    await expect(
      asReader(`insert into sources (id, name, role, weight, enabled, regions) values ('x', 'X', 'lead', 1, true, '{global}')`),
    ).rejects.toThrow(/permission denied/);
    await expect(asReader(`update sources set weight = 9`)).rejects.toThrow(/permission denied/);
    await expect(asReader(`delete from sources`)).rejects.toThrow(/permission denied/);
  });
});
