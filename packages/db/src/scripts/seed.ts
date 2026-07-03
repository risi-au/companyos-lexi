import { config as loadEnv } from "dotenv";
loadEnv({ path: ["../../.env", ".env"], quiet: true });
import { createDb } from "../index";
import { scopes, principals, grants } from "../schema";
import { eq, and } from "drizzle-orm";

async function main() {
  const db = createDb();

  const rootPath = "root";
  const instanceName = process.env.INSTANCE_NAME || "CompanyOS";
  const principalName = process.env.SEED_PRINCIPAL_NAME || "Root Owner";
  const principalEmail = process.env.SEED_PRINCIPAL_EMAIL || undefined;

  // Idempotent root scope by path
  let [rootScope] = await db
    .select()
    .from(scopes)
    .where(eq(scopes.path, rootPath))
    .limit(1);

  if (!rootScope) {
    [rootScope] = await db
      .insert(scopes)
      .values({
        slug: "root",
        path: rootPath,
        name: instanceName,
        type: "root",
        status: "active",
        settings: {},
      })
      .returning();
  }

  if (!rootScope) {
    throw new Error("Failed to create or find root scope");
  }

  // Idempotent principal by email (if provided) or name
  let [principal] = await db
    .select()
    .from(principals)
    .where(
      principalEmail
        ? eq(principals.email, principalEmail)
        : eq(principals.name, principalName)
    )
    .limit(1);

  if (!principal) {
    [principal] = await db
      .insert(principals)
      .values({
        kind: "human",
        name: principalName,
        email: principalEmail,
        status: "active",
      })
      .returning();
  }

  if (!principal) {
    throw new Error("Failed to create or find principal");
  }

  // Idempotent owner grant on root
  const [existingGrant] = await db
    .select()
    .from(grants)
    .where(
      and(
        eq(grants.principalId, principal.id),
        eq(grants.scopeId, rootScope.id)
      )
    )
    .limit(1);

  if (!existingGrant) {
    await db.insert(grants).values({
      principalId: principal.id,
      scopeId: rootScope.id,
      role: "owner",
    });
  }

  console.log("Seed complete: root scope + owner principal + grant ensured.");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});