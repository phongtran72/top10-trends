import { writeFileSync } from "node:fs";
import { createTestDb as createScratchDb } from "@/db/test-db";
import { createEmbedder } from "@/lib/embed";
import { describeError } from "@/lib/errors";
import { pipelineEnv } from "@/lib/env";
import { loadLocalEnv } from "@/lib/local-env";
import { setSegmentation } from "@/lib/segment";
import { createPipelineDb } from "@/pipeline/db";
import { loadBlocklist } from "@/pipeline/filter";
import {
  copyLists,
  formatTuneStats,
  loadSlots,
  memoEmbedder,
  rebuildCheck,
  replaySlots,
  resetDerived,
  tuneStats,
} from "@/pipeline/replay";

// Replays stored hourly lists through the rank step.
//
//   npm run replay -- tune [--days 7] [--thresholds 0.55,0.6,0.65,0.7,0.8] [--no-segment] [--no-name-match] [--out report.md]
//     Read-only: copies the lists into an in-memory database, replays every
//     hour at each threshold and reports the cross-platform merges, to pick
//     MATCH_THRESHOLD (TASKS.md 2.9). --no-segment leaves one-word lowercase
//     hashtags unsplit, to compare with lib/segment.ts off. --no-name-match
//     turns off joining by exact name, to compare with vectors alone.
//
//   npm run replay -- rebuild --threshold 0.6 --yes
//     Writes: deletes topics, rankings and snapshots in SESSION_DATABASE_URL
//     and rebuilds them from every stored list (the backfill). Refuses if that
//     would lose history the stored lists no longer cover.

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

function parseThreshold(value: string): number {
  const n = Number(value);
  if (!(n > 0 && n < 1)) throw new Error(`threshold must be between 0 and 1: ${value}`);
  return n;
}

async function tune(argv: readonly string[]) {
  const days = Number(option(argv, "days") ?? 7);
  const thresholds = (option(argv, "thresholds") ?? "0.55,0.6,0.65,0.7,0.75,0.8").split(",").map(parseThreshold);
  const segment = !argv.includes("--no-segment");
  const nameMatch = !argv.includes("--no-name-match");
  setSegmentation(segment);
  const env = pipelineEnv({ dryRun: false });
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const live = createPipelineDb(env.SESSION_DATABASE_URL);
  const scratch = await createScratchDb();
  try {
    const items = await copyLists(live.db, scratch.db, since);
    await live.close();
    const slots = await loadSlots(scratch.db);
    console.log(`replay: ${items} stored items in ${slots.length} hourly slots since ${since.toISOString().slice(0, 16)} UTC`);
    const embedder = memoEmbedder(await createEmbedder());
    const blocklist = loadBlocklist();
    const report = [
      "# Matching threshold replay",
      "",
      `${slots.length} hourly slots, ${items} stored items. Replay reads what was stored at the time: Bluesky's status from 2026-10-01 15:07 UTC, headlines and descriptions from 2026-10-02 18:07 UTC; earlier hours match on titles only.`,
      `One-word lowercase hashtags ${segment ? "are split into words" : "are left unsplit (--no-segment)"}. Items ${nameMatch ? "join a topic with exactly their name" : "are matched by vectors alone (--no-name-match)"}.`,
      "Look for wrong merges: the highest threshold with none is the one to pick.",
      "",
    ];
    for (const threshold of thresholds) {
      await resetDerived(scratch.db);
      await replaySlots(scratch.db, slots, { threshold, embedder, blocklist, nameMatch });
      const lines = formatTuneStats(await tuneStats(scratch.db, threshold), 400);
      report.push(...lines);
      console.log(lines.slice(0, 2).join(" "));
    }
    const out = option(argv, "out");
    if (out) {
      writeFileSync(out, report.join("\n"));
      console.log(`replay: report written to ${out}`);
    } else {
      console.log(report.join("\n"));
    }
  } finally {
    await scratch.close();
  }
}

async function rebuild(argv: readonly string[]) {
  const value = option(argv, "threshold");
  if (!value) throw new Error("rebuild needs --threshold");
  const threshold = parseThreshold(value);
  if (!argv.includes("--yes")) throw new Error("rebuild deletes and rebuilds topics, rankings and snapshots; add --yes to go ahead");
  const env = pipelineEnv({ dryRun: false });
  const { db, close } = createPipelineDb(env.SESSION_DATABASE_URL);
  try {
    const check = await rebuildCheck(db);
    if (!check.safe) {
      throw new Error(
        `refusing: derived data goes back to ${check.oldestDerived?.toISOString()} but stored lists only to ` +
          `${check.oldestList?.toISOString()}, so a rebuild would lose history`,
      );
    }
    const slots = await loadSlots(db);
    console.log(`rebuild: ${slots.length} hourly slots at threshold ${threshold}`);
    await resetDerived(db);
    const { created } = await replaySlots(db, slots, {
      threshold,
      embedder: memoEmbedder(await createEmbedder()),
      blocklist: loadBlocklist(),
      onSlot: (i) => {
        if ((i + 1) % 24 === 0) console.log(`rebuild: ${i + 1}/${slots.length} slots`);
      },
    });
    console.log(`rebuild: done, ${created} topics`);
  } finally {
    await close();
  }
}

async function main() {
  loadLocalEnv();
  const [command, ...argv] = process.argv.slice(2);
  if (command === "tune") await tune(argv);
  else if (command === "rebuild") await rebuild(argv);
  else throw new Error("usage: npm run replay -- tune [--days 7] [--thresholds …] [--out file] | rebuild --threshold 0.6 --yes");
}

main().catch((error: unknown) => {
  console.error(`replay: failed: ${describeError(error)}`);
  process.exit(1);
});
