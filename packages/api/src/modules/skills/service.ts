import { eq } from "drizzle-orm";
import { principals, scopes, skillsIndex, type SkillIndexRow } from "@companyos/db";
import { emitEvent, type DB } from "../../kernel/events";
import { requireAccess } from "../../kernel/grants";
import { getScope } from "../../kernel/scopes";
import { ScopeNotFoundError, SkillNotFoundError } from "../../errors";
import type { GitHubClient } from "../../lib/github-client";
import { matchesScope } from "./match";

const SKILL_NAME_RE = /^[a-z0-9-]+$/;

export interface SyncSkillsOptions {
  repo: string;
}

export interface SkippedSkillFile {
  path: string;
  reason: string;
}

export interface SyncSkillsResult {
  repo: string;
  added: number;
  updated: number;
  removed: number;
  skipped: SkippedSkillFile[];
}

export interface ListSkillsInput {
  scope: string;
  domain?: string;
}

export type ListedSkill = Pick<
  SkillIndexRow,
  "name" | "description" | "domains" | "scopePattern" | "path" | "syncedAt"
>;

interface ParsedFrontmatter {
  name?: string;
  description?: string;
  scope_pattern?: string;
  domains?: string[];
}

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map(parseScalar).filter(Boolean);
}

function parseFrontmatter(body: string): ParsedFrontmatter {
  if (!body.startsWith("---")) return {};
  const lines = body.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex === -1) return {};

  const result: ParsedFrontmatter = {};
  for (let i = 1; i < endIndex; i += 1) {
    const line = lines[i] || "";
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    const rawValue = match[2] || "";
    if (key === "domains") {
      if (rawValue.trim().startsWith("[")) {
        result.domains = parseInlineList(rawValue);
        continue;
      }
      const domains: string[] = [];
      while (i + 1 < endIndex) {
        const next = lines[i + 1] || "";
        const item = /^\s*-\s*(.+?)\s*$/.exec(next);
        if (!item) break;
        domains.push(parseScalar(item[1]!));
        i += 1;
      }
      result.domains = domains.filter(Boolean);
      continue;
    }
    if (key === "name" || key === "description" || key === "scope_pattern") {
      result[key] = parseScalar(rawValue);
    }
  }
  return result;
}

function domainsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function skillChanged(existing: SkillIndexRow, next: Omit<SkillIndexRow, "id" | "createdAt" | "updatedAt" | "syncedAt">): boolean {
  return existing.name !== next.name ||
    existing.scopePattern !== next.scopePattern ||
    !domainsEqual(existing.domains, next.domains) ||
    existing.path !== next.path ||
    existing.description !== next.description ||
    existing.body !== next.body ||
    existing.sha !== next.sha;
}

async function getRootScope(db: DB) {
  const [root] = await db.select().from(scopes).where(eq(scopes.type, "root")).limit(1);
  if (!root) {
    throw new Error("Root scope not found: sync_skills requires a scope with type = 'root'");
  }
  return root;
}

async function requirePrincipal(db: DB, actorPrincipalId: string): Promise<void> {
  const [principal] = await db
    .select({ id: principals.id })
    .from(principals)
    .where(eq(principals.id, actorPrincipalId))
    .limit(1);
  if (!principal) {
    throw new Error(`Principal not found: ${actorPrincipalId}`);
  }
}

async function getRequiredScope(db: DB, scopePath: string) {
  const scope = await getScope(db, scopePath);
  if (!scope) throw new ScopeNotFoundError(scopePath);
  return scope;
}

