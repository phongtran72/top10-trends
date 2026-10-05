// Formatting shared by server pages and client components.

const numberFormat = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function metricText(value: number | null | undefined, label: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const number = value >= 100_000 ? compactFormat.format(value) : numberFormat.format(value);
  return label ? `${number} ${label}` : number;
}

export const REGION_NAMES: Record<string, string> = {
  global: "Worldwide",
  us: "United States",
  gb: "United Kingdom",
  ca: "Canada",
  au: "Australia",
};

// Short forms for badges: "Google Trends UK #1".
export const REGION_SHORT: Record<string, string> = {
  global: "Worldwide",
  us: "US",
  gb: "UK",
  ca: "Canada",
  au: "Australia",
};

// "2026-09-30 12:07 UTC": the same on the server and in every browser.
export function utcTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

// "Sunday, October 4, 2026" (or "Oct 4") for a UTC day written "2026-10-04":
// the same on the server and in every browser.
export function dayName(date: string, style: "long" | "short" = "long"): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(
    "en-US",
    style === "long"
      ? { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }
      : { month: "short", day: "numeric", timeZone: "UTC" },
  );
}

export function relativeTime(iso: string, nowMs: number): string {
  const minutes = Math.floor((nowMs - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export function successRate(ok: number, runs: number): string {
  if (runs === 0) return "no runs";
  return `${Math.round((100 * ok) / runs)}%`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
