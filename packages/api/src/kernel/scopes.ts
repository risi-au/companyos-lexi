import { eq, like, or, and, desc, asc, inArray } from "drizzle-orm";
import { scopes, moduleInstances, grants, taskLinks } from "@companyos/db";
import type { Scope } from "@companyos/db";
import {
  emitEvent,
  type DB,
} from "./events";
import { requireAccess } from "./grants";
import {
  ScopeNotFoundError,
  ParentNotFoundError,
  DuplicatePathError,
  InvalidSlugError,
} from "../errors";
import { getPersonalScopePath } from "./personal-path";

const SLUG_REGEX = /^[a-z0-9-]+$/;

function computePath(parentPath: string | null, slug: string): string {
  if (!parentPath) return slug;
  return `${parentPath}/${slug}`;
}

export interface CreateScopeInput {
  parentPath?: string | null;
  slug: string;
  name: string;
  type: Scope["type"];
  settings?: Record<string, unknown>;
}

export async function createScope(
  db: DB,
  input: CreateScopeInput,
  actor?: string | null
): Promise<Scope> {
  const { parentPath = null, slug, name, type, settings = {} } = input;

  if (!SLUG_REGEX.test(slug)) {
    throw new InvalidSlugError(slug);
  }

  const path = computePath(parentPath, slug);

  // Check for duplicate path
  const [existing] = await db
    .select({ id: scopes.id })
    .from(scopes)
    .where(eq(scopes.path, path))
    .limit(1);
  if (existing) {
    throw new DuplicatePathError(path);
  }

  // Top-level scopes attach to the root scope when one exists, so grants on
  // root cover the whole tree; paths stay clean (no "root/" prefix).
  let parentId: string | null = null;
  let parentTypeForValidation: string | null = null;
  if (parentPath) {
    const [parent] = await db
      .select({ id: scopes.id, type: scopes.type })
      .from(scopes)
      .where(eq(scopes.path, parentPath))
      .limit(1);
    if (!parent) {
      throw new ParentNotFoundError(parentPath);
    }
    parentId = parent.id;
    parentTypeForValidation = parent.type;
  } else if (type !== "root") {
    const [root] = await db
      .select({ id: scopes.id, type: scopes.type })
      .from(scopes)
      .where(eq(scopes.type, "root"))
      .limit(1);
    if (root) {
      parentId = root.id;
      parentTypeForValidation = "root";
    }
  }

  // Enforce structure v2: top-level (under root) = project/personal; nested = subproject. root special.
  if (type !== "root") {
    if (parentTypeForValidation === "root" || parentTypeForValidation === null) {
      if (type !== "project" && type !== "personal") {
        throw new Error(`Top-level scopes (children of root) must have type "project" or "personal", got "${type}"`);
      }
    } else if (parentTypeForValidation) {
      if (type !== "subproject") {
        throw new Error(`Nested scopes must have type "subproject", got "${type}"`);
      }
    }
  }

  const [created] = (await db
    .insert(scopes)
    .values({
      slug,
      path,
      name,
      type,
      status: "active",
      settings,
      parentId,
    })
    .returning()) as Scope[];

  if (!created) {
    throw new Error("Failed to create scope");
  }

  await emitEvent(db, {
    type: "scope.created",
    scopePath: path,
    principalId: actor ?? null,
    payload: { slug, name, type, parentPath: parentPath ?? null },
  });

  return created;
}

export async function getScope(db: DB, path: string): Promise<Scope | null> {
  const [scope] = await db
    .select()
    .from(scopes)
    .where(eq(scopes.path, path))
    .limit(1);
  return (scope as Scope) ?? null;
}

export async function getChildren(
  db: DB,
  path: string,
  options: { includeArchived?: boolean } = {}
): Promise<Scope[]> {
  // Find direct children: path starts with "path/" but no further /
  // Simpler: query where parentId matches the target's id
  const target = await getScope(db, path);
  if (!target) return [];

  const children = await db
    .select()
    .from(scopes)
    .where(
      options.includeArchived
        ? eq(scopes.parentId, target.id)
        : and(eq(scopes.parentId, target.id), eq(scopes.status, "active"))
    )
    .orderBy(desc(scopes.createdAt));

  return children as Scope[];
}

