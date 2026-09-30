import { afterEach, describe, expect, it, vi } from "vitest";
import { revalidateSite } from "@/pipeline/revalidate";
import { REVALIDATE_HEADER, secretMatches } from "./revalidate";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const secret = "s".repeat(64);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("secretMatches", () => {
  it("matches only the exact secret", () => {
    expect(secretMatches(secret, secret)).toBe(true);
    expect(secretMatches(`${secret}x`, secret)).toBe(false);
    expect(secretMatches(null, secret)).toBe(false);
    expect(secretMatches("", "")).toBe(false);
  });
});

describe("POST /api/revalidate", () => {
  const call = async (header?: string) => {
    const { POST } = await import("@/app/api/revalidate/route");
    return POST(
      new Request("https://site.test/api/revalidate", {
        method: "POST",
        headers: header === undefined ? {} : { [REVALIDATE_HEADER]: header },
      }),
    );
  };

  it("revalidates the cached data and pages with the right secret", async () => {
    vi.stubEnv("REVALIDATE_SECRET", secret);
    const { revalidatePath, revalidateTag } = await import("next/cache");
    const response = await call(secret);
    expect(response.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith("trends", { expire: 0 });
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/"], ["/p/[platform]", "page"], ["/status"]]);
  });

  it("rejects a wrong or missing secret without revalidating", async () => {
    vi.stubEnv("REVALIDATE_SECRET", secret);
    const { revalidatePath } = await import("next/cache");
    expect((await call("wrong")).status).toBe(401);
    expect((await call()).status).toBe(401);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers 503 when the site has no secret configured", async () => {
    vi.stubEnv("REVALIDATE_SECRET", "");
    expect((await call(secret)).status).toBe(503);
  });
});

describe("revalidateSite", () => {
  const target = { siteUrl: "https://site.test", secret };

  it("posts to /api/revalidate with the secret header", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ok: true })) as unknown as typeof fetch;
    await expect(revalidateSite(target, fetchImpl)).resolves.toBe("revalidate: ok (site.test)");
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://site.test/api/revalidate");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)[REVALIDATE_HEADER]).toBe(secret);
  });

  it("reports failures without throwing", async () => {
    const unauthorized = (async () => new Response("no", { status: 401 })) as typeof fetch;
    await expect(revalidateSite(target, unauthorized)).resolves.toBe("revalidate: failed: 401 site.test");
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(revalidateSite(target, down)).resolves.toBe("revalidate: failed: site.test: network error");
  });

  it("skips without a target", async () => {
    await expect(revalidateSite(null)).resolves.toBe("revalidate: skipped (SITE_URL or REVALIDATE_SECRET not set)");
  });
});
