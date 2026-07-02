import { eq, and, isNotNull, isNull } from "drizzle-orm";
import { principals, grants } from "@companyos/db";
import { emitEvent, type DB } from "./events";
import { getScope } from "./scopes";
import { grantRole } from "./grants";

/**
 * Auth ↔ Kernel principal link service (pre-approved additive change).
 * Links Better Auth user (auth_user_id) to a principal by email or creates one.
 * Bootstrap: first linked user to sign in gets owner on root if no owner principal is linked yet.
 * Emits "principal.bootstrapped" on bootstrap.
 */

export interface LinkAuthUserInput {
  authUserId: string;
  email: string | null;
  name: string;
}

export interface LinkAuthUserResult {
  principalId: string;
  bootstrapped: boolean;
}

/**
 * Link or create principal for the authenticated Better Auth user.
 * Called on session establishment in web layer.
 */
export async function linkAuthUser(
  db: DB,
  input: LinkAuthUserInput
): Promise<LinkAuthUserResult> {
  const { authUserId, email, name } = input;

  // 1. If already linked by authUserId, return it
  let [principal] = await db
    .select()
    .from(principals)
    .where(eq(principals.authUserId, authUserId))
    .limit(1);

  if (principal) {
    return { principalId: principal.id, bootstrapped: false };
  }

  // 2. Try link by email match (existing principal)
  if (email) {
    const [byEmail] = await db
      .select()
      .from(principals)
      .where(and(eq(principals.email, email), isNull(principals.authUserId)))
      .limit(1);
    if (byEmail) {
      // link it
      await db
        .update(principals)
        .set({ authUserId })
        .where(eq(principals.id, byEmail.id));
      principal = { ...byEmail, authUserId };
      // fall to bootstrap check below
    }
  }

  // 3. Create new human principal if still no match
  if (!principal) {
    const [created] = (await db
      .insert(principals)
      .values({
        kind: "human",
        name,
        email: email ?? null,
        authUserId,
        status: "active",
      })
      .returning()) as { id: string }[];
    if (!created) throw new Error("Failed to create principal for auth user");
    principal = created;
  }

  // 4. Bootstrap check: is there ANY principal WITH authUserId (linked) that has owner grant on root?
  const root = await getScope(db, "root");
  if (!root) {
    // No root yet — unusual, but do not bootstrap
    return { principalId: principal.id, bootstrapped: false };
  }

  const anyLinkedOwner = await db
    .select({ pid: principals.id })
    .from(principals)
    .innerJoin(grants, eq(grants.principalId, principals.id))
    .where(
      and(
        eq(grants.scopeId, root.id),
        eq(grants.role, "owner"),
        isNotNull(principals.authUserId)
      )
    )
    .limit(1);

  let bootstrapped = false;
  if (anyLinkedOwner.length === 0) {
    // This is the first linked auth user — grant owner on root
    await grantRole(db, { principalId: principal.id, scopePath: "root", role: "owner" }, principal.id);
    await emitEvent(db, {
      type: "principal.bootstrapped",
      scopePath: "root",
      principalId: principal.id,
      payload: { authUserId, email, name },
    });
    bootstrapped = true;
  }

  return { principalId: principal.id, bootstrapped };
}

/**
 * Resolve the principalId for a Better Auth session user id (authUserId).
 * Returns null if no link (caller may trigger link).
 */
export async function getPrincipalIdForAuthUser(db: DB, authUserId: string): Promise<string | null> {
  const [p] = await db
    .select({ id: principals.id })
    .from(principals)
    .where(eq(principals.authUserId, authUserId))
    .limit(1);
  return p ? p.id : null;
}
