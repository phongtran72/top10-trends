ALTER TABLE "topics" ADD COLUMN "model_category" text;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "model_category_version" text;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "continues_topic_id" bigint;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_continues_topic_id_topics_id_fk" FOREIGN KEY ("continues_topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;