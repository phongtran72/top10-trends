import { unstable_cache } from "next/cache";
import { getDb } from "@/lib/db";
import { sourceStatuses } from "@/lib/queries";
import { TRENDS_TAG } from "@/lib/revalidate";

// Database reads cached in Next's data cache under the `trends` tag, which
// POST /api/revalidate expires after each pipeline run. Pages that are not
// ISR (they render per request after `connection()`, so `next build` never
// queries the database) read through these, so visits rarely reach Postgres.
// unstable_cache is the pre-Cache-Components API; see PLAN.md › Tech stack.

export const getSourceStatuses = unstable_cache(
  async () => sourceStatuses(getDb(), new Date()),
  ["source-statuses-v1"],
  { tags: [TRENDS_TAG], revalidate: 3600 },
);
