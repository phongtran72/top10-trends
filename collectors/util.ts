import type { Region } from "./types";

// Small helpers shared by collectors.

export function requireRegion(source: string, region: Region, supported: readonly Region[]): void {
  if (!supported.includes(region)) throw new Error(`${source} has no ${region} feed`);
}

export function requireKey(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// "/profile/x" → "https://bsky.app/profile/x"; absolute URLs pass through.
export function absoluteUrl(base: string, link: string): string {
  return new URL(link, base).toString();
}

// Parses counts such as "20,000+", "1.5M+", "357" or 42; undefined when unparsable.
export function parseCount(value: string | number | undefined | null): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : undefined;
  const match = /^\s*([\d.,]+)\s*([KMB])?\+?\s*$/i.exec(value);
  if (!match) return undefined;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return undefined;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[(match[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(base * scale);
}

export const FEED_COUNTRY: Partial<Record<Region, string>> = { us: "US", gb: "GB", ca: "CA", au: "AU" };
