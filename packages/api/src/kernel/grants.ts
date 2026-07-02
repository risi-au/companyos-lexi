import { eq, and, inArray } from "drizzle-orm";
import { grants, scopes } from "@companyos/db";
import type { Grant } from "@companyos/db";
import { emitEvent, type DB } from "./events";
import { getScope } from "./scopes";
import { AccessDeniedError, ScopeNotFoundError } from "../errors";

// `agent` ranks with editor: an agent grant confers read+write within its
// subtree (DESIGN.md §5), but never admin/owner actions.
const ROLE_RANK: Record<Grant["role"], number> = {
  owner: 5,
  admin: 4,
  editor: 3,
  agent: 3,
  viewer: 2,
};

function getHighestRole(roles: Grant["role"][]): Grant["role"] | null {
  if (roles.length === 0) return null;
  return roles.reduce((highest, current) => {
    return ROLE_RANK[current] > ROLE_RANK[highest] ? current : highest;
  });
}

export interface GrantRoleInput {
  principalId: string;
  scopePath: string;
  role: Grant["role"];
}

export async function grantRole(
  db: DB,
  input: GrantRoleInput,
  actor?: string | null
): Promise<Grant> {
  const { principalId, scopePath, role } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  // Check if principal exists? (optional, let FK fail or assume caller ensures)
  const [existing] = await db
    .select()
    .from(grants)
    .where(
      and(
        eq(grants.principalId, principalId),
        eq(grants.scopeId, scope.id)
      )
    )
    .limit(1);

  let granted: Grant;
  if (existing) {
    const updatedRows = (await db
      .update(grants)
      .set({ role })
      .where(eq(grants.id, existing.id))
      .returning()) as Grant[];
    const updated = updatedRows[0];
    if (!updated) {
      throw new Error("Failed to grant role");
    }
    granted = updated;
  } else {
    const insertedRows = (await db
      .insert(grants)
      .values({
        principalId,
        scopeId: scope.id,
        role,
      })
      .returning()) as Grant[];
    const inserted = insertedRows[0];
    if (!inserted) {
      throw new Error("Failed to grant role");
    }
    granted = inserted;
  }

  await emitEvent(db, {
    type: "grant.created",
    scopePath,
    principalId: actor ?? null,
    payload: { principalId, role, scopePath },
  });

  return granted;
}

export async function resolveAccess(db: DB, principalId: string, scopePath: string): Promise<Grant["role"] | null> {
  // Ancestor walk via parent_id chain (self → ... → root). Grants on any
  // ancestor confer on the subtree. Path strings can't be used here: the
  // root scope is the parent of top-level scopes but absent from their paths.
  const target = await getScope(db, scopePath);
  if (!target) return null;

  const ancestorIds: string[] = [target.id];
  let parentId: string | null = target.parentId;
  while (parentId) {
    const [parent] = (await db
      .select({ id: scopes.id, parentId: scopes.parentId })
      .from(scopes)
      .where(eq(scopes.id, parentId))
      .limit(1)) as { id: string; parentId: string | null }[];
    if (!parent) break;
    ancestorIds.push(parent.id);
    parentId = parent.parentId;
  }

  const principalGrants = (await db
    .select()
    .from(grants)
    .where(
      and(eq(grants.principalId, principalId), inArray(grants.scopeId, ancestorIds))
    )) as Grant[];

  const foundRoles: Grant["role"][] = principalGrants.map((g) => g.role);

  if (foundRoles.length === 0) return null;
  return getHighestRole(foundRoles);
}

export async function requireAccess(
  db: DB,
  principalId: string,
  scopePath: string,
  minRole: Grant["role"]
): Promise<void> {
  const role = await resolveAccess(db, principalId, scopePath);
  if (!role) {
    throw new AccessDeniedError(principalId, scopePath, minRole);
  }
  const roleRank = ROLE_RANK[role] ?? 0;
  const minRank = ROLE_RANK[minRole] ?? 0;
  if (roleRank < minRank) {
    throw new AccessDeniedError(principalId, scopePath, minRole);
  }
}
