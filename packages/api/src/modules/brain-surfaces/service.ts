import { and, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import {
  capabilities,
  capabilityRuns,
  docLinks,
  documents,
  scopes,
  workbenches,
  type CapabilityRun,
} from "@companyos/db";
import { type DB } from "../../kernel/events";
import { requireAccess } from "../../kernel/grants";
import { getScope } from "../../kernel/scopes";
import { ScopeNotFoundError } from "../../errors";
import { queryUsage, type UsageSummaryRow } from "../usage/service";

const ROOT_SCOPE = "root";
const BRAIN_CAPABILITY_NAME = "brain-engine";
const DEFAULT_NODE_LIMIT = 1200;
const MAX_NODE_LIMIT = 3000;
const DEFAULT_EDGE_LIMIT = 4000;
const MAX_EDGE_LIMIT = 8000;
const WIKILINK_REGEX = /\[\[([^\]\n|]+)(?:\|[^\]\n]+)?\]\]/g;

export type BrainGraphNodeType = "scope" | "wiki-page" | "root-pattern" | "workbench" | "unresolved";
export type BrainGraphEdgeType = "wikilink" | "source-record" | "scope-hierarchy" | "workbench";
export type BrainRunModeForTrigger = "ingest" | "lint" | "backfill";

export interface BrainGraphNode {
  id: string;
  type: BrainGraphNodeType;
  title: string;
  scopePath: string;
  href: string;
  slug?: string;
  status?: string;
  flagged: boolean;
  unresolved?: boolean;
}

export interface BrainGraphEdge {
  id: string;
  type: BrainGraphEdgeType;
  source: string;
  target: string;
  label?: string;
  resolved: boolean;
}

export interface BrainGraphResult {
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
  meta: {
    totalNodes: number;
    totalEdges: number;
    returnedNodes: number;
    returnedEdges: number;
    nodeLimit: number;
    edgeLimit: number;
    truncated: boolean;
  };
}

export interface BrainEngineRunSummary {
  id: string;
  status: string;
  mode: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  summary: string | null;
  pagesTouched: number;
  recordsDistilled: number;
  tokens: number;
  partial: boolean;
}

export interface BrainLintFindingSummary {
  id: string;
  scopePath: string;
  pageSlug: string;
  pageTitle: string;
  severity: "info" | "warning" | "critical";
  message: string;
  href: string;
  updatedAt: Date;
}

export interface BrainEngineOpsResult {
  runs: BrainEngineRunSummary[];
  lintFindings: BrainLintFindingSummary[];
  spend: {
    estimated: true;
    since: Date;
    rows: UsageSummaryRow[];
    totalTokensEst: number;
    actualCostUsd: number;
  };
}

function clampInt(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(1, Math.trunc(value as number)), max);
}

function subtreeCondition(scopePath: string) {
  return scopePath === ROOT_SCOPE
    ? like(scopes.path, "%")
    : or(eq(scopes.path, scopePath), like(scopes.path, `${scopePath}/%`));
}

function isRootPattern(scopePath: string, slug: string): boolean {
  return scopePath === ROOT_SCOPE && (slug === "critical-facts" || slug.startsWith("pattern-"));
}

function docHref(scopePath: string, slug: string): string {
  return `/s/${scopePath}?tab=docs&doc=${encodeURIComponent(slug)}`;
}

function scopeHref(scopePath: string): string {
  return `/s/${scopePath}`;
}

function workbenchHref(scopePath: string): string {
  return `/s/${scopePath}?tab=overview`;
}

function parseLintSlugs(bodyMd: string): string[] {
  const slugs = new Set<string>();
  for (const match of bodyMd.matchAll(WIKILINK_REGEX)) {
    const raw = (match[1] ?? "").trim();
    if (!raw) continue;
    const slug = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw;
    if (slug) slugs.add(slug);
  }
  return Array.from(slugs);
}

