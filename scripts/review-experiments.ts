import { writeFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { rankings, topicItems, topics, trendItems } from "@/db/schema";
import { createTestDb as createScratchDb } from "@/db/test-db";
import { createEmbedder } from "@/lib/embed";
import { pipelineEnv } from "@/lib/env";
import { loadLocalEnv } from "@/lib/local-env";
import { nameKey } from "@/lib/text";
import { createPipelineDb } from "@/pipeline/db";
import { loadBlocklist } from "@/pipeline/filter";
import { copyLists, loadSlots, memoEmbedder, replaySlots, resetDerived, tuneStats } from "@/pipeline/replay";

// Read-only (2026-10 review): replays the stored hours that have
// match text under several matching variants, in one process so the embeddings
// are computed once, and writes the numbers and examples to a JSON file.

const SINCE = new Date("2026-10-02T17:34:00Z");
const VARIANTS = [
  { name: "as live (0.86, running mean, no age cap)", threshold: 0.86 },
  { name: "frozen centroid", threshold: 0.86, freezeCentroid: true },
  { name: "age cap 48 h", threshold: 0.86, maxTopicAgeHours: 48 },
  { name: "age cap 24 h", threshold: 0.86, maxTopicAgeHours: 24 },
  { name: "frozen centroid + age cap 48 h", threshold: 0.86, freezeCentroid: true, maxTopicAgeHours: 48 },
  { name: "frozen centroid at 0.84", threshold: 0.84, freezeCentroid: true },
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
  const embedder = memoEmbedder(await createEmbedder());
  const blocklist = loadBlocklist();
  const results = [];
  for (const variant of VARIANTS) {
    const started = Date.now();
    await resetDerived(scratch.db);
    await replaySlots(scratch.db, slots, { embedder, blocklist, ...variant });
    const stats = await tuneStats(scratch.db, variant.threshold);
    // The topics with the most hours in the Global top 10, with how many names each gathered.
    const top = await scratch.db
      .select({ id: topics.id, label: topics.label, firstSeen: topics.firstSeen, hours: sql<number>`count(*)`.mapWith(Number) })
      .from(rankings)
      .innerJoin(topics, eq(topics.id, rankings.topicId))
      .where(and(eq(rankings.list, "combined"), eq(rankings.region, "global")))
      .groupBy(topics.id, topics.label, topics.firstSeen)
      .orderBy(sql`count(*) desc`)
      .limit(25);
    const longest = [];
    for (const topic of top) {
      const members = await scratch.db
        .select({ title: trendItems.title, sourceId: trendItems.sourceId })
        .from(topicItems)
        .innerJoin(trendItems, eq(trendItems.id, topicItems.itemId))
        .where(eq(topicItems.topicId, topic.id));
      const names = new Map<string, string>();
      for (const member of members) if (!names.has(nameKey(member.title))) names.set(nameKey(member.title), `${member.sourceId}: ${member.title}`);
      longest.push({ label: topic.label, firstSeen: topic.firstSeen.toISOString().slice(5, 16), hoursInTop10: topic.hours, names: names.size, examples: [...names.values()].slice(0, 8) });
    }
    const { crossPlatform, ...numbers } = stats;
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(JSON.stringify({ variant: variant.name, seconds, ...numbers, crossPlatform: crossPlatform.length }));
    results.push({ variant, seconds, numbers, crossPlatform, longest });
  }
  if (out) writeFileSync(out, JSON.stringify(results, null, 1));
  await scratch.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
