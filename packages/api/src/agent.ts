import {
  getScope,
  getChildren,
  listModules,
  listRecords,
  emitEvent,
  requireAccess,
  type DB,
} from "./index";
import { ScopeNotFoundError } from "./errors";
import { skillsContextSection } from "./modules/skills/service";
import { grants, scopes, workbenches } from "@companyos/db";
import { eq, inArray } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";

/* eslint-disable @typescript-eslint/no-explicit-any */

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

export interface ContextBundleConfig {
  mcpPublicUrl?: string | null;
}

interface WorkbenchCandidate {
  scopePath: string;
  repo: string;
  path: string;
}

function ancestorPaths(scopePath: string): string[] {
  const parts = scopePath.split("/").filter(Boolean);
  return parts.map((_, idx) => parts.slice(0, parts.length - idx).join("/"));
}

function joinWorkbenchPath(basePath: string, relativePath: string): string {
  return [basePath, relativePath].filter(Boolean).join("/");
}

export async function findNearestWorkbench(db: DB, scopePath: string) {
  const candidates = ancestorPaths(scopePath);
  if (!candidates.length) return null;

  const rows: WorkbenchCandidate[] = await db
    .select({
      scopePath: scopes.path,
      repo: workbenches.repo,
      path: workbenches.path,
    })
    .from(scopes)
    .innerJoin(workbenches, eq(workbenches.scopeId, scopes.id))
    .where(inArray(scopes.path, candidates));

  for (const candidate of candidates) {
    const row = rows.find((r: WorkbenchCandidate) => r.scopePath === candidate);
    if (row) {
      const relative = scopePath === candidate ? "" : scopePath.slice(candidate.length + 1);
      return {
        repo: row.repo,
        path: joinWorkbenchPath(row.path || "", relative),
      };
    }
  }

  return null;
}

export interface VerifyWorkbenchInput {
  cwd: string;
  scopePath?: string | null;
}

export interface VerifyWorkbenchResult {
  ok: boolean;
  expectedRepo?: string;
  expectedPath?: string;
  message?: string;
  note?: string;
}

