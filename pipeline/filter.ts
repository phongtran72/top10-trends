import { readFileSync } from "node:fs";
import path from "node:path";
import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from "obscenity";
import { detectAll } from "tinyld";
import type { TrendItem } from "@/collectors/types";
import { nameKey, normalize } from "@/lib/text";

// Filters (CLAUDE.md invariant 10): keep English items and drop NSFW posts,
// Bluesky trends that are stale, profanity and evergreen tags.
// Filters run on the in-memory lists, because the flags and match text they
// read are never stored.

export type DropReason = "empty" | "nsfw" | "status" | "blocklist" | "profanity" | "non-latin" | "language";

export interface Dropped {
  item: TrendItem;
  reason: DropReason;
  detail?: string;
}

export interface FilterResult {
  kept: TrendItem[];
  dropped: Dropped[];
}

// Bluesky's list is mostly topics past their peak: over 14 hours on 2026-10-01
// its 25 trends were 4% trending, 1% saturating, 41% cooling and 55% stale.
// Dropping cooling too left a median of 1 Bluesky trend an hour, so only
// stale ones are dropped (ranking version r2).
const DROPPED_STATUSES = new Set(["stale"]);
// Short text makes language detection unreliable, so only a confident
// non-English guess drops an item; unsure items pass (TASKS.md 2.2).
export const LANGUAGE_CONFIDENCE = 0.5;
const MIN_LATIN_SHARE = 0.8;

const profanity = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

export function hasProfanity(text: string): boolean {
  return profanity.hasMatch(text);
}

// "#Monday Motivation!" → "mondaymotivation": how blocklist entries compare.
export function compactText(text: string): string {
  return nameKey(text);
}

export function parseBlocklist(text: string): Set<string> {
  const terms = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const term = line.trim();
    if (!term || term.startsWith("#")) continue;
    terms.add(compactText(term));
  }
  return terms;
}

export function loadBlocklist(file = path.join(process.cwd(), "config", "blocklist.txt")): Set<string> {
  return parseBlocklist(readFileSync(file, "utf8"));
}

// Share of letters in Latin script; text with no letters (numbers) counts as Latin.
export function latinShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 1;
  const latin = text.match(/\p{Script=Latin}/gu) ?? [];
  return latin.length / letters.length;
}

// A confident non-English language for the item, if any. Headlines, when a
// source provides them, give the detector more English to work with.
export function confidentLanguage(item: TrendItem): string | null {
  const text = [item.title, ...(item.matchText ?? []).slice(0, 2)].map((text) => normalize(text)).filter(Boolean).join(". ");
  const [top] = detectAll(text);
  if (!top || top.lang === "en" || top.accuracy < LANGUAGE_CONFIDENCE) return null;
  return top.lang;
}

export function checkItem(item: TrendItem, blocklist: ReadonlySet<string>): Omit<Dropped, "item"> | null {
  if (!normalize(item.title)) return { reason: "empty" };
  if (item.flags?.nsfw) return { reason: "nsfw" };
  const status = item.flags?.status?.toLowerCase();
  if (status && DROPPED_STATUSES.has(status)) return { reason: "status", detail: status };
  if (blocklist.has(compactText(item.title))) return { reason: "blocklist" };
  if (profanity.hasMatch(item.title)) return { reason: "profanity" };
  if (latinShare(item.title) < MIN_LATIN_SHARE) return { reason: "non-latin" };
  const language = confidentLanguage(item);
  if (language) return { reason: "language", detail: language };
  return null;
}

export function filterItems(items: readonly TrendItem[], blocklist: ReadonlySet<string>): FilterResult {
  const kept: TrendItem[] = [];
  const dropped: Dropped[] = [];
  for (const item of items) {
    const drop = checkItem(item, blocklist);
    if (drop) dropped.push({ item, ...drop });
    else kept.push(item);
  }
  return { kept, dropped };
}