export async function getSubtree(
  db: DB,
  path: string,
  options: { includeArchived?: boolean } = { includeArchived: true }
): Promise<Scope[]> {
  const target = await getScope(db, path);
  if (!target) return [];

  // The root scope's children carry no "root/" path prefix — its subtree is
  // every scope.
  if (target.type === "root") {
    const all = options.includeArchived === false
      ? await db.select().from(scopes).where(eq(scopes.status, "active")).orderBy(scopes.path)
      : await db.select().from(scopes).orderBy(scopes.path);
    return all as Scope[];
  }

  // Self + any path starting with path/
  const subtree = await db
    .select()
    .from(scopes)
    .where(
      and(
        or(
          eq(scopes.path, path),
          like(scopes.path, `${path}/%`)
        ),
        options.includeArchived === false ? eq(scopes.status, "active") : undefined
      )
    )
    .orderBy(scopes.path);

  return subtree as Scope[];
}

export async function archiveScope(
  db: DB,
  path: string,
  actor?: string | null
): Promise<Scope> {
  const [existing] = await db
    .select()
    .from(scopes)
    .where(eq(scopes.path, path))
    .limit(1);

  if (!existing) {
    throw new ScopeNotFoundError(path);
  }
  if (existing.type === "root") {
    throw new Error("Root scope cannot be archived");
  }

  await requireAccess(db, actor ?? "", path, "admin");

  const updated = (await db
    .update(scopes)
    .set({
      status: "archived",
      updatedAt: new Date(),
    })
    .where(or(eq(scopes.path, path), like(scopes.path, `${path}/%`)))
    .returning()) as Scope[];

  const target = updated.find((scope) => scope.path === path);
  if (!target) {
    throw new ScopeNotFoundError(path);
  }

  const [taskLink] = await db
    .select({
      planeProjectId: taskLinks.planeProjectId,
      planeWorkspaceSlug: taskLinks.planeWorkspaceSlug,
    })
    .from(taskLinks)
    .where(eq(taskLinks.scopeId, existing.id))
    .limit(1);

  await emitEvent(db, {
    type: "scope.archived",
    scopePath: path,
    principalId: actor ?? null,
    payload: {
      previousStatus: existing.status,
      descendantCount: Math.max(0, updated.length - 1),
      ...(taskLink
        ? {
            planeProjectId: taskLink.planeProjectId,
            planeWorkspaceSlug: taskLink.planeWorkspaceSlug,
          }
        : {}),
    },
  });

  return target;
}

export async function unarchiveScope(
  db: DB,
  path: string,
  actor?: string | null
): Promise<Scope> {
  const existing = await getScope(db, path);
  if (!existing) {
    throw new ScopeNotFoundError(path);
  }

  await requireAccess(db, actor ?? "", path, "admin");

  const updated = (await db
    .update(scopes)
    .set({ status: "active", updatedAt: new Date() })
    .where(or(eq(scopes.path, path), like(scopes.path, `${path}/%`)))
    .returning()) as Scope[];

  const ancestorIds: string[] = [];
  let parentId = existing.parentId;
  while (parentId) {
    const [parent] = await db
      .select({ id: scopes.id, parentId: scopes.parentId, status: scopes.status })
      .from(scopes)
      .where(eq(scopes.id, parentId))
      .limit(1);
    if (!parent) break;
    if (parent.status === "archived") ancestorIds.push(parent.id);
    parentId = parent.parentId;
  }

  if (ancestorIds.length > 0) {
    await db
      .update(scopes)
      .set({ status: "active", updatedAt: new Date() })
      .where(inArray(scopes.id, ancestorIds));
  }

  const target = updated.find((scope) => scope.path === path);
  if (!target) {
    throw new ScopeNotFoundError(path);
  }

  await emitEvent(db, {
    type: "scope.unarchived",
    scopePath: path,
    principalId: actor ?? null,
    payload: {
      previousStatus: existing.status,
      descendantCount: Math.max(0, updated.length - 1),
      ancestorCount: ancestorIds.length,
    },
  });

  return target;
}

