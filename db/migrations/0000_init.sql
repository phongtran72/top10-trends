CREATE TABLE "fetch_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"region" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "fetch_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rankings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"list" text NOT NULL,
	"region" text NOT NULL,
	"rank" integer NOT NULL,
	"topic_id" bigint,
	"item_id" bigint,
	"score" real
);
--> statement-breakpoint
ALTER TABLE "rankings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"weight" real NOT NULL,
	"enabled" boolean NOT NULL,
	"regions" text[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "topic_items" (
	"topic_id" bigint NOT NULL,
	"item_id" bigint NOT NULL,
	CONSTRAINT "topic_items_topic_id_item_id_pk" PRIMARY KEY("topic_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "topic_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "topics" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"summary" text,
	"centroid" real[384] NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	CONSTRAINT "topics_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "topics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trend_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" bigint NOT NULL,
	"source_id" text NOT NULL,
	"region" text NOT NULL,
	"rank" integer NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"metric_value" bigint,
	"metric_label" text,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trend_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fetch_runs" ADD CONSTRAINT "fetch_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rankings" ADD CONSTRAINT "rankings_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rankings" ADD CONSTRAINT "rankings_item_id_trend_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."trend_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_items" ADD CONSTRAINT "topic_items_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_items" ADD CONSTRAINT "topic_items_item_id_trend_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."trend_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_items" ADD CONSTRAINT "trend_items_run_id_fetch_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."fetch_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rankings_list_region_computed_idx" ON "rankings" USING btree ("list","region","computed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trend_items_source_region_fetched_idx" ON "trend_items" USING btree ("source_id","region","fetched_at" DESC NULLS LAST);