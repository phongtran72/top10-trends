import { describe, expect, it } from "vitest";
import { siteUrl } from "./site-url";

describe("siteUrl", () => {
  it("prefers SITE_URL, then Vercel's production domain, then the dev server", () => {
    expect(siteUrl({ SITE_URL: "https://example.com/", VERCEL_PROJECT_PRODUCTION_URL: "top10.vercel.app" })).toBe("https://example.com");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "top10.vercel.app" })).toBe("https://top10.vercel.app");
    expect(siteUrl({ SITE_URL: "  " })).toBe("http://localhost:3000");
  });
});
