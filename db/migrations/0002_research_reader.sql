-- Read-only role for the phase 5 research notebooks (PLAN.md › Predictions and research).
-- The role is created without a login; the owner turns login on with a password in
-- Supabase's SQL editor (SETUP.md §14), so no secret lives in this public repository.
-- Row-level security is on for every table with no other policies, so the role reads
-- through its own SELECT policies and can never write. A new table needs its own
-- research_read policy (the default privileges below cover only the grant).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'research_reader') THEN
    CREATE ROLE research_reader NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint
ALTER ROLE research_reader SET default_transaction_read_only = on;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO research_reader;--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA public TO research_reader;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO research_reader;--> statement-breakpoint
CREATE POLICY research_read ON sources FOR SELECT TO research_reader USING (true);--> statement-breakpoint
CREATE POLICY research_read ON fetch_runs FOR SELECT TO research_reader USING (true);--> statement-breakpoint
CREATE POLICY research_read ON trend_items FOR SELECT TO research_reader USING (true);--> statement-breakpoint
CREATE POLICY research_read ON topics FOR SELECT TO research_reader USING (true);--> statement-breakpoint
CREATE POLICY research_read ON topic_items FOR SELECT TO research_reader USING (true);--> statement-breakpoint
CREATE POLICY research_read ON rankings FOR SELECT TO research_reader USING (true);--> statement-breakpoint
CREATE POLICY research_read ON topic_snapshots FOR SELECT TO research_reader USING (true);
