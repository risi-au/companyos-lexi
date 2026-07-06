/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHmac, timingSafeEqual } from "crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  agentSessions,
  events,
  principals,
  records,
  scopes,
  workbenches,
  type Record as DbRecord,
} from "@companyos/db";
import { emitEvent, type DB } from "../../kernel/events";
import { createSystemRecord } from "../records/service";

const GITHUB_WEBHOOK_AUTH_USER_ID = "system:github-webhook";
const GITHUB_NEEDS_SUMMARY_MARKER = "Needs human/agent summary";
const RECENT_WRAPUP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface ResolveWorkbenchInput {
  repoFullName: string;
  changedPaths: string[];
}

export interface ResolvedWorkbenchGroup {
  scopePath: string;
  workbenchPath: string;
  changedPaths: string[];
}

export interface HandleGitHubWebhookInput {
  event: string;
  deliveryId: string;
  payload: any;
}

export interface HandleGitHubWebhookResult {
  ok: true;
  ignored?: boolean;
  duplicate?: boolean;
  groups?: Array<{ scopePath: string; eventType: string; recordId?: string | null }>;
}

interface WorkbenchRow {
  scopeId: string;
  scopePath: string;
  repo: string;
  path: string;
}

interface NormalizedGitHubEvent {
  kind: "push" | "pr_opened" | "pr_updated" | "pr_merged";
  eventType: "workbench.push" | "workbench.pr_opened" | "workbench.pr_updated" | "workbench.pr_merged";
  repoFullName: string;
  branch: string | null;
  defaultBranch: string | null;
  changedPaths: string[];
  before?: string | null;
  after?: string | null;
  commitShas: string[];
  compareUrl?: string | null;
  authorLogin?: string | null;
  pr?: {
    number: number | null;
    title: string;
    url: string | null;
    merged: boolean;
    mergeCommitSha?: string | null;
  };
}

function normalizeRepo(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function repoShortName(repoFullName: string): string {
  const parts = repoFullName.split("/");
  return parts[parts.length - 1] || repoFullName;
}

function repoMatches(stored: string, repoFullName: string): boolean {
  const storedRepo = normalizeRepo(stored);
  const full = normalizeRepo(repoFullName);
  return storedRepo === full || storedRepo === normalizeRepo(repoShortName(repoFullName));
}

function normalizePath(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\/+/g, "/");
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
  if (!prefix) return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizePath(value);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function branchFromRef(ref: string | null | undefined): string | null {
  const value = String(ref || "");
  if (value.startsWith("refs/heads/")) return value.slice("refs/heads/".length);
  return value || null;
}

function collectPushPaths(payload: any): string[] {
  const paths: string[] = [];
  for (const commit of Array.isArray(payload?.commits) ? payload.commits : []) {
    paths.push(...(commit.added || []), ...(commit.modified || []), ...(commit.removed || []));
  }
  if (payload?.head_commit) {
    paths.push(
      ...(payload.head_commit.added || []),
      ...(payload.head_commit.modified || []),
      ...(payload.head_commit.removed || [])
    );
  }
  return uniqueStrings(paths);
}

function collectPullRequestPaths(payload: any): string[] {
  const pr = payload?.pull_request || {};
  const paths: string[] = [];
  const arrays = [
    payload?.changed_paths,
    payload?.changedPaths,
    payload?.files,
    pr?.changed_paths,
    pr?.changedPaths,
    pr?.files,
  ];
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (typeof item === "string") {
        paths.push(item);
      } else {
        paths.push(item?.filename, item?.previous_filename);
      }
    }
  }
  return uniqueStrings(paths);
}

