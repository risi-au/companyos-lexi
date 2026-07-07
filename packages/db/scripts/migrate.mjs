// Migration runner using the drizzle-orm programmatic migrator.
// Replaces `drizzle-kit migrate`: the CLI's statement splitter dies silently
// (exit 1, no output) on 0018's nested dollar-quoted DO block, while the
// programmatic migrator — the same one every test uses via pglite — applies it
// fine. Run from packages/db: `node scripts/migrate.mjs`.
import { config as loadEnv } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "path";
import { fileURLToPath } from "url";

loadEnv({ path: ["../../.env", ".env"], quiet: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

// 0018 sizes the embeddings vector column from this GUC (default 1536 in SQL).
const connection = {};
const dimensions = process.env.EMBEDDING_DIMENSIONS;
if (dimensions && Number.isFinite(Number(dimensions))) {
  connection["companyos.embedding_dimensions"] = String(Math.trunc(Number(dimensions)));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "../drizzle");

const sql = postgres(databaseUrl, {
  max: 1,
  connection,
  onnotice: (notice) => {
    if (notice?.severity && notice.severity !== "NOTICE") console.log(notice.message);
  },
});

try {
  await migrate(drizzle(sql), { migrationsFolder });
  console.log("migrations applied");
} catch (error) {
  console.error("migration failed:", error?.message || error);
  if (error?.cause?.message) console.error("cause:", error.cause.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
