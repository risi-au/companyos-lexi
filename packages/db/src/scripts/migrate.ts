import { execSync } from "child_process";

// db:migrate now executes drizzle-kit migrate (per brief + CONSTITUTION §8).
// This script kept for compatibility / explicit invocation. Runs against DATABASE_URL via drizzle.config.ts.
// Dry-verifiable at parse/typecheck time; requires live DB + connection for actual apply.

async function main() {
  console.log("Running drizzle-kit migrate (applies committed migrations from ./drizzle using DATABASE_URL)...");
  // Execute kit directly so "execute drizzle-kit correctly". cwd expected at packages/db when invoked via pnpm filter.
  execSync("drizzle-kit migrate", { stdio: "inherit" });
  console.log("Migrations complete");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});