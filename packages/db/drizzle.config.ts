import { config as loadEnv } from "dotenv";
loadEnv({ path: ["../../.env", ".env"], quiet: true });
import { defineConfig } from "drizzle-kit";

function databaseUrlWithEmbeddingOptions(url: string): string {
  const dimensions = process.env.EMBEDDING_DIMENSIONS;
  if (!dimensions) return url;
  try {
    const parsed = new URL(url);
    const existingOptions = parsed.searchParams.get("options") || "";
    const dimensionOption = `-c companyos.embedding_dimensions=${dimensions}`;
    parsed.searchParams.set("options", existingOptions ? `${existingOptions} ${dimensionOption}` : dimensionOption);
    return parsed.toString();
  } catch {
    return url;
  }
}

const databaseUrl = databaseUrlWithEmbeddingOptions(
  process.env.DATABASE_URL || "postgresql://user:pass@localhost:5432/dummy"
);

export default defineConfig({
  schema: "./src/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
