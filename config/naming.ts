// Claude topic names (task 3.6, PLAN.md › Ranking › Topic names). On only when
// ANTHROPIC_API_KEY is set.

// Claude Haiku 4.5: $1 and $5 per million input and output tokens.
export const NAMING_MODEL = "claude-haiku-4-5";

// A topic is named the first time it is in a combined top 10, so at most a
// few an hour; this caps a run (and so the spend) if something goes wrong.
export const NAMES_PER_RUN = 12;
// All naming calls of a run share this budget; calls not started by then wait
// for the next run.
export const NAMING_BUDGET_MS = 30_000;
export const NAMING_TIMEOUT_MS = 10_000;

// The research categories (research/topnews/llm.py CATEGORIES; a test keeps
// the two lists the same). Claude picks one for each topic it names, which
// gives research a category for every top-10 topic without a second call.
export const TOPIC_CATEGORIES = [
  "sports",
  "politics",
  "entertainment",
  "tech",
  "gaming",
  "business",
  "science",
  "health",
  "weather",
  "incident",
  "lifestyle",
  "calendar",
  "meme",
  "other",
] as const;
export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];

export const NAME_MAX_LENGTH = 60;
export const REASON_MAX_LENGTH = 120;

// What Claude is shown for one topic.
export const NAMING_MAX_TITLES = 8;
export const NAMING_MAX_TEXTS = 6;
export const NAMING_TEXT_LENGTH = 300;