export interface ModuleInstanceInfo {
  moduleType: string;
  config: Record<string, unknown>;
  position: number;
}

export async function listModules(
  db: DB,
  scopePath: string,
  actorPrincipalId: string
): Promise<ModuleInstanceInfo[]> {
  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const scope = await getScope(db, scopePath);
  if (!scope) return [];

  const rows = await db
    .select({
      moduleType: moduleInstances.moduleType,
      config: moduleInstances.config,
      position: moduleInstances.position,
    })
    .from(moduleInstances)
    .where(eq(moduleInstances.scopeId, scope.id))
    .orderBy(asc(moduleInstances.position), desc(moduleInstances.createdAt));

  return rows as ModuleInstanceInfo[];
}

/**
 * Returns the scopes visible to this principal.
 * - If principal has any grant on root, return full tree (incl root).
 * - Else, for each top-level project (child of root), include its subtree iff
 *   the principal has access to that project (via direct grant or ancestor, excluding root here).
 * - Root row is included only for root-granted principals.
 * Used for sidebar + filtered navigation.
 */
export async function getVisibleTree(
  db: DB,
  principalId: string,
  options: { includeArchived?: boolean } = {}
): Promise<Scope[]> {
  const filterStatus = (items: Scope[]) =>
    options.includeArchived ? items : items.filter((scope) => scope.status === "active");
  // Find root
  const [root] = await db
    .select()
    .from(scopes)
    .where(eq(scopes.type, "root"))
    .limit(1);
  if (!root) return [];

  // Check for root grant (any role on root scope)
  const rootGrants = await db
    .select({ id: grants.id })
    .from(grants)
    .where(
      and(
        eq(grants.principalId, principalId),
        eq(grants.scopeId, root.id)
      )
    )
    .limit(1);
  const hasRootGrant = rootGrants.length > 0;

  if (hasRootGrant) {
    // Full access, except other principals' personal scopes.
    const ownPersonalPath = getPersonalScopePath(principalId);
    const all = await db.select().from(scopes).orderBy(scopes.path);
    return filterStatus(
      (all as Scope[]).filter((scope) => scope.type !== "personal" || scope.path === ownPersonalPath)
    );
  }

  // No root grant: collect visible top-level project subtrees
  const topLevelProjects = await db
    .select()
    .from(scopes)
    .where(eq(scopes.parentId, root.id))
    .orderBy(scopes.path);

  const visible: Scope[] = [];
  for (const proj of topLevelProjects) {
    // Check access to this project: grants on project itself (root grant already ruled out)
    const projGrants = await db
      .select({ id: grants.id })
      .from(grants)
      .where(
        and(
          eq(grants.principalId, principalId),
          eq(grants.scopeId, proj.id)
        )
      )
      .limit(1);
    if (projGrants.length > 0) {
      // include full subtree for this project (self + descendants)
      const sub = await db
        .select()
        .from(scopes)
        .where(
          or(
            eq(scopes.path, proj.path),
            like(scopes.path, `${proj.path}/%`)
          )
        )
        .orderBy(scopes.path);
      visible.push(...filterStatus(sub as Scope[]));
    }
  }

  return visible;
}

export async function listArchivedScopes(db: DB, principalId: string): Promise<Scope[]> {
  const visible = await getVisibleTree(db, principalId, { includeArchived: true });
  const byId = new Map(visible.map((scope) => [scope.id, scope]));

  return visible.filter((scope) => {
    if (scope.status !== "archived" || scope.type === "root") return false;
    const parent = scope.parentId ? byId.get(scope.parentId) : null;
    return parent?.status !== "archived";
  });
}
