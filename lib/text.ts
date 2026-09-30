// Text helpers for topic matching (normalize) and display (prettyLabel).

import { segmentRun } from "./segment";

const URL_PATTERN = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
// Emoji, their joiners and variation selectors, flags and keycaps.
const EMOJI_PATTERN = /[\p{Extended_Pictographic}\p{Regional_Indicator}‍️⃣]/gu;

// Splits a hashtag body into words: camelCase, acronym boundaries and
// letter-digit boundaries. "WorldSeries2026" → "World Series 2026",
// "NBAFinals" → "NBA Finals"; "GRAMMYs", "F1" and "3D" stay whole.
export function splitHashtag(tag: string): string {
  return tag
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z]{2,})/g, "$1 $2")
    .replace(/([A-Za-z]{2,})(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z]{2,})/g, "$1 $2")
    .replace(/_+/g, " ");
}

// Lowercase runs that a hashtag's capitals can't split, split into English
// words: "nationalcoffeeday" → "national coffee day" (lib/segment.ts).
function splitRuns(text: string): string {
  return text.replace(/\b[a-z]+\b/g, (run) => segmentRun(run));
}

function splitHashtags(text: string): string {
  return text.replace(/#([\p{L}\p{N}_]+)/gu, (_, body: string) => splitRuns(splitHashtag(body)));
}

// Hashtags split into words; a title that is one word on its own ("aircrash",
// "WorldSeries") is split the same way.
function splitTitle(text: string): string {
  const cleaned = clean(splitHashtags(text));
  return /^[\p{L}\p{N}_]+$/u.test(cleaned) ? splitRuns(splitHashtag(cleaned)) : cleaned;
}

function clean(text: string): string {
  return text.replace(URL_PATTERN, " ").replace(EMOJI_PATTERN, " ").replace(/\s+/g, " ").trim();
}

// Matching form: hashtags split into words, lowercase, no URLs, emoji or #.
export function normalize(text: string): string {
  return splitTitle(text).toLowerCase();
}

// Display form: hashtags split into words, the source's capitalization kept.
export function prettyLabel(text: string): string {
  return splitTitle(text);
}

// URL slug: "World Series 2026!" → "world-series-2026".
export function slugify(text: string, maxLength = 60): string {
  const slug = normalize(text)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, maxLength).replace(/-+$/, "") || "topic";
}
