import {
  findNearestWorkbench,
  getDoc,
  getScope,
  getSkill,
  getSubtree,
  listEvents,
  saveDoc,
  type DB,
} from "@companyos/api";
import {
  callLlm,
  iso,
  parseJsonObject,
  WIKI_MAINTENANCE_SKILL,
  type BrainDeps,
  type BrainRunMode,
  type EngineCounters,
} from "./engine";

export interface CodeDocsGitHubReader {
  listFiles(repo: string, options?: { ref?: string }): Promise<Array<{ path: string; sha: string }>>;
  getFile(repo: string, path: string): Promise<{ sha: string; contentUtf8: string } | null>;
}

export interface CodeDocsSummary {
  status: "bootstrapped" | "updated" | "no-op" | "opt-out" | "no-github";
  pagesTouched: number;
  lastCommit: string | null;
  truncated: boolean;
}

export const CODE_PAGES: Record<string, string> = {
  "code-architecture": "Code Architecture",
  "code-stack": "Code Stack",
  "code-integrations": "Code Integrations",
  "code-ops": "Code Ops",
};

const CODE_SLUGS = Object.keys(CODE_PAGES);
const MAX_FILES_PER_RUN = 10;
const MAX_CHARS_PER_FILE = 5_000;
const MAX_CHARS_TOTAL = 30_000;
const MAX_TREE_PATHS_IN_PROMPT = 400;
const MAX_DELTA_EVENTS = 500;
const PAGE_CONTRACT =
  "Maintain the stable code-* wiki topic pages update-in-place. Frontmatter must keep repo and " +
  "last_commit plus the bi-temporal fields. Sources cite commit SHAs and file paths (never record ids). " +
  "Distill - never copy file contents wholesale. Add wikilinks to the scope's business pages where relevant.";

interface ScopeIdInfo {
  id: string;
  path: string;
}

interface CodeDocsPageOutput {
  slug: string;
  title: string;
  bodyMd: string;
}

interface CodeDocsOutput {
  pages: CodeDocsPageOutput[];
}

// Priority-ordered authoritative inputs; lockfiles are cited by name but never read.
const AUTHORITATIVE_PATTERNS: RegExp[] = [
  /^readme[^/]*$/i,
  /^agents\.md$/i,
  /^[^/]+\/agents\.md$/i,
  /(^|\/)package\.json$/,
  /(^|\/)(pyproject\.toml|go\.mod|cargo\.toml|composer\.json|gemfile)$/i,
  /(^|\/)docker-compose[^/]*\.ya?ml$/i,
  /(^|\/)dockerfile[^/]*$/i,
  /^\.github\/workflows\/[^/]+\.ya?ml$/i,
  /(^|\/)tsconfig[^/]*\.json$/,
  /^(pnpm-workspace\.yaml|turbo\.json)$/,
  /^\.env\.example$/,
];

const LOCKFILE_RE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|poetry\.lock|go\.sum|cargo\.lock|composer\.lock|gemfile\.lock)$/i;

function isAuthoritative(path: string): boolean {
  return !LOCKFILE_RE.test(path) && AUTHORITATIVE_PATTERNS.some((re) => re.test(path));
}

function authoritativePriority(path: string): number {
  const index = AUTHORITATIVE_PATTERNS.findIndex((re) => re.test(path));
  return index === -1 ? AUTHORITATIVE_PATTERNS.length : index;
}

export function classifyChangedPath(path: string): string[] {
  const affected = new Set<string>();
  const lower = path.toLowerCase();
  if (/^\.github\/workflows\/|(^|\/)docker-compose|(^|\/)dockerfile|^infra\/|(^|\/)(deploy|terraform)\//.test(lower)) {
    affected.add("code-ops");
  }
  if (/(^|\/)package\.json$|(^|\/)(pyproject\.toml|go\.mod|cargo\.toml|composer\.json|gemfile)$|(^|\/)tsconfig[^/]*\.json$|^(pnpm-workspace\.yaml|turbo\.json)$/.test(lower) || LOCKFILE_RE.test(lower)) {
    affected.add("code-stack");
  }
  if (/integration|webhook|(^|\/)api\/|client|^\.env\.example$/.test(lower)) {
    affected.add("code-integrations");
  }
  if (affected.size === 0) affected.add("code-architecture");
  return Array.from(affected);
}

