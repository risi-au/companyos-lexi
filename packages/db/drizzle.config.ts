import { config as loadEnv } from "dotenv";
loadEnv({ path: ["../../.env", ".env"], quiet: true });
import { defineConfig } from "drizzle-kit";

const databaseUrl =
  process.env.DATABASE_URL || "postgresql://user:pass@localhost:5432/dummy";

export default defineConfig({
  schema: "./src/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});