function normalizeGitHubPayload(event: string, payload: any): NormalizedGitHubEvent | null {
  const repoFullName = payload?.repository?.full_name || payload?.repository?.name || "";
  if (!repoFullName) return null;

  if (event === "push") {
    const branch = branchFromRef(payload?.ref);
    const commitShas = Array.isArray(payload?.commits)
      ? payload.commits.map((commit: any) => String(commit?.id || "")).filter(Boolean)
      : [];
    return {
      kind: "push",
      eventType: "workbench.push",
      repoFullName,
      branch,
      defaultBranch: payload?.repository?.default_branch || null,
      changedPaths: collectPushPaths(payload),
      before: payload?.before || null,
      after: payload?.after || payload?.head_commit?.id || null,
      commitShas,
      compareUrl: payload?.compare || null,
      authorLogin: payload?.sender?.login || payload?.pusher?.name || null,
    };
  }

  if (event !== "pull_request") return null;
  const action = String(payload?.action || "");
  const pr = payload?.pull_request || {};
  const merged = action === "closed" && pr?.merged === true;
  let kind: NormalizedGitHubEvent["kind"] | null = null;
  let eventType: NormalizedGitHubEvent["eventType"] | null = null;
  if (action === "opened" || action === "reopened") {
    kind = "pr_opened";
    eventType = "workbench.pr_opened";
  } else if (action === "synchronize" || action === "edited") {
    kind = "pr_updated";
    eventType = "workbench.pr_updated";
  } else if (merged) {
    kind = "pr_merged";
    eventType = "workbench.pr_merged";
  }
  if (!kind || !eventType) return null;

  const headSha = pr?.head?.sha || null;
  const mergeCommitSha = pr?.merge_commit_sha || null;
  return {
    kind,
    eventType,
    repoFullName,
    branch: pr?.head?.ref || null,
    defaultBranch: payload?.repository?.default_branch || pr?.base?.ref || null,
    changedPaths: collectPullRequestPaths(payload),
    before: pr?.base?.sha || null,
    after: mergeCommitSha || headSha,
    commitShas: [headSha, mergeCommitSha].filter(Boolean),
    authorLogin: payload?.sender?.login || pr?.user?.login || null,
    pr: {
      number: typeof pr?.number === "number" ? pr.number : typeof payload?.number === "number" ? payload.number : null,
      title: String(pr?.title || `PR #${payload?.number || ""}`).trim(),
      url: pr?.html_url || null,
      merged,
      mergeCommitSha,
    },
  };
}

export function verifyGitHubWebhookSignature(rawBody: string, signatureHeader: string | null | undefined, secret: string): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const received = signatureHeader.trim();
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export async function resolveWorkbenchScopes(db: DB, input: ResolveWorkbenchInput): Promise<ResolvedWorkbenchGroup[]> {
  const changedPaths = uniqueStrings(input.changedPaths.length ? input.changedPaths : [""]);
  const allRows = (await db
    .select({
      scopeId: scopes.id,
      scopePath: scopes.path,
      repo: workbenches.repo,
      path: workbenches.path,
    })
    .from(workbenches)
    .innerJoin(scopes, eq(workbenches.scopeId, scopes.id))) as WorkbenchRow[];

  const rows = allRows
    .filter((row) => repoMatches(row.repo, input.repoFullName))
    .map((row) => ({ ...row, path: normalizePath(row.path) }))
    .sort((a, b) => b.path.length - a.path.length);

  const grouped = new Map<string, ResolvedWorkbenchGroup>();
  for (const changedPath of changedPaths) {
    const path = normalizePath(changedPath);
    const match = rows.find((row) => pathMatchesPrefix(path, row.path));
    if (!match) continue;
    const existing = grouped.get(match.scopePath) || {
      scopePath: match.scopePath,
      workbenchPath: match.path,
      changedPaths: [],
    };
    existing.changedPaths.push(path);
    grouped.set(match.scopePath, existing);
  }

  return Array.from(grouped.values());
}

async function hasProcessedDelivery(db: DB, deliveryId: string): Promise<boolean> {
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(sql`${events.payload}->>'deliveryId' = ${deliveryId}`)
    .limit(1);
  return rows.length > 0;
}

async function ensureGithubWebhookPrincipal(db: DB): Promise<string> {
  const [existing] = await db
    .select({ id: principals.id })
    .from(principals)
    .where(eq(principals.authUserId, GITHUB_WEBHOOK_AUTH_USER_ID))
    .limit(1);
  if (existing?.id) return existing.id;

  const [created] = await db
    .insert(principals)
    .values({
      kind: "agent",
      name: "CompanyOS GitHub Webhook",
      authUserId: GITHUB_WEBHOOK_AUTH_USER_ID,
      status: "active",
    })
    .returning({ id: principals.id });
  if (!created?.id) throw new Error("Failed to create GitHub webhook principal");

  await emitEvent(db, {
    type: "principal.created_external",
    scopePath: null,
    principalId: created.id,
    payload: { source: "github", authUserId: GITHUB_WEBHOOK_AUTH_USER_ID },
  });
  return created.id;
}

async function scopeIdForPath(db: DB, scopePath: string): Promise<string> {
  const [scope] = await db
    .select({ id: scopes.id })
    .from(scopes)
    .where(eq(scopes.path, scopePath))
    .limit(1);
  if (!scope?.id) throw new Error(`Scope not found: ${scopePath}`);
  return scope.id;
}

