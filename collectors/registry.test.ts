import { describe, expect, it } from "vitest";
import { PLATFORMS, SOURCES, planSources, unknownSourceIds, type SourceId } from "./registry";

const plan = (options: Partial<Parameters<typeof planSources>[0]> & { ids: SourceId[] }) =>
  Object.fromEntries(
    planSources({ collectors: new Set(options.ids), disabled: options.disabled ?? [], env: options.env ?? {} }).map(
      (p) => [p.source.id, p],
    ),
  );

describe("registry", () => {
  it("lists the eleven platforms plus the heartbeat", () => {
    expect(SOURCES.map((s) => s.id).sort()).toEqual(
      ["bluesky", "google_trends", "hacker_news", "heartbeat", "instagram", "mastodon", "pinterest", "reddit", "tiktok", "twitch", "x", "youtube"],
    );
    expect(PLATFORMS).toHaveLength(11);
  });

  it("matches PLAN.md's roles and starting weights", () => {
    const summary = Object.fromEntries(PLATFORMS.map((s) => [s.id, [s.role, s.weight]]));
    expect(summary).toEqual({
      x: ["lead", 1.0],
      google_trends: ["lead", 1.0],
      reddit: ["lead", 0.8],
      bluesky: ["lead", 0.5],
      mastodon: ["lead", 0.3],
      youtube: ["corroborating", 0.8],
      tiktok: ["corroborating", 0.5],
      instagram: ["corroborating", 0.5],
      twitch: ["corroborating", 0.3],
      hacker_news: ["corroborating", 0.3],
      pinterest: ["corroborating", 0.3],
    });
  });
});

describe("planSources", () => {
  it("always runs the heartbeat and marks unbuilt collectors absent", () => {
    const p = plan({ ids: [] });
    expect(p.heartbeat.action).toBe("run");
    expect(p.bluesky).toMatchObject({ action: "absent" });
  });

  it("runs a keyless source whose collector exists", () => {
    expect(plan({ ids: ["bluesky"] }).bluesky.action).toBe("run");
  });

  it("skips a disabled source", () => {
    expect(plan({ ids: ["bluesky"], disabled: ["bluesky"] }).bluesky).toMatchObject({
      action: "skip",
      reason: "disabled by DISABLED_SOURCES",
    });
  });

  it("skips a source with missing or blank keys and names them", () => {
    expect(plan({ ids: ["twitch"], env: { TWITCH_CLIENT_ID: "id", TWITCH_CLIENT_SECRET: "" } }).twitch).toMatchObject({
      action: "skip",
      reason: "missing TWITCH_CLIENT_SECRET",
    });
    expect(plan({ ids: ["twitch"], env: { TWITCH_CLIENT_ID: "id", TWITCH_CLIENT_SECRET: "s" } }).twitch.action).toBe("run");
  });

  it("needs TIKTOK_ENABLED=true for TikTok", () => {
    expect(plan({ ids: ["tiktok"], env: { APIFY_TOKEN: "t" } }).tiktok).toMatchObject({ action: "skip" });
    expect(plan({ ids: ["tiktok"], env: { APIFY_TOKEN: "t", TIKTOK_ENABLED: "true" } }).tiktok.action).toBe("run");
  });

  it("reads Pinterest through Apify, turned on by PINTEREST_ENABLED", () => {
    expect(plan({ ids: ["pinterest"], env: { APIFY_TOKEN: "t" } }).pinterest).toMatchObject({ reason: "PINTEREST_ENABLED is not true" });
    expect(plan({ ids: ["pinterest"], env: { APIFY_TOKEN: "t", PINTEREST_ENABLED: "true" } }).pinterest.action).toBe("run");
  });

  it("turns Instagram on separately from TikTok, with the same Apify token", () => {
    const env = { APIFY_TOKEN: "t", TIKTOK_ENABLED: "true" };
    expect(plan({ ids: ["instagram"], env }).instagram).toMatchObject({ action: "skip", reason: "INSTAGRAM_ENABLED is not true" });
    expect(plan({ ids: ["instagram"], env: { ...env, INSTAGRAM_ENABLED: "TRUE" } }).instagram.action).toBe("run");
    expect(plan({ ids: ["instagram"], env: { INSTAGRAM_ENABLED: "true" } }).instagram).toMatchObject({ reason: "missing APIFY_TOKEN" });
  });
});

describe("unknownSourceIds", () => {
  it("flags typos in DISABLED_SOURCES", () => {
    expect(unknownSourceIds(["twitch", "tiktock"])).toEqual(["tiktock"]);
  });
});
