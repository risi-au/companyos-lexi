/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq, inArray } from "drizzle-orm";
import {
  grants,
  moduleInstances,
  principals,
  taskLinks,
  tokens,
  workbenches,
  type Scope,
} from "@companyos/db";
import { emitEvent, type DB } from "../../kernel/events";
import { grantRole, requireAccess } from "../../kernel/grants";
import { createScope, getChildren, getScope } from "../../kernel/scopes";
import { issueToken } from "../../kernel/tokens";
import { ScopeNotFoundError } from "../../errors";
import { PlaneClient } from "../tasks/plane-client";
import { setProjectWorkspace } from "../tasks/service";
import { applyManagedSection, renderManagedSection } from "./agents-md";
import { GitHubClient, OrgNotFoundError } from "../../lib/github-client";

export type ProvisionStepStatus = "created" | "existing" | "skipped" | "manual";

export interface ProvisionStep {
  key: string;
  status: ProvisionStepStatus;
  message: string;
  data?: Record<string, unknown>;
}

export interface ProvisionSpec {
  scopePath: string;
  name?: string;
  subprojects?: { slug: string; name: string }[];
  modules?: string[];
  agent?: { name: string; tokenName?: string };
  planeWorkspaceSlug?: string;
  workbench?: { repo?: string };
}

export interface ProvisionResult {
  scopePath: string;
  topLevelScopePath: string;
  steps: ProvisionStep[];
  manual: string[];
  agentToken?: {
    principalId: string;
    tokenName: string;
    plaintext: string;
    storeNow: true;
    envVar: "COMPANYOS_TOKEN";
  };
}

export interface ProvisionDeps {
  plane: PlaneClient;
  github: GitHubClient | null;
}

function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || slug;
}

function normalizeScopePath(path: string): string {
  const normalized = path.trim().replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
  if (!normalized || normalized === "root") {
    throw new Error("scopePath must be a non-root scope path");
  }
  return normalized;
}

function addStep(steps: ProvisionStep[], step: ProvisionStep): void {
  steps.push(step);
}

function addManual(steps: ProvisionStep[], message: string, key = "manual"): void {
  addStep(steps, { key, status: "manual", message });
}

function isWebhookUnavailable(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /failed:\s*(404|405)\b/.test(msg) || /\b(404|405)\b/.test(msg);
}

async function getTopAuthPath(db: DB, scopePath: string): Promise<string> {
  const top = scopePath.split("/")[0]!;
  const existingTop = await getScope(db, top);
  return existingTop ? top : "root";
}

async function getRequiredScope(db: DB, scopePath: string): Promise<Scope> {
  const scope = await getScope(db, scopePath);
  if (!scope) throw new ScopeNotFoundError(scopePath);
  return scope;
}

async function getTaskLink(db: DB, scopeId: string): Promise<any | null> {
  const [row] = await db
    .select()
    .from(taskLinks)
    .where(eq(taskLinks.scopeId, scopeId))
    .limit(1);
  return row || null;
}

async function ensureScopePath(
  db: DB,
  scopePath: string,
  targetName: string | undefined,
  actorPrincipalId: string,
  steps: ProvisionStep[]
): Promise<Scope> {
  const segments = scopePath.split("/");
  let parentPath: string | null = null;
  let currentPath = "";
  let target: Scope | null = null;

  for (let i = 0; i < segments.length; i += 1) {
    const slug = segments[i]!;
    currentPath = currentPath ? `${currentPath}/${slug}` : slug;
    const existing = await getScope(db, currentPath);
    if (existing) {
      addStep(steps, {
        key: `scope:${currentPath}`,
        status: "existing",
        message: `Scope ${currentPath} already exists`,
        data: { scopeId: existing.id },
      });
      target = existing;
      parentPath = currentPath;
      continue;
    }

    const created = await createScope(db, {
      parentPath,
      slug,
      name: i === segments.length - 1 ? (targetName || titleCaseSlug(slug)) : titleCaseSlug(slug),
      type: i === 0 ? "project" : "subproject",
    }, actorPrincipalId);
    addStep(steps, {
      key: `scope:${currentPath}`,
      status: "created",
      message: `Created scope ${currentPath}`,
      data: { scopeId: created.id },
    });
    target = created;
    parentPath = currentPath;
  }

  if (!target) throw new ScopeNotFoundError(scopePath);
  return target;
}

