import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
export function createDatabase(url: string) {
  const client = postgres(url, { max: 1, prepare: false, fetch_types: false, connect_timeout: 10 });
  return { database: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}
