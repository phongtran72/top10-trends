import { createHash, timingSafeEqual } from "node:crypto";

// Shared by POST /api/revalidate and the pipeline's call to it.
export const REVALIDATE_HEADER = "x-revalidate-secret";

// Cache tag on every database read the site caches (see lib/cached.ts).
export const TRENDS_TAG = "trends";

// Constant-time comparison; hashing first makes the lengths equal.
export function secretMatches(given: string | null, expected: string): boolean {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
