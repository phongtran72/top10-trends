// Text helpers for topic matching (normalize) and display (prettyLabel).

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

function splitHashtags(text: string): string {
  return text.replace(/#([\p{L}\p{N}_]+)/gu, (_, body: string) => splitHashtag(body));
}

function clean(text: string): string {
  return text.replace(URL_PATTERN, " ").replace(EMOJI_PATTERN, " ").replace(/\s+/g, " ").trim();
}

// Matching form: hashtags split into words, lowercase, no URLs, emoji or #.
export function normalize(text: string): string {
  return clean(splitHashtags(text)).toLowerCase();
}

// Display form: hashtags split into words, the source's capitalization kept.
export function prettyLabel(text: string): string {
  return clean(splitHashtags(text));
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
