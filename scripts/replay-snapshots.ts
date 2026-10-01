import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MATCH_THRESHOLD } from "@/config/ranking";
import { createTestDb as createScratchDb } from "@/db/test-db";
import { topicSnapshots, topics } from "@/db/schema";
import { createEmbedder } from "@/lib/embed";
import { describeError } from "@/lib/errors";
import { loadLocalEnv } from "@/lib/local-env";
import { createPipelineDb } from "@/pipeline/db";
import { loadBlocklist } from "@/pipeline/filter";
import { copyLists, loadSlots, memoEmbedder, replaySlots } from "@/pipeline/replay";

// npx tsx scripts/replay-snapshots.ts [--threshold 0.86] [--days 28] [--out research/data/replay]
//
// For the research notebooks, before production has topic snapshots. Reads
// the stored lists through RESEARCH_DATABASE_URL (the read-only research
// role), replays every hour through the rank step in an in-memory database,
// and writes its topic snapshots and topics to <out>_snapshots.json and
// <out>_topics.json. Nothing is written to the live database. Snapshots never
// include YouTube; the combined rankings, whose order does, aren't exported.

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

async function main() {
  loadLocalEnv();
  const argv = process.argv.slice(2);
  const threshold = Number(option(argv, "threshold") ?? MATCH_THRESHOLD); // the pipeline's, unless given
  if (!(threshold > 0 && threshold < 1)) throw new Error("--threshold must be between 0 and 1");
  const days = Number(option(argv, "days") ?? 28);
  const out = option(argv, "out") ?? path.join("research", "data", "replay");
  const url = process.env.RESEARCH_DATABASE_URL;
  if (!url) throw new Error("RESEARCH_DATABASE_URL is not set (SETUP.md §14)");
  if (!new URL(url).username.startsWith("research_reader")) throw new Error("RESEARCH_DATABASE_URL must use the research_reader role");

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const live = createPipelineDb(url);
  const scratch = await createScratchDb();
  try {
    const items = await copyLists(live.db, scratch.db, since);
    await live.close();
    const slots = await loadSlots(scratch.db);
    console.log(`replay-snapshots: ${items} stored items in ${slots.length} hourly slots, threshold ${threshold}`);
    await replaySlots(scratch.db, slots, { threshold, embedder: memoEmbedder(await createEmbedder()), blocklist: loadBlocklist() });
    const snapshots = await scratch.db.select().from(topicSnapshots);
    const topicRows = await scratch.db
      .select({ id: topics.id, slug: topics.slug, label: topics.label, firstSeen: topics.firstSeen, lastSeen: topics.lastSeen })
      .from(topics);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(`${out}_snapshots.json`, JSON.stringify(snapshots));
    writeFileSync(`${out}_topics.json`, JSON.stringify(topicRows));
    console.log(`replay-snapshots: ${snapshots.length} snapshots of ${topicRows.length} topics written to ${out}_*.json`);
  } finally {
    await scratch.close();
  }
}

main().catch((error: unknown) => {
  console.error(`replay-snapshots: failed: ${describeError(error)}`);
  process.exit(1);
});
