/* eslint-disable @typescript-eslint/no-explicit-any */
import { eq } from "drizzle-orm";
import { taskLinks, scopes } from "@companyos/db";
import type { TaskLink } from "@companyos/db";
import {
  emitEvent,
  type DB,
} from "../../kernel/events";
import { getScope } from "../../kernel/scopes";
import { requireAccess } from "../../kernel/grants";
import { createRecord } from "../records/service";
import {
  ScopeNotFoundError,
} from "../../errors";
import { PlaneClient } from "./plane-client";

export interface TaskTarget {
  projectId: string;
  labelId: string | null;
  /** Registered workspace slug for this scope's project; null = client's default workspace (legacy v1). */
  workspaceSlug: string | null;
}

/** Rebind the client to the target's workspace (no-op for legacy/default targets). */
export function planeForTarget(plane: PlaneClient, target: { workspaceSlug: string | null }): PlaneClient {
  return target.workspaceSlug ? plane.forWorkspace(target.workspaceSlug) : plane;
}

/** Create a Plane project, adopting an existing one by name on conflict (409). */
async function ensurePlaneProject(plane: PlaneClient, name: string, identifier: string): Promise<string> {
  let proj: any;
  try {
    proj = await plane.createProject(name, identifier);
  } catch {
    const existing = await plane.getProjects();
    const list = Array.isArray(existing) ? existing : (existing as any)?.results || [];
    proj = list.find((pr: any) => pr.name === name);
    if (!proj) throw new Error(`Plane project create failed and no existing project named ${name}`);
  }
  const projectId =
    proj.id || proj.uuid || proj.project_id || (typeof proj === "string" ? proj : "") || (proj as any).results?.[0]?.id || "";
  if (!projectId) throw new Error("Failed to obtain plane project id");
  return projectId;
}

function projectIdentifier(seed: string): string {
  return seed.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) || "TASK";
}

async function getTaskLink(db: DB, scopeId: string): Promise<TaskLink | null> {
  const [row] = (await db
    .select()
    .from(taskLinks)
    .where(eq(taskLinks.scopeId, scopeId))
    .limit(1)) as any[];
  return (row as TaskLink) || null;
}

async function upsertTaskLink(
  db: DB,
  scopeId: string,
  values: { planeProjectId?: string; planeLabelId?: string | null; planeWorkspaceSlug?: string | null }
): Promise<void> {
  const existing = await getTaskLink(db, scopeId);
  if (existing) {
    await db.update(taskLinks).set(values).where(eq(taskLinks.id, existing.id));
  } else {
    await db.insert(taskLinks).values({
      scopeId,
      planeProjectId: values.planeProjectId ?? "",
      planeLabelId: values.planeLabelId ?? null,
      planeWorkspaceSlug: values.planeWorkspaceSlug ?? null,
    });
  }
}

export async function ensureTaskTarget(
  db: DB,
  plane: PlaneClient,
  scopePath: string
): Promise<TaskTarget> {
  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  // compute top-level scope path for the project (first segment)
  const topPath = scopePath.split("/")[0] || scopePath;

  const topScope = topPath === scopePath ? scope : await getScope(db, topPath);
  const topScopeId = topScope?.id ?? null;

  const topLink: TaskLink | null = topScopeId ? await getTaskLink(db, topScopeId) : null;

  // M4-03: registered workspace → v2 mapping (workspace-per-project)
  const registeredSlug = topLink?.planeWorkspaceSlug || null;
  if (registeredSlug && topScope) {
    return ensureTaskTargetV2(db, plane.forWorkspace(registeredSlug), registeredSlug, scope, topScope, topLink);
  }

  // ---- legacy v1: one Plane project per OS project in the default workspace ----
  let projectId = "";
  if (topLink && topLink.planeProjectId) {
    projectId = topLink.planeProjectId;
  } else {
    // create project lazily in Plane; adopt an existing project on name
    // conflict (409) — happens when task_links is missing but Plane has it
    const projName = topScope?.name || topPath;
    projectId = await ensurePlaneProject(plane, projName, projectIdentifier(topPath));

    if (topScope) {
      await upsertTaskLink(db, topScope.id, { planeProjectId: projectId });
      await emitEvent(db, {
        type: "tasks.target_provisioned",
        scopePath: topPath,
        payload: { planeProjectId: projectId, kind: "project" },
      });
    }
  }
  if (!projectId) throw new Error("Failed to resolve plane project id for target");

  // now ensure label for the *exact* scopePath
  const labelName = `scope:${scopePath}`;

  // check if we have a stored link for this exact scope
  const existing = await getTaskLink(db, scope.id);

  if (existing && existing.planeLabelId) {
    // idempotent: already have label for this scope
    return { projectId, labelId: existing.planeLabelId, workspaceSlug: null };
  }

  // ensure label exists in plane project (list + find or create)
  const labels = await plane.listLabels(projectId);
  let label = labels.find((l: any) => (l.name || l.title) === labelName);
  if (!label) {
    label = await plane.createLabel(projectId, labelName, "#0ea5e9");
  }
  const labelId = label.id || label.uuid || (label as any).label_id;

  if (!labelId) throw new Error("Failed to obtain plane label id");

  await upsertTaskLink(db, scope.id, { planeProjectId: projectId, planeLabelId: labelId });

  await emitEvent(db, {
    type: "tasks.target_provisioned",
    scopePath,
    payload: { planeProjectId: projectId, planeLabelId: labelId, kind: "scope" },
  });

  return { projectId, labelId, workspaceSlug: null };
}

