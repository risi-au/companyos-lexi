import { eq, like, or, desc, asc } from "drizzle-orm";
import { scopes, moduleInstances } from "@companyos/db";
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

  let parentId: string | null = null;
  if (parentPath) {
    const [parent] = await db
      .select({ id: scopes.id })
      .from(scopes)
      .where(eq(scopes.path, parentPath))
      .limit(1);
    if (!parent) {
      throw new ParentNotFoundError(parentPath);
    }
    parentId = parent.id;
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

export async function getChildren(db: DB, path: string): Promise<Scope[]> {
  // Find direct children: path starts with "path/" but no further /
  // Simpler: query where parentId matches the target's id
  const target = await getScope(db, path);
  if (!target) return [];

  const children = await db
    .select()
    .from(scopes)
    .where(eq(scopes.parentId, target.id))
    .orderBy(desc(scopes.createdAt));

  return children as Scope[];
}

export async function getSubtree(db: DB, path: string): Promise<Scope[]> {
  const target = await getScope(db, path);
  if (!target) return [];

  // Self + any path starting with path/
  const subtree = await db
    .select()
    .from(scopes)
    .where(
      or(
        eq(scopes.path, path),
        like(scopes.path, `${path}/%`)
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

  const [updated] = (await db
    .update(scopes)
    .set({
      status: "archived",
      updatedAt: new Date(),
    })
    .where(eq(scopes.path, path))
    .returning()) as Scope[];

  if (!updated) {
    throw new ScopeNotFoundError(path);
  }

  await emitEvent(db, {
    type: "scope.archived",
    scopePath: path,
    principalId: actor ?? null,
    payload: { previousStatus: existing.status },
  });

  return updated;
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
