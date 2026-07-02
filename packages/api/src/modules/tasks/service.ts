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

  const topScope = await getScope(db, topPath);
  const topScopeId = topScope?.id ?? null;

  // find or create project link for top
  let topLink: TaskLink | null = null;
  if (topScopeId) {
    const [topRow] = (await db
      .select()
      .from(taskLinks)
      .where(eq(taskLinks.scopeId, topScopeId))
      .limit(1)) as any[];
    if (topRow) {
      topLink = topRow as TaskLink;
    }
  }

  let projectId = "";
  if (topLink) {
    projectId = topLink.planeProjectId;
  } else {
    // create project lazily in Plane; adopt an existing project on name
    // conflict (409) — happens when task_links is missing but Plane has it
    const projName = topScope?.name || topPath;
    let proj;
    try {
      proj = await plane.createProject(projName, topPath.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) || "TASK");
    } catch {
      const existing = await plane.getProjects();
      const list = Array.isArray(existing) ? existing : (existing as any)?.results || [];
      proj = list.find((pr: any) => pr.name === projName);
      if (!proj) throw new Error(`Plane project create failed and no existing project named ${projName}`);
    }
    projectId = proj.id || proj.uuid || proj.project_id || (typeof proj === "string" ? proj : "");
    if (!projectId) {
      // fallback if response shape different
      projectId = (proj as any).id || (proj as any).results?.[0]?.id || "";
    }
    if (!projectId) throw new Error("Failed to obtain plane project id");

    // store link for the top scope (project only)
    const topScopeRow = topScope;
    if (topScopeRow) {
      await db.insert(taskLinks).values({
        scopeId: topScopeRow.id,
        planeProjectId: projectId,
        planeLabelId: null,
      });
      await emitEvent(db, {
        type: "tasks.target_provisioned",
        scopePath: topPath,
        payload: { planeProjectId: projectId, kind: "project" },
      });
    }
  }
  if (!projectId) throw new Error("Failed to resolve plane project id for target");

  // now ensure label for the *exact* scopePath
  const scopeRow = scope;
  const labelName = `scope:${scopePath}`;

  // check if we have a stored link for this exact scope
  const [existing] = (await db
    .select()
    .from(taskLinks)
    .where(eq(taskLinks.scopeId, scopeRow.id))
    .limit(1)) as any[];

  if (existing && existing.planeLabelId) {
    // idempotent: already have label for this scope
    return { projectId, labelId: existing.planeLabelId };
  }

  // ensure label exists in plane project (list + find or create)
  const labels = await plane.listLabels(projectId);
  let label = labels.find((l: any) => (l.name || l.title) === labelName);
  if (!label) {
    label = await plane.createLabel(projectId, labelName, "#0ea5e9");
  }
  const labelId = label.id || label.uuid || (label as any).label_id;

  if (!labelId) throw new Error("Failed to obtain plane label id");

  // upsert/store the link for this scope (project + label)
  if (existing) {
    await db
      .update(taskLinks)
      .set({ planeProjectId: projectId, planeLabelId: labelId })
      .where(eq(taskLinks.id, existing.id));
  } else {
    await db.insert(taskLinks).values({
      scopeId: scopeRow.id,
      planeProjectId: projectId,
      planeLabelId: labelId,
    });
  }

  await emitEvent(db, {
    type: "tasks.target_provisioned",
    scopePath,
    payload: { planeProjectId: projectId, planeLabelId: labelId, kind: "scope" },
  });

  return { projectId, labelId };
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
  const created = await plane.createIssue(target.projectId, issueData);

  const issueId = created.id || created.uuid || created.work_item_id;
  const sequenceId = created.sequence_id || created.sequenceId || created.id;
  // construct a usable url; Plane responses may vary
  const base = (plane as any).config?.baseUrl || "";
  const ws = (plane as any).config?.workspaceSlug || "";
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

  // fetch states and pick completed group
  const states = await plane.getStates(target.projectId);
  let doneState = states.find((s: any) => (s.group || s.state_group) === "completed");
  if (!doneState && states.length) {
    // fallback to last state or name containing done/complete
    doneState = states.find((s: any) => /done|complete|closed|finished/i.test(s.name || "")) || states[states.length - 1];
  }
  const stateId = doneState?.id || doneState?.uuid;

  await plane.updateIssue(target.projectId, issueId, stateId ? { state: stateId } : {});

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

  const patch: any = {};
  if (title !== undefined) patch.name = title;
  if (description !== undefined) patch.description_html = `<p>${description.replace(/</g, "&lt;")}</p>`;
  if (state !== undefined) patch.state = state;
  if (priority !== undefined) patch.priority = priority;
  if (dueDate !== undefined) patch.target_date = dueDate;

  await plane.updateIssue(target.projectId, issueId, patch);

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

  const filters: any = {};
  if (target.labelId) filters.label = target.labelId;

  if (state === "completed") filters.state_group = "completed";
  else if (state === "open") {
    // open = not completed; many impls filter by excluding or use state_group != 
    // for simplicity pass no filter or use a non-completed; mock will handle
  }

  let issues = await plane.listIssues(target.projectId, filters);

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