async function ensureSubprojects(
  db: DB,
  target: Scope,
  subprojects: { slug: string; name: string }[],
  actorPrincipalId: string,
  steps: ProvisionStep[]
): Promise<Scope[]> {
  const ensured: Scope[] = [];
  for (const sub of subprojects) {
    const path = `${target.path}/${sub.slug}`;
    const existing = await getScope(db, path);
    if (existing) {
      addStep(steps, {
        key: `subproject:${path}`,
        status: "existing",
        message: `Subproject ${path} already exists`,
        data: { scopeId: existing.id },
      });
      ensured.push(existing);
      continue;
    }
    const created = await createScope(db, {
      parentPath: target.path,
      slug: sub.slug,
      name: sub.name,
      type: "subproject",
    }, actorPrincipalId);
    addStep(steps, {
      key: `subproject:${path}`,
      status: "created",
      message: `Created subproject ${path}`,
      data: { scopeId: created.id },
    });
    ensured.push(created);
  }
  return ensured;
}

async function ensureModules(db: DB, target: Scope, modules: string[], steps: ProvisionStep[]): Promise<void> {
  if (modules.length === 0) {
    addStep(steps, { key: "modules", status: "skipped", message: "No modules requested" });
    return;
  }

  const existingRows = modules.length
    ? await db
      .select()
      .from(moduleInstances)
      .where(and(eq(moduleInstances.scopeId, target.id), inArray(moduleInstances.moduleType, modules)))
    : [];
  const existing = new Set(existingRows.map((row: any) => row.moduleType));

  for (const moduleType of modules) {
    if (existing.has(moduleType)) {
      addStep(steps, {
        key: `module:${moduleType}`,
        status: "existing",
        message: `Module ${moduleType} already exists on ${target.path}`,
      });
      continue;
    }
    await db.insert(moduleInstances).values({
      scopeId: target.id,
      moduleType,
      config: {},
      position: 0,
    });
    addStep(steps, {
      key: `module:${moduleType}`,
      status: "created",
      message: `Created module ${moduleType} on ${target.path}`,
    });
  }
}

async function ensureAgent(
  db: DB,
  topLevelScopePath: string,
  agent: { name: string; tokenName?: string },
  actorPrincipalId: string,
  steps: ProvisionStep[]
): Promise<ProvisionResult["agentToken"] | undefined> {
  const [existingPrincipal] = await db
    .select()
    .from(principals)
    .where(and(eq(principals.name, agent.name), eq(principals.kind, "agent")))
    .limit(1);

  const principal = existingPrincipal || (await db
    .insert(principals)
    .values({ kind: "agent", name: agent.name, status: "active" })
    .returning())[0];

  addStep(steps, {
    key: "agent.principal",
    status: existingPrincipal ? "existing" : "created",
    message: `${existingPrincipal ? "Found" : "Created"} agent principal ${agent.name}`,
    data: { principalId: principal.id },
  });

  const topScope = await getRequiredScope(db, topLevelScopePath);
  const [existingGrant] = await db
    .select()
    .from(grants)
    .where(and(eq(grants.principalId, principal.id), eq(grants.scopeId, topScope.id)))
    .limit(1);
  if (existingGrant) {
    addStep(steps, {
      key: "agent.grant",
      status: "existing",
      message: `Agent principal already has a grant on ${topLevelScopePath}`,
      data: { role: existingGrant.role },
    });
  } else {
    await grantRole(db, { principalId: principal.id, scopePath: topLevelScopePath, role: "agent" }, actorPrincipalId);
    addStep(steps, {
      key: "agent.grant",
      status: "created",
      message: `Granted agent role on ${topLevelScopePath}`,
    });
  }

  const existingTokens = await db
    .select({ id: tokens.id })
    .from(tokens)
    .where(eq(tokens.principalId, principal.id))
    .limit(1);
  if (existingTokens.length > 0) {
    addStep(steps, {
      key: "agent.token",
      status: "existing",
      message: "Agent principal already has a token; plaintext is not available",
    });
    return undefined;
  }

  const tokenName = agent.tokenName || `${agent.name} token`;
  const plaintext = await issueToken(db, { principalId: principal.id, name: tokenName }, actorPrincipalId);
  addStep(steps, {
    key: "agent.token",
    status: "created",
    message: "Issued agent token; store it now because plaintext is returned once",
  });
  return {
    principalId: principal.id,
    tokenName,
    plaintext,
    storeNow: true,
    envVar: "COMPANYOS_TOKEN",
  };
}

