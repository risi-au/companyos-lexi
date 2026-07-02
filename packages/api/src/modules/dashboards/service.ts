import { eq, and, desc, inArray, not } from "drizzle-orm";
import { dashboards, dashboardRevisions } from "@companyos/db";
import type { Dashboard, DashboardRevision } from "@companyos/db";
import {
  emitEvent,
  type DB,
} from "../../kernel/events";
import { getScope } from "../../kernel/scopes";
import { requireAccess } from "../../kernel/grants";
import {
  ScopeNotFoundError,
  DashboardValidationError,
} from "../../errors";
import {
  validateDashboardSpec,
  getWidgetVocabulary as getVocab,
} from "./spec";

export interface SaveDashboardInput {
  scopePath: string;
  name?: string;
  spec: unknown;
}

const MAX_REVISIONS = 50;

async function pruneOldRevisions(db: DB, dashboardId: string): Promise<void> {
  // Keep the most recent MAX_REVISIONS
  const revs = (await db
    .select({ id: dashboardRevisions.id })
    .from(dashboardRevisions)
    .where(eq(dashboardRevisions.dashboardId, dashboardId))
    .orderBy(desc(dashboardRevisions.createdAt))
    .limit(MAX_REVISIONS + 1)) as { id: string }[];

  if (revs.length > MAX_REVISIONS) {
    const keepIds = revs.slice(0, MAX_REVISIONS).map((r) => r.id);
    await db
      .delete(dashboardRevisions)
      .where(
        and(
          eq(dashboardRevisions.dashboardId, dashboardId),
          not(inArray(dashboardRevisions.id, keepIds))
        )
      );
  }
}

async function appendRevision(db: DB, dashboardId: string, spec: Record<string, unknown>, savedBy: string): Promise<void> {
  await db.insert(dashboardRevisions).values({
    dashboardId,
    spec,
    savedBy,
  });
  await pruneOldRevisions(db, dashboardId);
}

export async function saveDashboard(
  db: DB,
  input: SaveDashboardInput,
  actorPrincipalId: string
): Promise<Dashboard> {
  const { scopePath, name = "main", spec } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  await requireAccess(db, actorPrincipalId, scopePath, "editor");

  const validation = validateDashboardSpec(spec);
  if (!validation.success) {
    throw new DashboardValidationError(validation.errors);
  }
  const validSpec = validation.spec as unknown as Record<string, unknown>;

  // upsert dashboard by (scope_id, name)
  let existing: Dashboard | null = null;
  const [found] = (await db
    .select()
    .from(dashboards)
    .where(
      and(eq(dashboards.scopeId, scope.id), eq(dashboards.name, name))
    )
    .limit(1)) as Dashboard[];
  if (found) {
    existing = found;
  }

  let saved: Dashboard;
  const now = new Date();

  if (existing) {
    const [updated] = (await db
      .update(dashboards)
      .set({
        spec: validSpec,
        updatedBy: actorPrincipalId,
        updatedAt: now,
      })
      .where(eq(dashboards.id, existing.id))
      .returning()) as Dashboard[];
    if (!updated) {
      throw new Error("Failed to update dashboard");
    }
    saved = updated;
  } else {
    const [created] = (await db
      .insert(dashboards)
      .values({
        scopeId: scope.id,
        name,
        spec: validSpec,
        updatedBy: actorPrincipalId,
      })
      .returning()) as Dashboard[];
    if (!created) {
      throw new Error("Failed to create dashboard");
    }
    saved = created;
  }

  await appendRevision(db, saved.id, validSpec, actorPrincipalId);

  await emitEvent(db, {
    type: "dashboard.saved",
    scopePath,
    principalId: actorPrincipalId,
    payload: { name, dashboardId: saved.id },
  });

  return saved;
}

export interface GetDashboardInput {
  scopePath: string;
  name?: string;
}

export async function getDashboard(
  db: DB,
  input: GetDashboardInput,
  actorPrincipalId: string
): Promise<Dashboard | null> {
  const { scopePath, name = "main" } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    return null;
  }

  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const [dash] = (await db
    .select()
    .from(dashboards)
    .where(
      and(eq(dashboards.scopeId, scope.id), eq(dashboards.name, name))
    )
    .limit(1)) as Dashboard[];

  return dash ?? null;
}

export async function listDashboards(
  db: DB,
  input: { scopePath: string },
  actorPrincipalId: string
): Promise<Dashboard[]> {
  const { scopePath } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    return [];
  }

  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const rows = (await db
    .select()
    .from(dashboards)
    .where(eq(dashboards.scopeId, scope.id))
    .orderBy(desc(dashboards.updatedAt))) as Dashboard[];

  return rows;
}

export interface ListRevisionsInput {
  scopePath: string;
  name?: string;
  limit?: number;
}

export async function listRevisions(
  db: DB,
  input: ListRevisionsInput,
  actorPrincipalId: string
): Promise<DashboardRevision[]> {
  const { scopePath, name = "main", limit = 50 } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    return [];
  }

  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const [dash] = (await db
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(
      and(eq(dashboards.scopeId, scope.id), eq(dashboards.name, name))
    )
    .limit(1)) as { id: string }[];

  if (!dash) {
    return [];
  }

  const effectiveLimit = Math.min(Math.max(1, limit), 200);
  const revs = (await db
    .select()
    .from(dashboardRevisions)
    .where(eq(dashboardRevisions.dashboardId, dash.id))
    .orderBy(desc(dashboardRevisions.createdAt))
    .limit(effectiveLimit)) as DashboardRevision[];

  return revs;
}

export interface RevertDashboardInput {
  scopePath: string;
  name?: string;
  revisionId: string;
}

export async function revertDashboard(
  db: DB,
  input: RevertDashboardInput,
  actorPrincipalId: string
): Promise<Dashboard> {
  const { scopePath, name = "main", revisionId } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  await requireAccess(db, actorPrincipalId, scopePath, "editor");

  // find dashboard
  const [dash] = (await db
    .select()
    .from(dashboards)
    .where(
      and(eq(dashboards.scopeId, scope.id), eq(dashboards.name, name))
    )
    .limit(1)) as Dashboard[];

  if (!dash) {
    throw new Error(`Dashboard not found: ${name}`);
  }

  // find revision belonging to this dash
  const [rev] = (await db
    .select()
    .from(dashboardRevisions)
    .where(
      and(
        eq(dashboardRevisions.id, revisionId),
        eq(dashboardRevisions.dashboardId, dash.id)
      )
    )
    .limit(1)) as DashboardRevision[];

  if (!rev) {
    throw new Error(`Revision not found: ${revisionId}`);
  }

  const now = new Date();
  const specToRestore = rev.spec as Record<string, unknown>;

  // update head
  const [updated] = (await db
    .update(dashboards)
    .set({
      spec: specToRestore,
      updatedBy: actorPrincipalId,
      updatedAt: now,
    })
    .where(eq(dashboards.id, dash.id))
    .returning()) as Dashboard[];

  if (!updated) {
    throw new Error("Failed to revert dashboard");
  }

  // append as new revision (this counts toward history)
  await appendRevision(db, dash.id, specToRestore, actorPrincipalId);

  await emitEvent(db, {
    type: "dashboard.reverted",
    scopePath,
    principalId: actorPrincipalId,
    payload: { name, dashboardId: dash.id, fromRevisionId: revisionId },
  });

  return updated;
}

export function getWidgetVocabulary() {
  return getVocab();
}