function identifierNeedles(normalized: NormalizedGitHubEvent): string[] {
  const values = [
    normalized.pr?.url,
    normalized.pr?.number ? `#${normalized.pr.number}` : null,
    normalized.pr?.number ? `pr ${normalized.pr.number}` : null,
    normalized.after,
    ...normalized.commitShas,
  ].filter(Boolean) as string[];
  return values.map((value) => String(value).toLowerCase());
}

async function hasRecentRecordReference(
  db: DB,
  scopePath: string,
  normalized: NormalizedGitHubEvent
): Promise<boolean> {
  const needles = identifierNeedles(normalized);
  if (needles.length === 0) return false;
  const scopeId = await scopeIdForPath(db, scopePath);
  const since = new Date(Date.now() - RECENT_WRAPUP_WINDOW_MS);
  const rows = (await db
    .select()
    .from(records)
    .where(and(eq(records.scopeId, scopeId), eq(records.kind, "changelog"), gte(records.createdAt, since)))
    .orderBy(desc(records.createdAt))
    .limit(50)) as DbRecord[];

  return rows.some((record) => {
    const haystack = `${record.title}\n${record.bodyMd}\n${JSON.stringify(record.data || {})}`.toLowerCase();
    return needles.some((needle) => needle && haystack.includes(needle));
  });
}

async function hasRecentSessionReference(db: DB, scopePath: string, normalized: NormalizedGitHubEvent): Promise<boolean> {
  const needles = identifierNeedles(normalized);
  if (needles.length === 0) return false;
  const since = new Date(Date.now() - RECENT_WRAPUP_WINDOW_MS);
  const [scope] = await db.select({ id: scopes.id }).from(scopes).where(eq(scopes.path, scopePath)).limit(1);
  if (!scope?.id) return false;
  const rows = await db
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.type, "session.completed"), eq(events.scopeId, scope.id), gte(events.createdAt, since)))
    .orderBy(desc(events.createdAt))
    .limit(50);
  return rows.some((event: any) => {
    const haystack = JSON.stringify(event.payload || {}).toLowerCase();
    return needles.some((needle) => needle && haystack.includes(needle));
  });
}

async function linkRecentSessions(db: DB, scopePath: string, branch: string | null, authorLogin: string | null): Promise<string[]> {
  const [scope] = await db.select({ id: scopes.id }).from(scopes).where(eq(scopes.path, scopePath)).limit(1);
  if (!scope?.id) return [];
  const since = new Date(Date.now() - RECENT_WRAPUP_WINDOW_MS);
  const rows = await db
    .select({
      id: agentSessions.id,
      worktreeRef: agentSessions.worktreeRef,
      updatedAt: agentSessions.updatedAt,
    })
    .from(agentSessions)
    .where(and(eq(agentSessions.scopeId, scope.id), gte(agentSessions.updatedAt, since)))
    .orderBy(desc(agentSessions.updatedAt))
    .limit(20);

  const branchNeedle = String(branch || "").toLowerCase();
  const authorNeedle = String(authorLogin || "").toLowerCase();
  const matched = rows.filter((row: any) => {
    const ref = String(row.worktreeRef || "").toLowerCase();
    return (branchNeedle && (ref.includes(branchNeedle) || branchNeedle.includes(ref))) ||
      (authorNeedle && ref.includes(authorNeedle));
  });
  return matched.map((row: any) => row.id);
}

function eventPayload(
  normalized: NormalizedGitHubEvent,
  group: ResolvedWorkbenchGroup,
  deliveryId: string,
  linkedSessionIds: string[]
): Record<string, unknown> {
  return {
    source: "github",
    repo: normalized.repoFullName,
    branch: normalized.branch,
    defaultBranch: normalized.defaultBranch,
    before: normalized.before || null,
    after: normalized.after || null,
    commitShas: normalized.commitShas,
    compareUrl: normalized.compareUrl || null,
    prNumber: normalized.pr?.number ?? null,
    prUrl: normalized.pr?.url ?? null,
    prTitle: normalized.pr?.title ?? null,
    authorLogin: normalized.authorLogin || null,
    changedPathSamples: group.changedPaths.slice(0, 20),
    changedPathCount: group.changedPaths.length,
    resolvedScopePath: group.scopePath,
    workbenchPath: group.workbenchPath,
    deliveryId,
    linkedSessionIds,
  };
}

