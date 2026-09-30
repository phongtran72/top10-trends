import { readFileSync, writeFileSync } from "node:fs";
import { createEmbedder } from "@/lib/embed";
import { describeError } from "@/lib/errors";
import { setSegmentation } from "@/lib/segment";
import { embedTitles, type TitleRow } from "@/lib/title-vectors";
import { loadBlocklist } from "@/pipeline/filter";

// npx tsx scripts/embed-titles.ts <titles.json> <out> [--no-segment]: for the
// research notebooks. Reads [{ id, source, title }], applies the pipeline's
// filters and writes <out>.json (model, and per title: kept or why dropped,
// and its row) and <out>.f32 (the kept titles' 384-number vectors, float32).
// --no-segment leaves one-word lowercase hashtags unsplit, as replay's does.
// Needs no database; paths are expected under research/data/, which git ignores.

async function main() {
  const args = process.argv.slice(2);
  const [input, out] = args.filter((arg) => !arg.startsWith("--"));
  if (!input || !out) throw new Error("usage: tsx scripts/embed-titles.ts <titles.json> <out> [--no-segment]");
  setSegmentation(!args.includes("--no-segment"));
  const rows = JSON.parse(readFileSync(input, "utf8")) as TitleRow[];
  const result = await embedTitles(rows, loadBlocklist(), await createEmbedder());
  const { vectors, ...meta } = result;
  writeFileSync(`${out}.json`, JSON.stringify(meta));
  writeFileSync(`${out}.f32`, Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength));
  const kept = result.rows.filter((r) => r.kept).length;
  console.log(`embed-titles: ${rows.length} titles, ${kept} kept, ${rows.length - kept} dropped by the filters`);
}

main().catch((error: unknown) => {
  console.error(`embed-titles: failed: ${describeError(error)}`);
  process.exit(1);
});
