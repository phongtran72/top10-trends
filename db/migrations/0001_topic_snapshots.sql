CREATE TABLE "topic_snapshots" (
	"taken_at" timestamp with time zone NOT NULL,
	"region" text NOT NULL,
	"topic_id" bigint NOT NULL,
	"position" integer,
	"score" real,
	"platform_count" integer NOT NULL,
	"news_count" integer DEFAULT 0 NOT NULL,
	"algo_version" text NOT NULL,
	"ranks" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	CONSTRAINT "topic_snapshots_topic_id_taken_at_region_pk" PRIMARY KEY("topic_id","taken_at","region")
);
--> statement-breakpoint
ALTER TABLE "topic_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "topic_snapshots" ADD CONSTRAINT "topic_snapshots_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "topic_snapshots_taken_idx" ON "topic_snapshots" USING btree ("taken_at");