function normalizePathSegments(pathValue: string): string[] {
  return pathValue
    .replace(/^[A-Za-z]:[\\/]/, "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
}

function endsWithPathSegments(cwd: string, expectedPath: string): boolean {
  const cwdSegments = normalizePathSegments(cwd);
  const expectedSegments = normalizePathSegments(expectedPath);
  if (expectedSegments.length === 0) return true;
  if (cwdSegments.length < expectedSegments.length) return false;

  const offset = cwdSegments.length - expectedSegments.length;
  return expectedSegments.every((segment, idx) => cwdSegments[offset + idx] === segment);
}

async function resolveVerifyWorkbenchScope(
  db: DB,
  scopePath: string | null | undefined,
  actorPrincipalId: string
): Promise<string> {
  if (scopePath) {
    await requireAccess(db, actorPrincipalId, scopePath, "viewer");
    return scopePath;
  }

  const grantScopes = await db
    .select({ scopePath: scopes.path })
    .from(grants)
    .innerJoin(scopes, eq(grants.scopeId, scopes.id))
    .where(eq(grants.principalId, actorPrincipalId))
    .orderBy(scopes.path);

  if (grantScopes.length === 0) {
    throw new Error("no scope grant found for this principal");
  }
  if (grantScopes.length > 1) {
    throw new Error("multiple scope grants found for this principal; pass an explicit scopePath");
  }

  const onlyGrant = grantScopes[0];
  if (!onlyGrant) {
    throw new Error("no scope grant found for this principal");
  }
  return onlyGrant.scopePath;
}

export async function verifyWorkbench(
  db: DB,
  input: VerifyWorkbenchInput,
  actorPrincipalId: string
): Promise<VerifyWorkbenchResult> {
  const scopePath = await resolveVerifyWorkbenchScope(db, input.scopePath, actorPrincipalId);
  const workbench = await findNearestWorkbench(db, scopePath);
  if (!workbench) {
    return { ok: true, note: "no workbench registered" };
  }

  if (endsWithPathSegments(input.cwd, workbench.path)) {
    return { ok: true };
  }

  const expected = [workbench.repo, workbench.path].filter(Boolean).join("/");
  return {
    ok: false,
    expectedRepo: workbench.repo,
    expectedPath: workbench.path,
    message: `cwd does not match expected workbench ${expected} for scope ${scopePath}`,
  };
}

/**
 * Returns the same markdown context bundle as MCP get_context tool.
 * Requires viewer on the scope.
 */
export async function getContextBundle(
  db: DB,
  scopePath: string,
  actorPrincipalId: string,
  config: ContextBundleConfig = {}
): Promise<string> {
  const sc = await getScope(db, scopePath);
  if (!sc) {
    throw new ScopeNotFoundError(scopePath);
  }

  // Access checked downstream
  const mods = await listModules(db, scopePath, actorPrincipalId);
  const children = await getChildren(db, scopePath);
  const childPaths = children.map((c: any) => c.path).join("\n");

  const recentCh = await listRecords(db, { scopePath, kind: "changelog", limit: 10 }, actorPrincipalId);
  const recentDec = await listRecords(db, { scopePath, kind: "decision", limit: 10 }, actorPrincipalId);
  const combined = [...recentCh, ...recentDec]
    .sort((a: any, b: any) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0))
    .slice(0, 10);

  let recordsMd = "";
  for (const r of combined) {
    const bodyStart = (r.bodyMd || "").slice(0, 200).replace(/\n/g, " ");
    const date = formatDate(r.createdAt);
    recordsMd += `- [${r.kind}] ${r.title} (${date})\n  ${bodyStart}${ (r.bodyMd || "").length > 200 ? "..." : "" }\n`;
  }
  if (!recordsMd) recordsMd = "(no recent changelog/decision records)\n";
  const skillsMd = await skillsContextSection(db, scopePath);
  const workbench = await findNearestWorkbench(db, scopePath);

  const moduleList = mods.length
    ? mods.map((m: any) => `- ${m.moduleType}`).join("\n")
    : "(none attached)";
  const workbenchMd = workbench
    ? `
**Workbench**
Repo: ${workbench.repo} · Folder: ${workbench.path || "."} · Clone the repo and work inside this folder.
${config.mcpPublicUrl ? `MCP URL: ${config.mcpPublicUrl}\n` : ""}`
    : "";

  const md = `# Context for ${scopePath}

**Identity**
- name: ${sc.name}
- path: ${sc.path}
- type: ${sc.type}
- status: ${sc.status}

**Modules**
${moduleList}

**Children**
${childPaths || "(none)"}
${workbenchMd}

**Recent changelog/decision records (last 10)**
${recordsMd}
Use list_records / get_record for full history and other kinds.

${skillsMd}
`;

  return md;
}

export interface ReportCapabilityRunInput {
  scopePath?: string | null;
  capability: string;
  status?: string;
  summary?: string;
  runId?: string;
  durationMs?: number;
  [key: string]: unknown;
}

/**
 * Legacy event-only capability run reporter.
 * The capabilities module persists registered runs; this remains the
 * compatibility fallback for unregistered or scope-less reporters.
 */
export async function reportCapabilityRun(
  db: DB,
  input: ReportCapabilityRunInput,
  actorPrincipalId: string
): Promise<void> {
  const { scopePath, capability, ...rest } = input;
  const payload = {
    capability,
    ...rest,
    reportedAt: new Date().toISOString(),
  };

  await emitEvent(db, {
    type: "capability.run_reported",
    scopePath: scopePath || null,
    principalId: actorPrincipalId,
    payload,
  });
}

/**
 * Verifies Plane X-Plane-Signature using raw body text (per current docs/examples).
 */
export function verifyPlaneWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