function stripOrg(repo: string): string {
  return repo.includes("/") ? repo.slice(repo.lastIndexOf("/") + 1) : repo;
}

function underWorkbenchPath(path: string, workbenchPath: string): boolean {
  const prefix = workbenchPath.replace(/^\/+|\/+$/g, "");
  if (!prefix) return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}

function frontmatterField(bodyMd: string, key: string): string | null {
  const match = /^---\s*([\s\S]*?)\s*---/.exec(bodyMd);
  if (!match) return null;
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const pair = new RegExp(`^${key}:\\s*(.+)$`).exec(line.trim());
    if (pair) return (pair[1] ?? "").replace(/^["']|["']$/g, "").trim();
  }
  return null;
}

function upsertFrontmatterField(frontmatter: string, key: string, value: string): string {
  const line = `${key}: "${value}"`;
  const re = new RegExp(`^${key}:.*$`, "m");
  return re.test(frontmatter) ? frontmatter.replace(re, line) : `${frontmatter}\n${line}`;
}

export function ensureCodePageBody(
  bodyMd: string,
  now: Date,
  repo: string,
  lastCommit: string,
  citedPaths: string[]
): string {
  const trimmed = bodyMd.trim();
  const match = /^---\s*\n([\s\S]*?)\n---\s*/.exec(trimmed);
  let frontmatter: string;
  let rest: string;
  if (match) {
    frontmatter = match[1] ?? "";
    rest = trimmed.slice(match[0].length).trim();
  } else {
    frontmatter = [`learned_at: "${iso(now)}"`, `verified_at: "${iso(now)}"`, "confidence: medium"].join("\n");
    rest = trimmed;
  }
  frontmatter = upsertFrontmatterField(frontmatter, "repo", repo);
  frontmatter = upsertFrontmatterField(frontmatter, "last_commit", lastCommit);
  if (!/^verified_at:/m.test(frontmatter)) frontmatter = upsertFrontmatterField(frontmatter, "verified_at", iso(now));
  if (!/^learned_at:/m.test(frontmatter)) frontmatter = upsertFrontmatterField(frontmatter, "learned_at", iso(now));

  let assembled = `---\n${frontmatter}\n---\n\n${rest}`;
  if (!/^## Sources/m.test(assembled)) {
    const cited = citedPaths.slice(0, 10).map((path) => `- extracted: commit:${lastCommit} ${path} (${iso(now)})`);
    assembled = `${assembled}\n\n## Sources\n\n${cited.length ? cited.join("\n") : `- extracted: commit:${lastCommit} (${iso(now)})`}`;
  }
  return assembled;
}

async function subtreeScopeIds(db: DB, scopePath: string): Promise<Map<string, string>> {
  const scopes = (await getSubtree(db, scopePath)) as ScopeIdInfo[];
  return new Map(scopes.map((scope) => [scope.id, scope.path]));
}

async function collectPushDelta(
  db: DB,
  scopePath: string,
  since: Date | undefined
): Promise<{ changedPaths: string[]; afterSha: string | null }> {
  const scopeIds = await subtreeScopeIds(db, scopePath);
  const events = await listEvents(db, { type: "workbench.push", since, limit: MAX_DELTA_EVENTS });
  const changedPaths = new Set<string>();
  let afterSha: string | null = null;
  // listEvents returns newest first; keep the newest SHA, collect all changed paths.
  for (const event of events) {
    if (!event.scopeId || !scopeIds.has(String(event.scopeId))) continue;
    const payload = (event.payload ?? {}) as { changedPathSamples?: unknown; after?: unknown };
    if (!afterSha && typeof payload.after === "string" && payload.after) afterSha = payload.after;
    if (Array.isArray(payload.changedPathSamples)) {
      for (const path of payload.changedPathSamples) {
        if (typeof path === "string" && path) changedPaths.add(path);
      }
    }
  }
  return { changedPaths: Array.from(changedPaths), afterSha };
}

async function readCappedFiles(
  github: CodeDocsGitHubReader,
  repo: string,
  paths: string[]
): Promise<{ files: Array<{ path: string; content: string }>; truncated: boolean }> {
  const prioritized = [...paths].sort((a, b) => authoritativePriority(a) - authoritativePriority(b));
  const kept = prioritized.slice(0, MAX_FILES_PER_RUN);
  let truncated = kept.length < paths.length;
  const files: Array<{ path: string; content: string }> = [];
  let totalChars = 0;
  for (const path of kept) {
    if (totalChars >= MAX_CHARS_TOTAL) {
      truncated = true;
      break;
    }
    let file: { contentUtf8: string } | null = null;
    try {
      file = await github.getFile(repo, path);
    } catch {
      continue;
    }
    if (!file) continue;
    let content = file.contentUtf8;
    if (content.length > MAX_CHARS_PER_FILE) {
      content = content.slice(0, MAX_CHARS_PER_FILE);
      truncated = true;
    }
    totalChars += content.length;
    files.push({ path, content });
  }
  return { files, truncated };
}

async function linkCodePagesFromIndex(
  db: DB,
  scopePath: string,
  touchedSlugs: string[],
  actorPrincipalId: string
): Promise<void> {
  if (touchedSlugs.length === 0) return;
  const index = await getDoc(db, { scopePath, slug: "wiki" }, actorPrincipalId);
  if (!index) return;
  const missing = touchedSlugs.filter((slug) => !index.bodyMd.includes(`[[${slug}]]`));
  if (missing.length === 0) return;
  const bodyMd = `${index.bodyMd.trim()}\n\n## Linked topic pages\n\n${missing.map((slug) => `- [[${slug}]]`).join("\n")}\n`;
  await saveDoc(db, { scopePath, slug: "wiki", title: index.title, bodyMd }, actorPrincipalId);
}

export async function runCodeDocsPass(
  db: DB,
  input: { scopePath: string; mode: BrainRunMode; since: Date | undefined },
  actorPrincipalId: string,
  deps: BrainDeps,
  counters: EngineCounters,
  runTokenCeiling: number,
  monthlyTokenBudget: number
): Promise<CodeDocsSummary | null> {
  if (input.mode === "lint") return null;
  const { scopePath } = input;

  const workbench = await findNearestWorkbench(db, scopePath);
  if (!workbench?.repo) return null;

  const scope = await getScope(db, scopePath);
  const settings = (scope?.settings ?? {}) as { brain?: { codeDocs?: unknown } };
  if (settings.brain?.codeDocs === false) {
    return { status: "opt-out", pagesTouched: 0, lastCommit: null, truncated: false };
  }
  if (!deps.github) {
    return { status: "no-github", pagesTouched: 0, lastCommit: null, truncated: false };
  }

  const now = deps.now ?? new Date();
  const existingPages = new Map<string, { title: string; bodyMd: string }>();
  for (const slug of CODE_SLUGS) {
    const doc = await getDoc(db, { scopePath, slug }, actorPrincipalId);
    if (doc) existingPages.set(slug, { title: doc.title, bodyMd: doc.bodyMd || "" });
  }

  const delta = await collectPushDelta(db, scopePath, input.since);
  const bootstrap = input.mode === "backfill" || existingPages.size < CODE_SLUGS.length;
  if (!bootstrap && delta.changedPaths.length === 0) {
    return { status: "no-op", pagesTouched: 0, lastCommit: null, truncated: false };
  }

  const repo = stripOrg(workbench.repo);
  const priorCommit = Array.from(existingPages.values())
    .map((page) => frontmatterField(page.bodyMd, "last_commit"))
    .find((sha) => sha && sha !== "HEAD") ?? null;
  const targetCommit = delta.afterSha ?? priorCommit ?? "HEAD";

  let treePaths: string[] = [];
  let readCandidates: string[];
  let affectedSlugs: string[];
  let treeTruncated = false;

  if (bootstrap) {
    const tree = await deps.github.listFiles(repo);
    treePaths = tree
      .map((entry) => entry.path)
      .filter((path) => underWorkbenchPath(path, workbench.path || ""));
    treeTruncated = treePaths.length > MAX_TREE_PATHS_IN_PROMPT;
    readCandidates = treePaths.filter(isAuthoritative);
    affectedSlugs = [...CODE_SLUGS];
  } else {
    readCandidates = delta.changedPaths.filter(isAuthoritative);
    affectedSlugs = Array.from(new Set(delta.changedPaths.flatMap(classifyChangedPath)));
  }

  const { files, truncated: filesTruncated } = await readCappedFiles(deps.github, repo, readCandidates);
  const truncated = treeTruncated || filesTruncated;

  const skill = await getSkill(db, { name: WIKI_MAINTENANCE_SKILL }, actorPrincipalId);
  const response = await callLlm(
    db,
    deps.llm,
    {
      role: "cheap",
      purpose: "code-docs",
      system: skill.body,
      prompt: JSON.stringify({
        scopePath,
        repo: workbench.repo,
        workbenchPath: workbench.path || "",
        pass: bootstrap ? "bootstrap" : "delta",
        pageContract: PAGE_CONTRACT,
        targetCommit,
        truncated,
        affectedSlugs,
        tree: bootstrap ? treePaths.slice(0, MAX_TREE_PATHS_IN_PROMPT) : undefined,
        changedPaths: bootstrap ? undefined : delta.changedPaths,
        files,
        currentPages: affectedSlugs
          .filter((slug) => existingPages.has(slug))
          .map((slug) => ({ slug, title: existingPages.get(slug)!.title, bodyMd: existingPages.get(slug)!.bodyMd.slice(0, 4000) })),
      }),
      maxTokens: Math.max(1, runTokenCeiling - counters.tokens),
    },
    actorPrincipalId,
    counters,
    runTokenCeiling,
    monthlyTokenBudget,
    scopePath
  );

  const output = parseJsonObject<CodeDocsOutput>(response.text, { pages: [] });
  const allowed = new Set(affectedSlugs.filter((slug) => CODE_SLUGS.includes(slug)));
  const citedPaths = files.length > 0 ? files.map((file) => file.path) : delta.changedPaths;
  let pagesTouched = 0;
  const touchedSlugs: string[] = [];
  for (const page of output.pages) {
    if (!allowed.has(page.slug)) continue;
    const finalBody = ensureCodePageBody(page.bodyMd, now, workbench.repo, targetCommit, citedPaths);
    const title = page.title || CODE_PAGES[page.slug]!;
    const existing = existingPages.get(page.slug);
    if (existing && existing.bodyMd === finalBody && existing.title === title) continue;
    await saveDoc(db, { scopePath, slug: page.slug, title, bodyMd: finalBody }, actorPrincipalId);
    pagesTouched += 1;
    touchedSlugs.push(page.slug);
  }
  await linkCodePagesFromIndex(db, scopePath, touchedSlugs, actorPrincipalId);
  counters.pagesTouched += pagesTouched;

  return {
    status: bootstrap ? "bootstrapped" : "updated",
    pagesTouched,
    lastCommit: targetCommit === "HEAD" ? null : targetCommit,
    truncated,
  };
}
