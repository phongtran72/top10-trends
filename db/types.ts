import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

// Any Drizzle Postgres database with our schema: postgres-js on the site and
// in the pipeline, PGlite in tests.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