async function ensurePlaneWorkspace(
  db: DB,
  plane: PlaneClient,
  target: Scope,
  topLevelScopePath: string,
  requestedSlug: string | undefined,
  actorPrincipalId: string,
  steps: ProvisionStep[]
): Promise<string | null> {
  const topScope = await getRequiredScope(db, topLevelScopePath);
  if (requestedSlug && target.path !== topLevelScopePath) {
    throw new Error("planeWorkspaceSlug can only be registered on a top-level project target");
  }

  const existing = await getTaskLink(db, topScope.id);
  if (requestedSlug) {
    if (existing?.planeWorkspaceSlug === requestedSlug) {
      addStep(steps, {
        key: "plane.workspace",
        status: "existing",
        message: `Plane workspace ${requestedSlug} already registered`,
      });
      return requestedSlug;
    }
    await setProjectWorkspace(db, plane, { scopePath: topLevelScopePath, workspaceSlug: requestedSlug }, actorPrincipalId);
    addStep(steps, {
      key: "plane.workspace",
      status: "created",
      message: `Registered Plane workspace ${requestedSlug}`,
    });
    return requestedSlug;
  }

  if (existing?.planeWorkspaceSlug) {
    addStep(steps, {
      key: "plane.workspace",
      status: "existing",
      message: `Plane workspace ${existing.planeWorkspaceSlug} already registered`,
    });
    return existing.planeWorkspaceSlug;
  }

  addManual(steps, "create a Plane workspace in the UI, then re-run with planeWorkspaceSlug", "plane.workspace");
  return null;
}

async function ensurePlaneWebhook(
  plane: PlaneClient,
  workspaceSlug: string | null,
  steps: ProvisionStep[]
): Promise<void> {
  if (!workspaceSlug) {
    addStep(steps, { key: "plane.webhook", status: "skipped", message: "No Plane workspace registered" });
    return;
  }

  const url = process.env.PLANE_WEBHOOK_URL;
  if (!url) {
    addStep(steps, { key: "plane.webhook", status: "skipped", message: "PLANE_WEBHOOK_URL is not set" });
    return;
  }

  const secret = process.env.PLANE_WEBHOOK_SECRET;
  if (!secret) {
    addManual(steps, `set PLANE_WEBHOOK_SECRET and register webhook ${url} in Plane workspace settings`, "plane.webhook");
    return;
  }

  const workspacePlane = plane.forWorkspace(workspaceSlug);
  try {
    const hooks = await workspacePlane.listWebhooks();
    const existing = hooks.find((hook: any) => hook.url === url || hook.webhook_url === url || hook.endpoint === url);
    if (existing) {
      addStep(steps, {
        key: "plane.webhook",
        status: "existing",
        message: `Plane webhook ${url} already registered`,
      });
      return;
    }
    await workspacePlane.createWebhook({ url, secret });
    addStep(steps, {
      key: "plane.webhook",
      status: "created",
      message: `Registered Plane webhook ${url}`,
    });
  } catch (error) {
    if (isWebhookUnavailable(error)) {
      addManual(steps, `register webhook ${url} in Plane workspace settings`, "plane.webhook");
      return;
    }
    addManual(steps, `register webhook ${url} in Plane workspace settings (${error instanceof Error ? error.message : String(error)})`, "plane.webhook");
  }
}

function workbenchPathFor(scopePath: string): string {
  const segments = scopePath.split("/");
  return segments.slice(1).join("/");
}

function agentsPathFor(scopePath: string): string {
  const path = workbenchPathFor(scopePath);
  return path ? `${path}/AGENTS.md` : "AGENTS.md";
}

async function upsertWorkbench(
  db: DB,
  scope: Scope,
  repo: string,
  path: string,
  steps: ProvisionStep[]
): Promise<void> {
  const [existing] = await db
    .select()
    .from(workbenches)
    .where(eq(workbenches.scopeId, scope.id))
    .limit(1);
  if (existing) {
    if (existing.repo === repo && existing.path === path) {
      addStep(steps, {
        key: `workbench:${scope.path}`,
        status: "existing",
        message: `Workbench row already exists for ${scope.path}`,
      });
      return;
    }
    await db
      .update(workbenches)
      .set({ repo, path, updatedAt: new Date() })
      .where(eq(workbenches.id, existing.id));
    addStep(steps, {
      key: `workbench:${scope.path}`,
      status: "created",
      message: `Updated workbench row for ${scope.path}`,
    });
    return;
  }

  await db.insert(workbenches).values({ scopeId: scope.id, repo, path });
  addStep(steps, {
    key: `workbench:${scope.path}`,
    status: "created",
    message: `Created workbench row for ${scope.path}`,
  });
}

