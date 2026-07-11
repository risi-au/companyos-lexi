import { and, eq, sql } from "drizzle-orm";
import { grants, principals, scopes } from "@companyos/db";
import { DuplicatePathError } from "../errors";
import { grantRole } from "./grants";
import { createScope, getScope } from "./scopes";
import { type DB } from "./events";
import { getPersonalScopePath } from "./personal-path";

export interface PersonalScopeTarget {
  principalId: string;
  principalName: string;
  scopePath: string;
}

async function ensureOwnerGrant(db: DB, principalId: string, scopeId: string, scopePath: string): Promise<void> {
  const [existing] = await db
    .select({ id: grants.id, role: grants.role })
    .from(grants)
    .where(and(eq(grants.principalId, principalId), eq(grants.scopeId, scopeId)))
    .limit(1);

  if (existing?.role === "owner") return;
  await grantRole(db, { principalId, scopePath, role: "owner" }, principalId);
}

export async function ensurePersonalScope(db: DB, principalId: string): Promise<{ scopePath: string }> {
  const [principal] = await db
    .select({ id: principals.id, name: principals.name, kind: principals.kind })
    .from(principals)
    .where(eq(principals.id, principalId))
    .limit(1);
  if (!principal) throw new Error(`Principal not found: ${principalId}`);
  if (principal.kind !== "human") throw new Error(`Personal scopes are only provisioned for human principals: ${principalId}`);

  const scopePath = getPersonalScopePath(principalId);
  const existing = await getScope(db, scopePath);
  if (existing) {
    await ensureOwnerGrant(db, principalId, existing.id, scopePath);
    return { scopePath };
  }

  try {
    const created = await createScope(
      db,
      {
        slug: scopePath,
        name: `${principal.name} \u2014 personal`,
        type: "personal",
      },
      principalId
    );
    await ensureOwnerGrant(db, principalId, created.id, scopePath);
  } catch (error) {
    if (!(error instanceof DuplicatePathError)) throw error;
    const concurrent = await getScope(db, scopePath);
    if (!concurrent) throw error;
    await ensureOwnerGrant(db, principalId, concurrent.id, scopePath);
  }

  return { scopePath };
}

export async function listHumanPersonalScopeTargets(db: DB): Promise<PersonalScopeTarget[]> {
  const pathExpr = sql<string>`'personal-' || ${principals.id}`;
  return (await db
    .select({
      principalId: principals.id,
      principalName: principals.name,
      scopePath: scopes.path,
    })
    .from(principals)
    .innerJoin(scopes, eq(scopes.path, pathExpr))
    .where(and(eq(principals.kind, "human"), eq(scopes.type, "personal")))
    .orderBy(principals.name)) as PersonalScopeTarget[];
}
