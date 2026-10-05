import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// The tables from PLAN.md › Data model. Store only these columns: never
// full API responses or item embeddings (CLAUDE.md invariant 4).
//
// Row-level security is on with no policies, so Supabase's public Data API
// (anon and authenticated roles) can read nothing; the owner role used by our
// connection strings bypasses it.

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// Permanent; upserted from collectors/registry.ts at the start of each run.
export const sources = pgTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(), // lead | corroborating | system
  weight: real("weight").notNull(),
  enabled: boolean("enabled").notNull(),
  regions: text("regions").array().notNull(),
}).enableRLS();

// 90 days. One row per collector and region per run, plus the heartbeat.
export const fetchRuns = pgTable("fetch_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .references(() => sources.id),
  region: text("region").notNull(),
  startedAt: timestamptz("started_at").notNull(),
  finishedAt: timestamptz("finished_at"),
  status: text("status").notNull(), // ok | error | skipped
  itemCount: integer("item_count").notNull().default(0),
  error: text("error"), // status code, host and a short reason only; never a URL with a key
}).enableRLS();

// 28 days (YouTube's policy caps stored API data at 30 days).
export const trendItems = pgTable(
  "trend_items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: bigint("run_id", { mode: "number" })
      .notNull()
      .references(() => fetchRuns.id),
    sourceId: text("source_id").notNull(),
    region: text("region").notNull(),
    rank: integer("rank").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    metricValue: bigint("metric_value", { mode: "number" }),
    metricLabel: text("metric_label"),
    status: text("status"), // Bluesky's lifecycle label (trending, saturating, cooling, stale); null for other sources
    // The extra text matching reads: Google Trends' news headlines, Bluesky's trend description; null for other sources.
    matchText: text("match_text").array(),
    fetchedAt: timestamptz("fetched_at").notNull(),
  },
  (t) => [index("trend_items_source_region_fetched_idx").on(t.sourceId, t.region, t.fetchedAt.desc())],
).enableRLS();

// Permanent.
export const topics = pgTable("topics", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(), // the platform's own wording; matching by name uses it
  summary: text("summary"), // the first Google Trends headline attached to it
  // A display name and a one-line reason written by Claude the first time the
  // topic is in a combined top 10 (task 3.6); null until then, never rewritten.
  name: text("name"),
  reason: text("reason"),
  centroid: real("centroid").array(384).notNull(),
  firstSeen: timestamptz("first_seen").notNull(),
  lastSeen: timestamptz("last_seen").notNull(),
}).enableRLS();

// 28 days, deleted with their items.
export const topicItems = pgTable(
  "topic_items",
  {
    topicId: bigint("topic_id", { mode: "number" })
      .notNull()
      .references(() => topics.id),
    itemId: bigint("item_id", { mode: "number" })
      .notNull()
      .references(() => trendItems.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.topicId, t.itemId] })],
).enableRLS();

// Combined rankings are permanent; per-platform rankings cascade with their items.
export const rankings = pgTable(
  "rankings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    computedAt: timestamptz("computed_at").notNull(),
    list: text("list").notNull(), // 'combined' or a source id
    region: text("region").notNull(), // the view: global | us
    rank: integer("rank").notNull(),
    topicId: bigint("topic_id", { mode: "number" }).references(() => topics.id),
    itemId: bigint("item_id", { mode: "number" }).references(() => trendItems.id, { onDelete: "cascade" }),
    score: real("score"),
  },
  (t) => [index("rankings_list_region_computed_idx").on(t.list, t.region, t.computedAt.desc())],
).enableRLS();

// Permanent. One row per topic per run: where the topic stood on each platform
// that hour, as history for a future prediction model (for example, will this
// topic break out to more platforms?). Items are deleted after 28 days, so this
// is the only lasting record of a topic's hour-by-hour path. YouTube is left
// out: its policy caps stored API data at 30 days and forbids deriving new
// metrics from it (PLAN.md › Data model).
export const topicSnapshots = pgTable(
  "topic_snapshots",
  {
    takenAt: timestamptz("taken_at").notNull(), // the run's start, like rankings.computed_at
    region: text("region").notNull(), // the view: global | us
    topicId: bigint("topic_id", { mode: "number" })
      .notNull()
      .references(() => topics.id),
    position: integer("position"), // place among all scored topics that hour; null without a lead platform
    score: real("score"), // combined score without YouTube; null without a lead platform
    platformCount: integer("platform_count").notNull(),
    newsCount: integer("news_count").notNull().default(0), // distinct Google Trends headlines attached this run
    algoVersion: text("algo_version").notNull(), // how the row was made: model, threshold, ranking version, +replay
    ranks: jsonb("ranks").$type<Record<string, number>>().notNull(), // source id → best rank
    metrics: jsonb("metrics").$type<Record<string, number>>().notNull(), // source id → metric of that item
  },
  (t) => [primaryKey({ columns: [t.topicId, t.takenAt, t.region] }), index("topic_snapshots_taken_idx").on(t.takenAt)],
).enableRLS();

// Permanent, for research. TikTok's daily popularity curve (0–100) for each
// listed hashtag, one row per day of each curve. A curve is named by its
// hashtag and its last day: each daily Apify run brings a new 7-day curve, and
// a day's value can differ between curves, so every curve is kept whole. The
// hourly runs in between read the same curves again and add nothing.
export const tiktokCurves = pgTable(
  "tiktok_curves",
  {
    title: text("title").notNull(), // the hashtag as listed, '#name'
    windowEnd: date("window_end", { mode: "string" }).notNull(), // the curve's last day (UTC)
    day: date("day", { mode: "string" }).notNull(), // UTC
    value: real("value").notNull(), // 0–100
    direction: text("direction"), // up | down | stable, as TikTok labels the hashtag; null when it doesn't
    fetchedAt: timestamptz("fetched_at").notNull(), // the first run that saw this curve
  },
  (t) => [primaryKey({ columns: [t.title, t.windowEnd, t.day] })],
).enableRLS();