async function syncAgentsFile(
  db: DB,
  github: GitHubClient,
  repo: string,
  scope: Scope,
  steps: ProvisionStep[]
): Promise<void> {
  const path = agentsPathFor(scope.path);
  const children = await getChildren(db, scope.path);
  const section = renderManagedSection({ scope, children });
  const existing = await github.getFile(repo, path);
  const next = applyManagedSection(existing?.contentUtf8 ?? null, section);
  const write = await github.putFile(repo, path, next, "companyos: sync managed AGENTS.md");
  addStep(steps, {
    key: `github.file:${path}`,
    status: write.written ? "created" : "existing",
    message: `${write.written ? "Synced" : "Already current"} ${path}`,
  });
}

export async function provisionScope(
  db: DB,
  deps: ProvisionDeps,
  spec: ProvisionSpec,
  actorPrincipalId: string
): Promise<ProvisionResult> {
  const scopePath = normalizeScopePath(spec.scopePath);
  const topLevelScopePath = scopePath.split("/")[0]!;
  const authPath = await getTopAuthPath(db, scopePath);
  await requireAccess(db, actorPrincipalId, authPath, "admin");
  if (spec.planeWorkspaceSlug && scopePath !== topLevelScopePath) {
    throw new Error("planeWorkspaceSlug can only be registered on a top-level project target");
  }

  const steps: ProvisionStep[] = [];
  const target = await ensureScopePath(db, scopePath, spec.name, actorPrincipalId, steps);
  const subprojectScopes = await ensureSubprojects(db, target, spec.subprojects || [], actorPrincipalId, steps);
  await ensureModules(db, target, spec.modules || [], steps);

  const agentToken = spec.agent
    ? await ensureAgent(db, topLevelScopePath, spec.agent, actorPrincipalId, steps)
    : undefined;
  if (!spec.agent) {
    addStep(steps, { key: "agent", status: "skipped", message: "No agent requested" });
  }

  const workspaceSlug = await ensurePlaneWorkspace(
    db,
    deps.plane,
    target,
    topLevelScopePath,
    spec.planeWorkspaceSlug,
    actorPrincipalId,
    steps
  );
  await ensurePlaneWebhook(deps.plane, workspaceSlug, steps);

  if (spec.workbench) {
    const workbenchRepo = spec.workbench.repo || topLevelScopePath;
    await ensureWorkbenchWithRepo(db, deps.github, target, subprojectScopes, workbenchRepo, steps);
  } else {
    addStep(steps, { key: "workbench", status: "skipped", message: "No workbench requested" });
  }

  const manual = steps.filter((step) => step.status === "manual").map((step) => step.message);
  await emitEvent(db, {
    type: "provisioning.scope_provisioned",
    scopePath: target.path,
    principalId: actorPrincipalId,
    payload: {
      spec: { ...spec, agent: spec.agent ? { ...spec.agent, tokenName: spec.agent.tokenName || null } : undefined },
      steps: steps.map((step) => ({
        key: step.key,
        status: step.status,
        message: step.message,
        data: step.data || {},
      })),
      manual,
    },
  });

  return {
    scopePath: target.path,
    topLevelScopePath,
    steps,
    manual,
    ...(agentToken ? { agentToken } : {}),
  };
}

async function ensureWorkbenchWithRepo(
  db: DB,
  github: GitHubClient | null,
  target: Scope,
  subprojectScopes: Scope[],
  repo: string,
  steps: ProvisionStep[]
): Promise<void> {
  const topLevelScopePath = target.path.split("/")[0]!;
  const topScope = await getRequiredScope(db, topLevelScopePath);

  if (!github) {
    addManual(steps, "configure GITHUB_TOKEN and GITHUB_ORG, then re-run to create the GitHub repo and AGENTS.md files", "github");
    return;
  }

  try {
    const existingRepo = await github.getRepo(repo);
    if (existingRepo) {
      addStep(steps, { key: "github.repo", status: "existing", message: `GitHub repo ${repo} already exists` });
    } else {
      await github.createRepo(repo, { private: true });
      addStep(steps, { key: "github.repo", status: "created", message: `Created private GitHub repo ${repo}` });
    }
  } catch (error) {
    if (error instanceof OrgNotFoundError) {
      addManual(steps, `create GitHub org ${error.org} manually`, "github.org");
      return;
    }
    throw error;
  }

  const rowScopes = [target, ...subprojectScopes];
  for (const scope of rowScopes) {
    await upsertWorkbench(db, scope, repo, workbenchPathFor(scope.path), steps);
  }

  const syncScopes = new Map<string, Scope>();
  syncScopes.set(topScope.path, topScope);
  for (const scope of rowScopes) syncScopes.set(scope.path, scope);
  for (const scope of syncScopes.values()) {
    await syncAgentsFile(db, github, repo, scope, steps);
  }
}
