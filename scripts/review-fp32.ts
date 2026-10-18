import { writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { rankings, topicItems, topics, trendItems } from "@/db/schema";
import { createTestDb as createScratchDb } from "@/db/test-db";
import { createEmbedder, type Embedder } from "@/lib/embed";
import { pipelineEnv } from "@/lib/env";
import { loadLocalEnv } from "@/lib/local-env";
import { nameKey } from "@/lib/text";
import { createPipelineDb } from "@/pipeline/db";
import { loadBlocklist } from "@/pipeline/filter";
import { copyLists, loadSlots, memoEmbedder, replaySlots, resetDerived, tuneStats } from "@/pipeline/replay";

// Read-only experiment (2026-10-18): the stored hours with match text replayed
// under r7 with today's 8-bit model at 0.86 (the baseline) and with the
// full-precision model at several thresholds, in one process so each model
// embeds each text once. Writes the numbers and, for each fp32 threshold, the
// joins it makes that the baseline doesn't and the other way round.

const SINCE = new Date("2026-10-02T18:00:00Z");
const HOUR = 3_600_000;
const VARIANTS = [
  { name: "q8 at 0.86 (as live)", dtype: "q8" as const, threshold: 0.86 },
  { name: "fp32 at 0.84", dtype: "fp32" as const, threshold: 0.84 },
  { name: "fp32 at 0.86", dtype: "fp32" as const, threshold: 0.86 },
  { name: "fp32 at 0.88", dtype: "fp32" as const, threshold: 0.88 },
  { name: "fp32 at 0.90", dtype: "fp32" as const, threshold: 0.9 },
];

async function main() {
  loadLocalEnv();
  const out = process.argv[2];
  const live = createPipelineDb(pipelineEnv({ dryRun: false }).SESSION_DATABASE_URL);
  const scratch = await createScratchDb();
  const items = await copyLists(live.db, scratch.db, SINCE);
  await live.close();
  const slots = await loadSlots(scratch.db);
  console.log(`${items} items, ${slots.length} hourly slots`);
  const embedders = new Map<string, Embedder>();
  const blocklist = loadBlocklist();
  const results = [];
  for (const variant of VARIANTS) {
    const started = Date.now();
    if (!embedders.has(variant.dtype)) embedders.set(variant.dtype, memoEmbedder(await createEmbedder(variant.dtype)));
    await resetDerived(scratch.db);
    await replaySlots(scratch.db, slots, {
      embedder: embedders.get(variant.dtype)!,
      blocklist,
      threshold: variant.threshold,
      onSlot: (i) => {
        if ((i + 1) % 24 === 0) console.log(`${variant.name}: ${i + 1}/${slots.length} slots, ${Math.round((Date.now() - started) / 1000)} s`);
      },
    });
    const stats = await tuneStats(scratch.db, variant.threshold);

    const members = await scratch.db
      .select({ topicId: topicItems.topicId, sourceId: trendItems.sourceId, title: trendItems.title, fetchedAt: trendItems.fetchedAt })
      .from(topicItems)
      .innerJoin(trendItems, eq(trendItems.id, topicItems.itemId));
    const byTopic = new Map<number, typeof members>();
    for (const m of members) byTopic.set(m.topicId, [...(byTopic.get(m.topicId) ?? []), m]);
    // Every pair of different names that ended up in one topic, and the topics
    // whose members came from six or more different names on two or more platforms.
    const pairs: Record<string, string> = {};
    let mixed = 0;
    for (const list of byTopic.values()) {
      const names = new Map<string, string>();
      for (const m of list) if (!names.has(nameKey(m.title))) names.set(nameKey(m.title), `${m.sourceId}: ${m.title}`);
      if (names.size >= 6 && new Set(list.map((m) => m.sourceId)).size >= 2) mixed += 1;
      const keys = [...names.keys()].sort();
      for (let a = 0; a < keys.length; a++) for (let b = a + 1; b < keys.length; b++) pairs[`${keys[a]}|${keys[b]}`] = `${names.get(keys[a])}  +  ${names.get(keys[b])}`;
    }
    const labelOf = new Map((await scratch.db.select({ id: topics.id, label: topics.label }).from(topics)).map((t) => [t.id, t.label]));
    const places = await scratch.db
      .select({ at: rankings.computedAt, topicId: rankings.topicId })
      .from(rankings)
      .where(and(eq(rankings.list, "combined"), eq(rankings.region, "global")));
    let staleLabels = 0;
    for (const place of places) {
      if (place.topicId === null) continue;
      const at = place.at.getTime();
      const current = (byTopic.get(place.topicId) ?? []).filter((m) => m.fetchedAt.getTime() > at - 3 * HOUR && m.fetchedAt.getTime() < at + HOUR / 4);
      if (!current.some((m) => nameKey(m.title) === nameKey(labelOf.get(place.topicId!) ?? ""))) staleLabels += 1;
    }

    const { crossPlatform, ...numbers } = stats;
    const seconds = Math.round((Date.now() - started) / 1000);
    const summary = { variant: variant.name, seconds, ...numbers, crossPlatform: crossPlatform.length, mixed, namePairs: Object.keys(pairs).length, staleLabels };
    console.log(JSON.stringify(summary));
    results.push({ summary, pairs });
  }
  const [base, ...others] = results;
  const diffs = others.map((other) => {
    const lost = Object.keys(base.pairs).filter((k) => !(k in other.pairs)).map((k) => base.pairs[k]);
    const gained = Object.keys(other.pairs).filter((k) => !(k in base.pairs)).map((k) => other.pairs[k]);
    console.log(`${other.summary.variant}: ${lost.length} pairs only in the baseline, ${gained.length} only here`);
    return { variant: other.summary.variant, lost, gained };
  });
  if (out) writeFileSync(out, JSON.stringify({ summaries: results.map((r) => r.summary), diffs }, null, 1));
  await scratch.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