function changelogBody(normalized: NormalizedGitHubEvent, group: ResolvedWorkbenchGroup): string {
  const lines = [
    GITHUB_NEEDS_SUMMARY_MARKER,
    "",
    `Detected scope: \`${group.scopePath}\``,
    `Repository: \`${normalized.repoFullName}\``,
  ];
  if (normalized.branch) lines.push(`Branch: \`${normalized.branch}\``);
  if (normalized.pr?.url) lines.push(`PR: [#${normalized.pr.number ?? ""} ${normalized.pr.title}](${normalized.pr.url})`);
  if (normalized.compareUrl) lines.push(`Compare: ${normalized.compareUrl}`);
  if (normalized.after) lines.push(`After: \`${normalized.after}\``);
  if (normalized.before) lines.push(`Before: \`${normalized.before}\``);
  if (group.changedPaths.length) {
    lines.push("", "Changed path sample:");
    for (const path of group.changedPaths.slice(0, 20)) {
      lines.push(`- \`${path || "."}\``);
    }
  }
  lines.push("", "No recent agent-authored wrap-up was found for this PR or commit range.");
  return lines.join("\n");
}

async function createGithubChangelogStub(
  db: DB,
  normalized: NormalizedGitHubEvent,
  group: ResolvedWorkbenchGroup,
  deliveryId: string,
  githubPrincipalId: string
): Promise<DbRecord> {
  const title = normalized.kind === "push"
    ? `GitHub push: ${normalized.branch || "unknown branch"}`
    : `GitHub merge: ${normalized.pr?.title || "Untitled PR"}`;
  const data = {
    source: "github",
    needsSummary: true,
    deliveryId,
    repo: normalized.repoFullName,
    branch: normalized.branch,
    prNumber: normalized.pr?.number ?? null,
    prUrl: normalized.pr?.url ?? null,
    commitShas: normalized.commitShas,
    before: normalized.before || null,
    after: normalized.after || null,
    changedPathSamples: group.changedPaths.slice(0, 20),
    resolvedScopePath: group.scopePath,
  };

  return createSystemRecord(
    db,
    {
      scopePath: group.scopePath,
      kind: "changelog",
      title,
      bodyMd: changelogBody(normalized, group),
      data,
    },
    githubPrincipalId
  );
}

async function maybeCreateStub(
  db: DB,
  normalized: NormalizedGitHubEvent,
  group: ResolvedWorkbenchGroup,
  deliveryId: string,
  githubPrincipalId: string
): Promise<string | null> {
  const shouldCreate =
    normalized.kind === "pr_merged" ||
    (normalized.kind === "push" && !!normalized.branch && normalized.branch === normalized.defaultBranch);
  if (!shouldCreate) return null;

  const hasRecord = await hasRecentRecordReference(db, group.scopePath, normalized);
  if (hasRecord) return null;
  const hasSession = await hasRecentSessionReference(db, group.scopePath, normalized);
  if (hasSession) return null;

  const created = await createGithubChangelogStub(db, normalized, group, deliveryId, githubPrincipalId);
  return created.id;
}

export async function handleGitHubWebhook(db: DB, input: HandleGitHubWebhookInput): Promise<HandleGitHubWebhookResult> {
  const deliveryId = input.deliveryId.trim();
  if (!deliveryId) throw new Error("GitHub delivery id is required");

  if (input.event === "ping") {
    return { ok: true };
  }
  if (input.event !== "push" && input.event !== "pull_request") {
    return { ok: true, ignored: true };
  }
  if (await hasProcessedDelivery(db, deliveryId)) {
    return { ok: true, duplicate: true };
  }

  const normalized = normalizeGitHubPayload(input.event, input.payload);
  if (!normalized) {
    return { ok: true, ignored: true };
  }

  const groups = await resolveWorkbenchScopes(db, {
    repoFullName: normalized.repoFullName,
    changedPaths: normalized.changedPaths,
  });
  if (groups.length === 0) {
    return { ok: true, ignored: true };
  }

  const githubPrincipalId = await ensureGithubWebhookPrincipal(db);
  const resultGroups: HandleGitHubWebhookResult["groups"] = [];

  for (const group of groups) {
    const linkedSessionIds = await linkRecentSessions(db, group.scopePath, normalized.branch, normalized.authorLogin || null);
    const recordId = await maybeCreateStub(db, normalized, group, deliveryId, githubPrincipalId);
    await emitEvent(db, {
      type: normalized.eventType,
      scopePath: group.scopePath,
      principalId: githubPrincipalId,
      payload: eventPayload(normalized, group, deliveryId, linkedSessionIds),
    });
    resultGroups.push({ scopePath: group.scopePath, eventType: normalized.eventType, recordId });
  }

  return { ok: true, groups: resultGroups };
}

export { GITHUB_NEEDS_SUMMARY_MARKER };
