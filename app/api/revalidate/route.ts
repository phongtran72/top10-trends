import { revalidatePath, revalidateTag } from "next/cache";
import { revalidateEnv } from "@/lib/env";
import { REVALIDATE_HEADER, secretMatches, TRENDS_TAG } from "@/lib/revalidate";

// Called by the pipeline after each run with the x-revalidate-secret header.
// Expires the cached database reads and the cached pages, so the next visit
// renders fresh rows. Page views never call a platform API.
export async function POST(request: Request) {
  let expected: string;
  try {
    expected = revalidateEnv().REVALIDATE_SECRET;
  } catch {
    return Response.json({ ok: false, error: "revalidation is not configured" }, { status: 503 });
  }
  if (!secretMatches(request.headers.get(REVALIDATE_HEADER), expected)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  revalidateTag(TRENDS_TAG, { expire: 0 });
  revalidatePath("/");
  revalidatePath("/p/[platform]", "page");
  revalidatePath("/t/[slug]", "page");
  revalidatePath("/status");
  return Response.json({ ok: true, revalidatedAt: new Date().toISOString() });
}
