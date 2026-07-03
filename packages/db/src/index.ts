import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Dev hot-reload creates fresh module instances per compile; cache the pool on
// globalThis so restarts/reloads reuse one connection pool instead of leaking
// pools until Postgres hits max_connections.
const globalForDb = globalThis as unknown as {
  __companyosDb?: { url: string; db: ReturnType<typeof drizzle<typeof schema>> };
};

export function createDb(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  if (globalForDb.__companyosDb?.url === connectionString) {
    return globalForDb.__companyosDb.db;
  }

  const client = postgres(connectionString, { max: 10 });
  const db = drizzle(client, { schema });
  globalForDb.__companyosDb = { url: connectionString, db };
  return db;
}

// Re-export all schema tables and types for consumers (e.g. packages/api)
export * from "./schema";
export { schema };