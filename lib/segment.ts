import { readFileSync } from "node:fs";
import path from "node:path";

// Splits a hashtag written as one lowercase run into English words:
// "nationalcoffeeday" → "national coffee day". camelCase tags are split by
// lib/text.ts already; these are the rest (about half of TikTok's hashtags).
// Word frequencies come from config/words-en.txt (FrequencyWords, OpenSubtitles
// 2018, CC BY-SA 4.0; see config/words-en.NOTICE.md). The split is the most
// likely sequence of listed words, with a cost per word so that a listed
// whole word or a name isn't chopped into short common words; a run that
// can't be split into listed words is kept whole.

export const MIN_RUN_LENGTH = 6;
const MAX_WORD_LENGTH = 24;
// Pieces of one or two letters are allowed only if they are common words.
const SHORT_WORDS = new Set(
  "a i am an as at be by do go he if in is it me my no of on or so to up us we".split(" "),
);
// Every extra word costs this much (in nats), on top of its own rarity, and a
// word of three letters or fewer a little more: hashtags are mostly content
// words, so "firstdayoffall" reads "first day of fall", not "first day off all".
const WORD_PENALTY = 4;
const SHORT_WORD_PENALTY = 2.5;
// Rarer three-letter entries are mostly names, abbreviations and typos ("ofa").
const MIN_SHORT_COUNT = 2000;

export interface Dictionary {
  cost: ReadonlyMap<string, number>; // −ln p(word)
  total: number; // sum of the counts
}

export function parseWords(text: string): Dictionary {
  const counts = new Map<string, number>();
  let total = 0;
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-z]+) (\d+)$/.exec(line.trim());
    if (!match) continue;
    const count = Number(match[2]);
    total += count;
    if (match[1].length <= 3 && count < MIN_SHORT_COUNT) continue;
    counts.set(match[1], count);
  }
  const cost = new Map<string, number>();
  for (const [word, count] of counts) cost.set(word, Math.log(total / count));
  return { cost, total };
}

let loaded: Dictionary | null = null;
let enabled = true;

// Turns splitting off, for `npm run replay -- tune --no-segment`, which
// compares matching with and without it.
export function setSegmentation(on: boolean): void {
  enabled = on;
}

export function loadWords(file = path.join(process.cwd(), "config", "words-en.txt")): Dictionary {
  loaded ??= parseWords(readFileSync(file, "utf8"));
  return loaded;
}

// The run split into words, or the run itself when no split beats keeping it whole.
export function segmentRun(run: string, dictionary: Dictionary = loadWords()): string {
  if (!enabled || run.length < MIN_RUN_LENGTH || !/^[a-z]+$/.test(run)) return run;
  const pieceCost = (word: string, start: number) => {
    if (word.length <= 2 && !SHORT_WORDS.has(word)) return Infinity;
    if (word === "i" && start > 0) return Infinity; // "fediverse" isn't "fed i verse"
    const cost = dictionary.cost.get(word);
    if (cost === undefined) return Infinity;
    return cost + WORD_PENALTY + (word.length <= 3 ? SHORT_WORD_PENALTY : 0);
  };
  // best[i]: the cheapest split of run[0, i); from[i]: where its last word starts.
  const best = new Array<number>(run.length + 1).fill(Infinity);
  const from = new Array<number>(run.length + 1).fill(0);
  best[0] = 0;
  for (let end = 1; end <= run.length; end++) {
    for (let start = Math.max(0, end - MAX_WORD_LENGTH); start < end; start++) {
      if (best[start] === Infinity) continue;
      const cost = best[start] + pieceCost(run.slice(start, end), start);
      if (cost < best[end]) {
        best[end] = cost;
        from[end] = start;
      }
    }
  }
  // An unlisted run is as likely as a listed word seen 10 times, 10 times less
  // likely for each extra letter (Norvig's estimate), so longer runs split.
  const unknown = Math.log(dictionary.total / 10) + (run.length - 1) * Math.log(10);
  const whole = (dictionary.cost.get(run) ?? unknown) + WORD_PENALTY;
  if (best[run.length] >= whole) return run;
  const words: string[] = [];
  for (let end = run.length; end > 0; end = from[end]) words.unshift(run.slice(from[end], end));
  return words.join(" ");
}
