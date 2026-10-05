import { describe, expect, it } from "vitest";
import type { SourceStatus } from "@/lib/queries";
import { failingSources } from "./alerts";

const now = new Date("2026-10-20T12:10:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

function status(id: string, fields: Partial<SourceStatus>): SourceStatus {
  return {
    id: id as SourceStatus["id"],
    name: id,
    role: "lead",
    phase: 1,
    lastRunAt: hoursAgo(0),
    lastStatus: "ok",
    lastSuccessAt: hoursAgo(0),
    lastError: null,
    runs24h: 24,
    ok24h: 24,
    ...fields,
  };
}

describe("failingSources", () => {
  it("alerts for a source whose newest run failed and that hasn't succeeded for six hours", () => {
    const alerts = failingSources(
      [
        status("bluesky", {}),
        status("reddit", { lastStatus: "error", lastSuccessAt: hoursAgo(7), ok24h: 17 }),
        status("mastodon", { lastStatus: "error", lastSuccessAt: hoursAgo(2), ok24h: 22 }), // a short outage
        status("twitch", { lastStatus: "ok", lastSuccessAt: hoursAgo(0), ok24h: 12 }), // failed earlier, back now
      ],
      now,
    );
    expect(alerts).toEqual([{ id: "reddit", name: "reddit", system: false, lastSuccessAt: hoursAgo(7) }]);
  });

  it("never alerts for a source that is skipped or has never run", () => {
    expect(
      failingSources(
        [
          status("x", { lastStatus: "skipped", lastSuccessAt: hoursAgo(30), ok24h: 0 }),
          status("tiktok", { lastRunAt: null, lastStatus: null, lastSuccessAt: null, runs24h: 0, ok24h: 0 }),
        ],
        now,
      ),
    ).toEqual([]);
  });

  it("alerts for a source that has never succeeded once its failures span six hours", () => {
    const never = { lastStatus: "error", lastSuccessAt: null, ok24h: 0 };
    expect(failingSources([status("instagram", { ...never, runs24h: 3 })], now)).toEqual([]);
    expect(failingSources([status("instagram", { ...never, runs24h: 6 })], now)).toEqual([
      { id: "instagram", name: "instagram", system: false, lastSuccessAt: null },
    ]);
  });

  it("puts a stopped pipeline first: no heartbeat for six hours, whatever its last status", () => {
    const alerts = failingSources(
      [
        status("reddit", { lastStatus: "error", lastSuccessAt: hoursAgo(9) }),
        status("heartbeat", { role: "system", lastRunAt: hoursAgo(8), lastStatus: "ok", lastSuccessAt: hoursAgo(8) }),
        status("bluesky", { lastRunAt: hoursAgo(8), lastStatus: "ok", lastSuccessAt: hoursAgo(8) }), // stale only because nothing ran
      ],
      now,
    );
    expect(alerts.map((alert) => [alert.id, alert.name, alert.system])).toEqual([
      ["heartbeat", "The hourly update", true],
      ["reddit", "reddit", false],
    ]);
  });
});
