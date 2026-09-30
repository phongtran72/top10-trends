CREATE TABLE "tiktok_curves" (
	"title" text NOT NULL,
	"window_end" date NOT NULL,
	"day" date NOT NULL,
	"value" real NOT NULL,
	"direction" text,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tiktok_curves_title_window_end_day_pk" PRIMARY KEY("title","window_end","day")
);
--> statement-breakpoint
ALTER TABLE "tiktok_curves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The research notebooks read it like every other table (migration 0002).
CREATE POLICY research_read ON tiktok_curves FOR SELECT TO research_reader USING (true);
