import { writeFileSync } from "node:fs";
import { count } from "drizzle-orm";
import { rankings, topicSnapshots, topics } from "@/db/schema";
import { MAX_TOPIC_AGE_HOURS } from "@/config/ranking";
import { createTestDb as createScratchDb } from "@/db/test-db";
import { createEmbedder } from "@/lib/embed";
import { describeError } from "@/lib/errors";
import { pipelineEnv } from "@/lib/env";
import { loadLocalEnv } from "@/lib/local-env";
import { setSegmentation } from "@/lib/segment";
import { loadCategorizer } from "@/pipeline/category";
import { createPipelineDb } from "@/pipeline/db";
import { loadBlocklist } from "@/pipeline/filter";
import {
  copyLists,
  formatTuneStats,
  liveRunStarts,
  liveTimeOf,
  loadSlots,
  memoEmbedder,
  rebuildCheck,
  replaySlots,
  resetDerived,
  restoreNames,
  saveNames,
  swapDerived,
  tuneStats,
} from "@/pipeline/replay";
import { revalidateSite } from "@/pipeline/revalidate";

// Replays stored hourly lists through the rank step.
//
//   npm run replay -- tune [--days 7] [--thresholds 0.55,0.6,0.65,0.7,0.8] [--no-segment] [--no-name-match] [--no-age-limit] [--out report.md]
//     Read-only: copies the lists into an in-memory database, replays every
//     hour at each threshold and reports the cross-platform merges, to pick
//     MATCH_THRESHOLD (TASKS.md 2.9). --no-segment leaves one-word lowercase
//     hashtags unsplit, to compare with lib/segment.ts off. --no-name-match
//     turns off joining by exact name, to compare with vectors alone.
//     --no-age-limit lets a topic take members at any age, as before r7.
//
//   npm run replay -- rebuild --threshold 0.6 --yes
//     Writes: deletes topics, rankings and snapshots in SESSION_DATABASE_URL
//     and rebuilds them from every stored list (the backfill). Refuses if that
//     would lose history the stored lists no longer cover. The hourly run must
//     be paused while it works, hour by hour, in the database.
//
//   npm run replay -- rebuild --threshold 0.86 --in-memory --rehearse
//     Read-only: builds the whole history in memory from the stored lists, each
//     hour at its live run's start, and says what it built and how long it took.
//
//   npm run replay -- rebuild --threshold 0.86 --in-memory --swap-at 14:30 --yes
//     The same build; then, at that time (UTC, after the hour's catch-up tries),
//     it adds the hours stored since and swaps the result into
//     SESSION_DATABASE_URL in one transaction, between two hourly runs, so no
//     hour is missed. With SITE_URL and REVALIDATE_SECRET set it refreshes the
//     site's cache after the swap.

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
  const maxTopicAgeHours = argv.includes("--no-age-limit") ? Infinity : undefined;
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
      `One-word lowercase hashtags ${segment ? "are split into words" : "are left unsplit (--no-segment)"}. Items ${nameMatch ? "join a topic with exactly their name" : "are matched by vectors alone (--no-name-match)"}. A topic ${maxTopicAgeHours === undefined ? `takes no new member once it is ${MAX_TOPIC_AGE_HOURS} hours old` : "can take members at any age (--no-age-limit)"}.`,
      "Look for wrong merges: the highest threshold with none is the one to pick.",
      "",
    ];
    for (const threshold of thresholds) {
      await resetDerived(scratch.db);
      await replaySlots(scratch.db, slots, { threshold, embedder, blocklist, nameMatch, maxTopicAgeHours });
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

const HOUR_MS = 60 * 60 * 1000;

// The next time it is `hh:mm` UTC, from now.
function nextAt(hhmm: string, now = new Date()): Date {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new Error(`--swap-at must be HH:MM in UTC, for example 14:30: ${hhmm}`);
  const at = new Date(now);
  at.setUTCHours(Number(match[1]), Number(match[2]), 0, 0);
  if (at.getTime() <= now.getTime()) at.setUTCDate(at.getUTCDate() + 1);
  return at;
}

async function rebuildInMemory(argv: readonly string[], threshold: number) {
  const rehearse = argv.includes("--rehearse");
  const swapAt = option(argv, "swap-at");
  if (!rehearse && !swapAt) throw new Error("--in-memory needs --rehearse, or --swap-at HH:MM (UTC) with --yes");
  if (!rehearse && !argv.includes("--yes")) throw new Error("the swap replaces topics, rankings and snapshots; add --yes to go ahead");
  const when = swapAt ? nextAt(swapAt) : null;
  if (when && new Date(when).getUTCMinutes() < 29) throw new Error("swap at :29 or later, after the hour's catch-up tries");
  const env = pipelineEnv({ dryRun: false });
  const live = createPipelineDb(env.SESSION_DATABASE_URL);
  const scratch = await createScratchDb();
  const started = Date.now();
  const log = (line: string) => console.log(`rebuild: ${new Date().toISOString().slice(11, 19)} ${line}`);
  try {
    const check = await rebuildCheck(live.db);
    if (!check.safe) {
      throw new Error(`refusing: derived data goes back to ${check.oldestDerived?.toISOString()} but stored lists only to ${check.oldestList?.toISOString()}`);
    }
    const embedder = memoEmbedder(await createEmbedder());
    const options = { threshold, embedder, blocklist: loadBlocklist(), categorize: loadCategorizer(log) };
    // First every hour whose lists are final: those before the current hour.
    const firstEnd = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS);
    log(`copied ${await copyLists(live.db, scratch.db, undefined, firstEnd)} stored items before ${firstEnd.toISOString()}`);
    const first = await loadSlots(scratch.db);
    await replaySlots(scratch.db, first, {
      ...options,
      nowFor: liveTimeOf(await liveRunStarts(live.db)),
      onSlot: (i) => {
        if ((i + 1) % 24 === 0) log(`${i + 1}/${first.length} hours`);
      },
    });
    log(`built ${first.length} hours in ${Math.round((Date.now() - started) / 60_000)} min`);
    if (when) {
      log(`waiting for the swap at ${when.toISOString()}`);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, when.getTime() - Date.now())));
    }
    // Then the hours stored since, whose lists are final by now.
    const added = await copyLists(live.db, scratch.db, firstEnd);
    const rest = (await loadSlots(scratch.db)).filter((slot) => slot.at.getTime() >= firstEnd.getTime());
    await replaySlots(scratch.db, rest, { ...options, nowFor: liveTimeOf(await liveRunStarts(live.db)) });
    log(`added ${rest.length} more hours (${added} items); ${first.length + rest.length} in all`);
    const tally = async (table: typeof topics | typeof topicSnapshots | typeof rankings) => (await scratch.db.select({ n: count() }).from(table))[0].n;
    const built = { topics: await tally(topics), snapshots: await tally(topicSnapshots), rankings: await tally(rankings) };
    log(`built ${JSON.stringify(built)}`);
    if (rehearse) {
      log(`rehearsal only, nothing written; ${Math.round((Date.now() - started) / 60_000)} min in all`);
      return;
    }
    const names = await saveNames(live.db);
    const swapStarted = Date.now();
    const counts = await swapDerived(live.db, scratch.db);
    const restored = await restoreNames(live.db, names);
    log(`swapped in ${Math.round((Date.now() - swapStarted) / 1000)} s: ${JSON.stringify(counts)}${names.length > 0 ? `; ${restored} of ${names.length} Claude names carried over` : ""}`);
    log(await revalidateSite(env.revalidate));
  } finally {
    await scratch.close();
    await live.close();
  }
}