export async function syncSkills(
  db: DB,
  client: GitHubClient,
  opts: SyncSkillsOptions,
  actorPrincipalId: string
): Promise<SyncSkillsResult> {
  const root = await getRootScope(db);
  await requireAccess(db, actorPrincipalId, root.path, "admin");

  const files = await client.listFiles(opts.repo);
  const skillFiles = files.filter((file) => file.path.split("/").pop() === "SKILL.md");
  const now = new Date();
  const existingRows = (await db.select().from(skillsIndex)) as SkillIndexRow[];
  const existingByName = new Map(existingRows.map((row) => [row.name, row]));
  const seenNames = new Set<string>();
  const skipped: SkippedSkillFile[] = [];
  let added = 0;
  let updated = 0;

  for (const file of skillFiles) {
    const fetched = await client.getFile(opts.repo, file.path);
    if (!fetched) {
      skipped.push({ path: file.path, reason: "file not found" });
      continue;
    }
    const meta = parseFrontmatter(fetched.contentUtf8);
    const name = meta.name?.trim();
    if (!name || !SKILL_NAME_RE.test(name)) {
      skipped.push({ path: file.path, reason: "missing or invalid name" });
      continue;
    }

    const next = {
      name,
      scopePattern: meta.scope_pattern?.trim() || "**",
      domains: meta.domains || [],
      path: file.path,
      description: meta.description?.trim() || null,
      body: fetched.contentUtf8,
      sha: file.sha || fetched.sha || null,
    };
    seenNames.add(name);
    const existing = existingByName.get(name);

    if (existing) {
      if (skillChanged(existing, next)) updated += 1;
      await db
        .update(skillsIndex)
        .set({
          scopePattern: next.scopePattern,
          domains: next.domains,
          path: next.path,
          description: next.description,
          body: next.body,
          sha: next.sha,
          syncedAt: now,
          updatedAt: now,
        })
        .where(eq(skillsIndex.id, existing.id));
    } else {
      await db.insert(skillsIndex).values({
        name: next.name,
        scopePattern: next.scopePattern,
        domains: next.domains,
        path: next.path,
        description: next.description,
        body: next.body,
        sha: next.sha,
        syncedAt: now,
      });
      added += 1;
    }
  }

  let removed = 0;
  for (const row of existingRows) {
    if (!seenNames.has(row.name)) {
      await db.delete(skillsIndex).where(eq(skillsIndex.id, row.id));
      removed += 1;
    }
  }

  const result: SyncSkillsResult = { repo: opts.repo, added, updated, removed, skipped };
  await emitEvent(db, {
    type: "skills.synced",
    scopePath: root.path,
    principalId: actorPrincipalId,
    payload: { ...result },
  });

  return result;
}

export async function listSkills(
  db: DB,
  input: ListSkillsInput,
  actorPrincipalId: string
): Promise<ListedSkill[]> {
  await getRequiredScope(db, input.scope);
  await requireAccess(db, actorPrincipalId, input.scope, "viewer");

  const rows = (await db.select().from(skillsIndex).orderBy(skillsIndex.name)) as SkillIndexRow[];
  return rows
    .filter((row) => matchesScope(row.scopePattern, input.scope))
    .filter((row) => !input.domain || row.domains.includes(input.domain))
    .map((row) => ({
      name: row.name,
      description: row.description,
      domains: row.domains,
      scopePattern: row.scopePattern,
      path: row.path,
      syncedAt: row.syncedAt,
    }));
}

export async function getSkill(
  db: DB,
  input: { name: string },
  actorPrincipalId: string
): Promise<SkillIndexRow> {
  await requirePrincipal(db, actorPrincipalId);
  const [row] = (await db
    .select()
    .from(skillsIndex)
    .where(eq(skillsIndex.name, input.name))
    .limit(1)) as SkillIndexRow[];
  if (!row) throw new SkillNotFoundError(input.name);
  return row;
}

export async function skillsContextSection(db: DB, scope: string): Promise<string> {
  const rows = (await db.select().from(skillsIndex).orderBy(skillsIndex.name)) as SkillIndexRow[];
  if (rows.length === 0) {
    return `**Skills**
(no skills synced)
Use get_skill(name) to fetch full skill playbooks.
`;
  }

  const matching = rows.filter((row) => matchesScope(row.scopePattern, scope));
  if (matching.length === 0) {
    return `**Skills**
(no matching skills for this scope)
Use get_skill(name) to fetch full skill playbooks.
`;
  }

  const visible = matching.slice(0, 20);
  const lines = visible.map((row) => `- ${row.name} — ${row.description || "(no description)"}`);
  if (matching.length > visible.length) {
    lines.push(`(${matching.length - visible.length} more skills omitted)`);
  }
  lines.push("Use get_skill(name) to fetch full skill playbooks.");
  return `**Skills**
${lines.join("\n")}
`;
}
