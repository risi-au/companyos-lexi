import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../index";

async function main() {
  const db = createDb();
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});