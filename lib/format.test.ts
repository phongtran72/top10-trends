import { describe, expect, it } from "vitest";
import { hostOf, metricText, relativeTime, successRate, utcTime } from "./format";

describe("format", () => {
  it("formats metrics", () => {
    expect(metricText(4200, "posts")).toBe("4,200 posts");
    expect(metricText(1_234_567, "views")).toBe("1.2M views");
    expect(metricText(null, "posts")).toBeNull();
    expect(metricText(5, null)).toBe("5");
  });

  it("formats times", () => {
    const iso = "2026-09-30T12:07:31.000Z";
    expect(utcTime(iso)).toBe("2026-09-30 12:07 UTC");
    const at = new Date(iso).getTime();
    expect(relativeTime(iso, at + 20_000)).toBe("just now");
    expect(relativeTime(iso, at + 5 * 60_000)).toBe("5 min ago");
    expect(relativeTime(iso, at + 3 * 3_600_000)).toBe("3 h ago");
    expect(relativeTime(iso, at + 72 * 3_600_000)).toBe("3 days ago");
  });

  it("formats success rates and hosts", () => {
    expect(successRate(23, 24)).toBe("96%");
    expect(successRate(0, 0)).toBe("no runs");
    expect(hostOf("https://www.example.com/a")).toBe("example.com");
    expect(hostOf("not a url")).toBe("");
  });
});