/**
 * V2 mapping (registered workspace): the OS project's own tasks live in a "General"
 * Plane project; each second-level subproject gets its own Plane project; deeper
 * scopes use their second-level ancestor's project + a scope:<path> label.
 * Rows written under v2 always carry the workspace slug; rows with a different
 * (or missing) slug are stale v1/other-workspace links and are ignored + rewritten.
 */
async function ensureTaskTargetV2(
  db: DB,
  wsPlane: PlaneClient,
  slug: string,
  scope: NonNullable<Awaited<ReturnType<typeof getScope>>>,
  topScope: NonNullable<Awaited<ReturnType<typeof getScope>>>,
  topLink: TaskLink | null
): Promise<TaskTarget> {
  const segments = scope.path.split("/");

  // Top-level project itself → "General"
  if (segments.length === 1) {
    let projectId = topLink?.planeWorkspaceSlug === slug ? topLink.planeProjectId : "";
    if (!projectId) {
      projectId = await ensurePlaneProject(wsPlane, "General", "GEN");
      await upsertTaskLink(db, topScope.id, { planeProjectId: projectId, planeLabelId: null, planeWorkspaceSlug: slug });
      await emitEvent(db, {
        type: "tasks.target_provisioned",
        scopePath: topScope.path,
        payload: { planeProjectId: projectId, planeWorkspaceSlug: slug, kind: "workspace-general" },
      });
    }
    return { projectId, labelId: null, workspaceSlug: slug };
  }

  // Second-level subproject → its own Plane project in the workspace
  const secondPath = segments.slice(0, 2).join("/");
  const secondScope = secondPath === scope.path ? scope : await getScope(db, secondPath);
  if (!secondScope) throw new ScopeNotFoundError(secondPath);

  const secondLink = await getTaskLink(db, secondScope.id);
  let projectId = secondLink?.planeWorkspaceSlug === slug ? secondLink.planeProjectId : "";
  if (!projectId) {
    projectId = await ensurePlaneProject(wsPlane, secondScope.name, projectIdentifier(secondScope.slug));
    await upsertTaskLink(db, secondScope.id, { planeProjectId: projectId, planeLabelId: null, planeWorkspaceSlug: slug });
    await emitEvent(db, {
      type: "tasks.target_provisioned",
      scopePath: secondScope.path,
      payload: { planeProjectId: projectId, planeWorkspaceSlug: slug, kind: "subproject-project" },
    });
  }

  if (segments.length === 2) {
    return { projectId, labelId: null, workspaceSlug: slug };
  }

  // Deeper nesting → label scope:<path> inside the second-level project
  const exactLink = scope.id === secondScope.id ? secondLink : await getTaskLink(db, scope.id);
  if (exactLink && exactLink.planeWorkspaceSlug === slug && exactLink.planeProjectId === projectId && exactLink.planeLabelId) {
    return { projectId, labelId: exactLink.planeLabelId, workspaceSlug: slug };
  }

  const labelName = `scope:${scope.path}`;
  const labels = await wsPlane.listLabels(projectId);
  let label = labels.find((l: any) => (l.name || l.title) === labelName);
  if (!label) {
    label = await wsPlane.createLabel(projectId, labelName, "#0ea5e9");
  }
  const labelId = label.id || label.uuid || (label as any).label_id;
  if (!labelId) throw new Error("Failed to obtain plane label id");

  await upsertTaskLink(db, scope.id, { planeProjectId: projectId, planeLabelId: labelId, planeWorkspaceSlug: slug });

  await emitEvent(db, {
    type: "tasks.target_provisioned",
    scopePath: scope.path,
    payload: { planeProjectId: projectId, planeLabelId: labelId, planeWorkspaceSlug: slug, kind: "scope" },
  });

  return { projectId, labelId, workspaceSlug: slug };
}

