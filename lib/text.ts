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

export interface SplitOptions {
  // Runs written as one word in the news this run ("flydubai" in "Flydubai
  // flight diverts…"): a brand or name, so a hashtag keeps it whole too.
  keep?: ReadonlySet<string>;
}

// Lowercase runs that a hashtag's capitals can't split, split into English
// words: "nationalcoffeeday" → "national coffee day" (lib/segment.ts).
function splitRuns(text: string, options: SplitOptions): string {
  return text.replace(/\b[a-z]+\b/g, (run) => (options.keep?.has(run) ? run : segmentRun(run)));
}

function splitHashtags(text: string, options: SplitOptions): string {
  return text.replace(/#([\p{L}\p{N}_]+)/gu, (_, body: string) => splitRuns(splitHashtag(body), options));
}

// Hashtags split into words; a title that is one lowercase word on its own
// ("aircrash") is split into words too. A capitalized single word ("LeBron",
// "PlayStation") is a name and stays whole.
function splitTitle(text: string, options: SplitOptions): string {
  const cleaned = clean(splitHashtags(text, options));
  return /^[a-z]+$/.test(cleaned) ? splitRuns(cleaned, options) : cleaned;
}

function clean(text: string): string {
  return text.replace(URL_PATTERN, " ").replace(EMOJI_PATTERN, " ").replace(/\s+/g, " ").trim();
}

// Matching form: hashtags split into words, lowercase, no URLs, emoji or #.
export function normalize(text: string, options: SplitOptions = {}): string {
  return splitTitle(text, options).toLowerCase();
}

// Display form: hashtags split into words, the source's capitalization kept.
// A name as one run of lowercase letters and digits, so the same name matches
// however a source writes it: "#BahrainGP", "Bahrain GP" and "bahrain gp"
// are all "bahraingp".
export function nameKey(text: string): string {
  return normalize(text).replace(/[^\p{L}\p{N}]/gu, "");
}

export function prettyLabel(text: string): string {
  return splitTitle(text, {});
}

// Words of six or more letters written in running text (titles and headlines
// of two or more words, hashtags left out), lowercase: the `keep` set for a
// run's hashtags. "Flydubai flight diverts to Saudi Arabia" gives "flydubai".
export function plainWords(texts: readonly string[]): Set<string> {
  const words = new Set<string>();
  for (const text of texts) {
    const plain = clean(text.replace(/#[\p{L}\p{N}_]+/gu, " "));
    if (!plain.includes(" ")) continue;
    for (const word of plain.toLowerCase().match(/\b[a-z]{6,}\b/g) ?? []) words.add(word);
  }
  return words;
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