async function requireRootAdmin(db: DB, actorPrincipalId: string): Promise<void> {
  const root = await getScope(db, ROOT_SCOPE);
  if (!root) throw new ScopeNotFoundError(ROOT_SCOPE);
  await requireAccess(db, actorPrincipalId, ROOT_SCOPE, "admin");
}

async function lintFlagKeys(db: DB): Promise<Set<string>> {
  const rows = (await db
    .select({
      scopePath: scopes.path,
      bodyMd: documents.bodyMd,
    })
    .from(documents)
    .innerJoin(scopes, eq(documents.scopeId, scopes.id))
    .where(and(like(documents.slug, "lint-report%"), isNull(documents.archivedAt)))) as Array<{
      scopePath: string;
      bodyMd: string;
    }>;

  const keys = new Set<string>();
  for (const row of rows) {
    for (const slug of parseLintSlugs(row.bodyMd || "")) {
      keys.add(`${row.scopePath}:${slug}`);
    }
  }
  return keys;
}

export async function getBrainGraph(
  db: DB,
  input: { nodeLimit?: number; edgeLimit?: number } = {},
  actorPrincipalId: string
): Promise<BrainGraphResult> {
  await requireRootAdmin(db, actorPrincipalId);
  const nodeLimit = clampInt(input.nodeLimit, DEFAULT_NODE_LIMIT, MAX_NODE_LIMIT);
  const edgeLimit = clampInt(input.edgeLimit, DEFAULT_EDGE_LIMIT, MAX_EDGE_LIMIT);
  const flagged = await lintFlagKeys(db);

  const scopeRows = (await db
    .select({
      id: scopes.id,
      parentId: scopes.parentId,
      path: scopes.path,
      name: scopes.name,
      type: scopes.type,
      status: scopes.status,
    })
    .from(scopes)
    .orderBy(scopes.path)) as Array<{
      id: string;
      parentId: string | null;
      path: string;
      name: string;
      type: string;
      status: string;
    }>;

  const docRows = (await db
    .select({
      id: documents.id,
      slug: documents.slug,
      title: documents.title,
      scopePath: scopes.path,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .innerJoin(scopes, eq(documents.scopeId, scopes.id))
    .where(and(subtreeCondition(ROOT_SCOPE), isNull(documents.archivedAt)))
    .orderBy(scopes.path, documents.slug)
    .limit(nodeLimit)) as Array<{
      id: string;
      slug: string;
      title: string;
      scopePath: string;
      updatedAt: Date;
    }>;

  const workbenchRows = (await db
    .select({
      id: workbenches.id,
      repo: workbenches.repo,
      path: workbenches.path,
      scopePath: scopes.path,
    })
    .from(workbenches)
    .innerJoin(scopes, eq(workbenches.scopeId, scopes.id))
    .orderBy(scopes.path)
    .limit(nodeLimit)) as Array<{ id: string; repo: string; path: string; scopePath: string }>;

  const nodes = new Map<string, BrainGraphNode>();
  const scopeNodeIdByScopeId = new Map<string, string>();
  const docNodeIdByDocId = new Map<string, string>();

  for (const scope of scopeRows) {
    const id = `scope:${scope.id}`;
    scopeNodeIdByScopeId.set(scope.id, id);
    nodes.set(id, {
      id,
      type: "scope",
      title: scope.name,
      scopePath: scope.path,
      href: scopeHref(scope.path),
      status: scope.status,
      flagged: false,
    });
  }

  for (const doc of docRows) {
    const id = `doc:${doc.id}`;
    docNodeIdByDocId.set(doc.id, id);
    const type: BrainGraphNodeType = isRootPattern(doc.scopePath, doc.slug) ? "root-pattern" : "wiki-page";
    nodes.set(id, {
      id,
      type,
      title: doc.title,
      scopePath: doc.scopePath,
      slug: doc.slug,
      href: docHref(doc.scopePath, doc.slug),
      flagged: flagged.has(`${doc.scopePath}:${doc.slug}`),
    });
  }

  for (const workbench of workbenchRows) {
    const id = `workbench:${workbench.id}`;
    nodes.set(id, {
      id,
      type: "workbench",
      title: workbench.path ? `${workbench.repo}/${workbench.path}` : workbench.repo,
      scopePath: workbench.scopePath,
      href: workbenchHref(workbench.scopePath),
      flagged: false,
    });
  }

  const edges: BrainGraphEdge[] = [];
  for (const scope of scopeRows) {
    if (!scope.parentId) continue;
    const source = scopeNodeIdByScopeId.get(scope.parentId);
    const target = scopeNodeIdByScopeId.get(scope.id);
    if (!source || !target) continue;
    edges.push({
      id: `scope-hierarchy:${scope.parentId}:${scope.id}`,
      type: "scope-hierarchy",
      source,
      target,
      label: "contains",
      resolved: true,
    });
  }

  for (const workbench of workbenchRows) {
    const [scope] = scopeRows.filter((row) => row.path === workbench.scopePath);
    const source = scope ? scopeNodeIdByScopeId.get(scope.id) : undefined;
    if (!source) continue;
    edges.push({
      id: `workbench:${workbench.id}`,
      type: "workbench",
      source,
      target: `workbench:${workbench.id}`,
      label: "workbench",
      resolved: true,
    });
  }

  const docIds = docRows.map((doc) => doc.id);
  if (docIds.length > 0) {
    const linkRows = (await db
      .select({
        fromDocumentId: docLinks.fromDocumentId,
        toDocumentId: docLinks.toDocumentId,
        toSlug: docLinks.toSlug,
        toScopePath: scopes.path,
      })
      .from(docLinks)
      .innerJoin(scopes, eq(docLinks.toScopeId, scopes.id))
      .where(inArray(docLinks.fromDocumentId, docIds))
      .orderBy(docLinks.fromDocumentId, scopes.path, docLinks.toSlug)
      .limit(edgeLimit)) as Array<{
        fromDocumentId: string;
        toDocumentId: string | null;
        toSlug: string;
        toScopePath: string;
      }>;

    for (const link of linkRows) {
      const source = docNodeIdByDocId.get(link.fromDocumentId);
      if (!source) continue;
      let target = link.toDocumentId ? docNodeIdByDocId.get(link.toDocumentId) : undefined;
      if (!target) {
        target = `unresolved:${link.toScopePath}:${link.toSlug}`;
        if (!nodes.has(target)) {
          nodes.set(target, {
            id: target,
            type: "unresolved",
            title: link.toSlug,
            scopePath: link.toScopePath,
            slug: link.toSlug,
            href: docHref(link.toScopePath, link.toSlug),
            flagged: false,
            unresolved: true,
          });
        }
      }
      edges.push({
        id: `wikilink:${link.fromDocumentId}:${link.toScopePath}:${link.toSlug}`,
        type: "wikilink",
        source,
        target,
        label: link.toSlug,
        resolved: link.toDocumentId !== null,
      });
    }
  }

  const allNodes = Array.from(nodes.values());
  const returnedNodes = allNodes.slice(0, nodeLimit);
  const returnedNodeIds = new Set(returnedNodes.map((node) => node.id));
  const returnedEdges = edges
    .filter((edge) => returnedNodeIds.has(edge.source) && returnedNodeIds.has(edge.target))
    .slice(0, edgeLimit);

  return {
    nodes: returnedNodes,
    edges: returnedEdges,
    meta: {
      totalNodes: allNodes.length,
      totalEdges: edges.length,
      returnedNodes: returnedNodes.length,
      returnedEdges: returnedEdges.length,
      nodeLimit,
      edgeLimit,
      truncated: allNodes.length > returnedNodes.length || edges.length > returnedEdges.length,
    },
  };
}

function numericPayload(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function runToSummary(run: CapabilityRun): BrainEngineRunSummary {
  const payload = (run.payload || {}) as Record<string, unknown>;
  return {
    id: run.id,
    status: run.status,
    mode: typeof payload.mode === "string" ? payload.mode : null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    summary: run.summary,
    pagesTouched: numericPayload(payload, "pagesTouched"),
    recordsDistilled: numericPayload(payload, "recordsDistilled"),
    tokens: numericPayload(payload, "tokens"),
    partial: payload.partial === true,
  };
}

function severityFromLine(line: string): "info" | "warning" | "critical" {
  if (/critical/i.test(line)) return "critical";
  if (/warning/i.test(line)) return "warning";
  return "info";
}

async function lintFindings(db: DB): Promise<BrainLintFindingSummary[]> {
  const reports = (await db
    .select({
      id: documents.id,
      slug: documents.slug,
      title: documents.title,
      bodyMd: documents.bodyMd,
      updatedAt: documents.updatedAt,
      scopePath: scopes.path,
    })
    .from(documents)
    .innerJoin(scopes, eq(documents.scopeId, scopes.id))
    .where(and(like(documents.slug, "lint-report%"), isNull(documents.archivedAt)))
    .orderBy(desc(documents.updatedAt))
    .limit(50)) as Array<{
      id: string;
      slug: string;
      title: string;
      bodyMd: string;
      updatedAt: Date;
      scopePath: string;
    }>;

  const findings: BrainLintFindingSummary[] = [];
  for (const report of reports) {
    const lines = (report.bodyMd || "").split(/\r?\n/).filter((line) => line.trim().startsWith("- "));
    for (const line of lines) {
      const slugs = parseLintSlugs(line);
      const pageSlug = slugs[0] ?? report.slug;
      findings.push({
        id: `${report.id}:${findings.length}`,
        scopePath: report.scopePath,
        pageSlug,
        pageTitle: pageSlug === report.slug ? report.title : pageSlug,
        severity: severityFromLine(line),
        message: line.replace(/^-+\s*/, "").trim(),
        href: docHref(report.scopePath, pageSlug),
        updatedAt: report.updatedAt,
      });
    }
  }
  return findings.slice(0, 100);
}

export async function getBrainEngineOps(
  db: DB,
  input: { since?: Date | string | null; limit?: number } = {},
  actorPrincipalId: string
): Promise<BrainEngineOpsResult> {
  await requireRootAdmin(db, actorPrincipalId);
  const root = await getScope(db, ROOT_SCOPE);
  if (!root) throw new ScopeNotFoundError(ROOT_SCOPE);
  const limit = clampInt(input.limit, 50, 200);
  const since = input.since ? new Date(input.since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [capability] = (await db
    .select({ id: capabilities.id })
    .from(capabilities)
    .where(and(eq(capabilities.scopeId, root.id), eq(capabilities.name, BRAIN_CAPABILITY_NAME)))
    .limit(1)) as Array<{ id: string }>;

  const runRows = capability
    ? (await db
      .select()
      .from(capabilityRuns)
      .where(eq(capabilityRuns.capabilityId, capability.id))
      .orderBy(desc(capabilityRuns.startedAt))
      .limit(limit)) as CapabilityRun[]
    : [];

  const spend = await queryUsage(
    db,
    { scope: ROOT_SCOPE, since, operation: "brain.llm", groupBy: "operation", limit: 500 },
    actorPrincipalId
  );
  const totalTokensEst = spend.rows.reduce((sum, row) => sum + row.totalTokensEst, 0);
  const actualCostUsd = spend.events.reduce((sum, event) => sum + Number(event.actualCostUsd ?? 0), 0);

  return {
    runs: runRows.map(runToSummary),
    lintFindings: await lintFindings(db),
    spend: {
      estimated: true,
      since,
      rows: spend.rows,
      totalTokensEst,
      actualCostUsd,
    },
  };
}

export async function assertBrainManualTriggerAllowed(
  db: DB,
  input: { mode: BrainRunModeForTrigger },
  actorPrincipalId: string
): Promise<{ ok: true; mode: BrainRunModeForTrigger }> {
  await requireRootAdmin(db, actorPrincipalId);
  if (!["ingest", "lint", "backfill"].includes(input.mode)) {
    throw new Error("mode must be ingest, lint, or backfill");
  }
  return { ok: true, mode: input.mode };
}