export interface SetProjectWorkspaceInput {
  scopePath: string;
  workspaceSlug: string;
}

/**
 * Register a manually-created Plane workspace for a top-level project (M4-03).
 * Plane CE's public API cannot create or list workspaces, so the OS adopts one
 * by slug after validating it is reachable with the configured token.
 * Re-registering with a different slug resets the project's stored Plane ids
 * (they belong to the old workspace); deeper scopes are lazily re-provisioned
 * by ensureTaskTarget because their slug no longer matches.
 */
export async function setProjectWorkspace(
  db: DB,
  plane: PlaneClient,
  input: SetProjectWorkspaceInput,
  actorPrincipalId: string
): Promise<void> {
  const { scopePath, workspaceSlug } = input;

  if (!workspaceSlug || !/^[a-z0-9][a-z0-9_-]*$/.test(workspaceSlug)) {
    throw new Error(`Invalid workspace slug: "${workspaceSlug}"`);
  }

  await requireAccess(db, actorPrincipalId, scopePath, "admin");

  const scope = await getScope(db, scopePath);
  if (!scope) throw new ScopeNotFoundError(scopePath);
  if (scope.type !== "project" || scope.path.includes("/")) {
    throw new Error("A Plane workspace can only be registered on a top-level project");
  }

  // Reachability check: cheapest authenticated call in the target workspace
  try {
    await plane.forWorkspace(workspaceSlug).getProjects();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Plane workspace "${workspaceSlug}" is not reachable with the configured token: ${msg}`);
  }

  const existing = await getTaskLink(db, scope.id);
  if (existing) {
    if (existing.planeWorkspaceSlug !== workspaceSlug) {
      await upsertTaskLink(db, scope.id, { planeWorkspaceSlug: workspaceSlug, planeProjectId: "", planeLabelId: null });
    }
  } else {
    await upsertTaskLink(db, scope.id, { planeWorkspaceSlug: workspaceSlug });
  }

  await emitEvent(db, {
    type: "tasks.workspace_registered",
    scopePath,
    principalId: actorPrincipalId,
    payload: { planeWorkspaceSlug: workspaceSlug },
  });
}

export interface CreateTaskInput {
  scopePath: string;
  title: string;
  description?: string;
  priority?: "urgent" | "high" | "medium" | "low" | "none";
  dueDate?: string; // ISO date for target_date
}

export async function createTask(
  db: DB,
  plane: PlaneClient,
  input: CreateTaskInput,
  actorPrincipalId: string
): Promise<{ id: string; sequenceId: string | number; url: string }> {
  const { scopePath, title, description, priority, dueDate } = input;

  await requireAccess(db, actorPrincipalId, scopePath, "editor");

  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  const target = await ensureTaskTarget(db, plane, scopePath);
  const targetPlane = planeForTarget(plane, target);

  const issueData: any = {
    name: title,
  };
  if (description) {
    issueData.description_html = `<p>${description.replace(/</g, "&lt;")}</p>`;
  }
  if (priority) issueData.priority = priority;
  if (dueDate) issueData.target_date = dueDate;
  if (target.labelId) {
    issueData.labels = [target.labelId];
  }

  // pick a default state? omit to let Plane use project's default (usually backlog)
  const created = await targetPlane.createIssue(target.projectId, issueData);

  const issueId = created.id || created.uuid || created.work_item_id;
  const sequenceId = created.sequence_id || created.sequenceId || created.id;
  // construct a usable url; Plane responses may vary
  const base = targetPlane.baseUrl || "";
  const ws = targetPlane.workspaceSlug || "";
  const url = base && ws && issueId
    ? `${base.replace(/\/$/, "")}/${ws}/projects/${target.projectId}/work-items/${issueId}/`
    : `plane:issue:${issueId}`;

  await emitEvent(db, {
    type: "task.created",
    scopePath,
    principalId: actorPrincipalId,
    payload: {
      planeProjectId: target.projectId,
      planeIssueId: issueId,
      planeLabelId: target.labelId,
      planeWorkspaceSlug: target.workspaceSlug,
      title,
      sequenceId,
    },
  });

  return { id: issueId, sequenceId, url };
}

export interface CompleteTaskInput {
  issueId: string;
  scopePath: string;
  note?: string;
}

export async function completeTask(
  db: DB,
  plane: PlaneClient,
  input: CompleteTaskInput,
  actorPrincipalId: string
): Promise<void> {
  const { issueId, scopePath, note } = input;

  await requireAccess(db, actorPrincipalId, scopePath, "editor");

  const target = await ensureTaskTarget(db, plane, scopePath);
  const targetPlane = planeForTarget(plane, target);

  // fetch states and pick completed group
  const states = await targetPlane.getStates(target.projectId);
  let doneState = states.find((s: any) => (s.group || s.state_group) === "completed");
  if (!doneState && states.length) {
    // fallback to last state or name containing done/complete
    doneState = states.find((s: any) => /done|complete|closed|finished/i.test(s.name || "")) || states[states.length - 1];
  }
  const stateId = doneState?.id || doneState?.uuid;

  await targetPlane.updateIssue(target.projectId, issueId, stateId ? { state: stateId } : {});

  // optional changelog via records (cross-module via public service)
  if (note && note.trim()) {
    try {
      await createRecord(
        db,
        {
          scopePath,
          kind: "changelog",
          title: `Task completed`,
          bodyMd: note,
          data: { planeIssueId: issueId },
        },
        actorPrincipalId
      );
    } catch {
      // do not fail complete if record write has issue
    }
  }

  await emitEvent(db, {
    type: "task.completed",
    scopePath,
    principalId: actorPrincipalId,
    payload: { planeIssueId: issueId, note: note || null },
  });
}

export interface UpdateTaskInput {
  issueId: string;
  scopePath: string;
  title?: string;
  description?: string;
  state?: string;
  priority?: string;
  dueDate?: string;
}

export async function updateTask(
  db: DB,
  plane: PlaneClient,
  input: UpdateTaskInput,
  actorPrincipalId: string
): Promise<void> {
  const { issueId, scopePath, title, description, state, priority, dueDate } = input;

  await requireAccess(db, actorPrincipalId, scopePath, "editor");

  const target = await ensureTaskTarget(db, plane, scopePath);
  const targetPlane = planeForTarget(plane, target);

  const patch: any = {};
  if (title !== undefined) patch.name = title;
  if (description !== undefined) patch.description_html = `<p>${description.replace(/</g, "&lt;")}</p>`;
  if (state !== undefined) patch.state = state;
  if (priority !== undefined) patch.priority = priority;
  if (dueDate !== undefined) patch.target_date = dueDate;

  await targetPlane.updateIssue(target.projectId, issueId, patch);

  await emitEvent(db, {
    type: "task.updated",
    scopePath,
    principalId: actorPrincipalId,
    payload: { planeIssueId: issueId, fields: Object.keys(patch) },
  });
}

export interface ListTasksInput {
  scopePath: string;
  state?: "open" | "completed" | "all";
  limit?: number;
}

export interface TaskSummary {
  id: string;
  sequenceId: string | number;
  title: string;
  state?: string;
  assignee?: string | null;
  dueDate?: string | null;
}

export async function listTasks(
  db: DB,
  plane: PlaneClient,
  input: ListTasksInput,
  actorPrincipalId: string
): Promise<TaskSummary[]> {
  const { scopePath, state = "all", limit = 50 } = input;

  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const target = await ensureTaskTarget(db, plane, scopePath);
  const targetPlane = planeForTarget(plane, target);

  const filters: any = {};
  if (target.labelId) filters.label = target.labelId;

  if (state === "completed") filters.state_group = "completed";
  else if (state === "open") {
    // open = not completed; many impls filter by excluding or use state_group != 
    // for simplicity pass no filter or use a non-completed; mock will handle
  }

  let issues = await targetPlane.listIssues(target.projectId, filters);

  if (state === "open") {
    issues = issues.filter((i: any) => {
      const g = i.state?.group || i.group || i.state_group;
      return !g || g !== "completed";
    });
  }

  const sliced = issues.slice(0, Math.min(200, Math.max(1, limit ?? 50)));

  return sliced.map((i: any) => {
    const seq = i.sequence_id || i.sequenceId || i.id;
    const st = i.state?.name || i.state || i.group || "";
    const due = i.target_date || i.due_date || null;
    const ass = (i.assignees && i.assignees[0]?.name) || (i.assignee?.name) || null;
    return {
      id: i.id || i.uuid,
      sequenceId: seq,
      title: i.name || i.title || "Untitled",
      state: st,
      assignee: ass,
      dueDate: due,
    };
  });
}

export interface PlaneLinkLookupResult {
  scopePath: string;
  scopeId: string;
  planeProjectId: string;
  planeLabelId: string | null;
}

/**
 * Reverse lookup for Plane webhook ingestion.
 * Finds the most specific scope linked to a Plane project (and optional label).
 * If label present on link, prefers exact match when label provided in webhook.
 */
export async function findScopeByPlaneProject(
  db: DB,
  planeProjectId: string,
  planeLabelId?: string | null
): Promise<PlaneLinkLookupResult | null> {
  if (!planeProjectId) return null;

  const rows = (await db
    .select()
    .from(taskLinks)
    .where(eq(taskLinks.planeProjectId, planeProjectId))) as any[];

  if (!rows || rows.length === 0) return null;

  // Prefer exact label match if provided
  let pick: any = null;
  if (planeLabelId) {
    pick = rows.find((r: any) => r.planeLabelId === planeLabelId);
  }
  if (!pick) {
    // fallback to first with label or any (project-level link)
    pick = rows.find((r: any) => r.planeLabelId) || rows[0];
  }
  if (!pick) return null;

  // resolve path
  const [scopeRow] = (await db
    .select({ path: scopes.path })
    .from(scopes)
    .where(eq(scopes.id, pick.scopeId))
    .limit(1)) as { path: string | null }[];

  const path = scopeRow?.path;
  if (!path) return null;

  return {
    scopePath: path,
    scopeId: pick.scopeId,
    planeProjectId: pick.planeProjectId,
    planeLabelId: pick.planeLabelId,
  };
}

/**
 * Returns the Plane Task Manager URL for a given scopePath.
 * Uses the scope's own task_links row when present, then the top project's row.
 * Rows with null workspace slug use the env-default workspace (legacy v1).
 */
export async function getPlaneUrl(db: DB, scopePath: string): Promise<string> {
  const rawBase = process.env.PLANE_BASE_URL || "https://app.plane.so";
  const base = rawBase.replace(/\/$/, "");
  const defaultWorkspace = process.env.PLANE_WORKSPACE_SLUG || "companyos";
  if (!scopePath || scopePath === "root") {
    return base;
  }

  const scope = await getScope(db, scopePath);
  if (!scope) return base;

  const own = await getTaskLink(db, scope.id);
  if (own?.planeProjectId) {
    const slug = own.planeWorkspaceSlug || defaultWorkspace;
    return `${base}/${slug}/projects/${own.planeProjectId}/issues`;
  }

  const topPath = scope.path.split("/")[0] || scope.path;
  const top = topPath === scope.path ? scope : await getScope(db, topPath);
  if (!top) return base;

  const topLink = await getTaskLink(db, top.id);
  if (topLink?.planeProjectId) {
    const slug = topLink.planeWorkspaceSlug || defaultWorkspace;
    return `${base}/${slug}/projects/${topLink.planeProjectId}/issues`;
  }
  return base;
}