async function rebuild(argv: readonly string[]) {
  const value = option(argv, "threshold");
  if (!value) throw new Error("rebuild needs --threshold");
  const threshold = parseThreshold(value);
  if (argv.includes("--in-memory")) return rebuildInMemory(argv, threshold);
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
    const names = await saveNames(db);
    await resetDerived(db);
    const { created } = await replaySlots(db, slots, {
      threshold,
      embedder: memoEmbedder(await createEmbedder()),
      blocklist: loadBlocklist(),
      // New topics get the category model's answer again, from the stored lists.
      categorize: loadCategorizer(console.log),
      onSlot: (i) => {
        if ((i + 1) % 24 === 0) console.log(`rebuild: ${i + 1}/${slots.length} slots`);
      },
    });
    const restored = await restoreNames(db, names);
    console.log(`rebuild: done, ${created} topics${names.length > 0 ? `; ${restored} of ${names.length} Claude names carried over` : ""}`);
  } finally {
    await close();
  }
}

async function main() {
  loadLocalEnv();
  const [command, ...argv] = process.argv.slice(2);
  if (command === "tune") await tune(argv);
  else if (command === "rebuild") await rebuild(argv);
  else throw new Error("usage: npm run replay -- tune [--days 7] [--thresholds …] [--out file] | rebuild --threshold 0.86 [--in-memory --rehearse | --in-memory --swap-at HH:MM] --yes");
}

main().catch((error: unknown) => {
  console.error(`replay: failed: ${describeError(error)}`);
  process.exit(1);
});
