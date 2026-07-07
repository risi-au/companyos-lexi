import {
  archiveDoc,
  estimateTokens,
  findNearestWorkbench,
  getDoc,
  getSkill,
  getSubtree,
  listCapabilityRuns,
  listDocs,
  listEvents,
  listRecords,
  logUsageEventSafely,
  queryUsage,
  registerCapability,
  reportRun,
  saveDoc,
  search,
  type DB,
  type ListedRecord,
  type SearchHit,
} from "@companyos/api";
import { runCodeDocsPass, type CodeDocsGitHubReader, type CodeDocsSummary } from "./code-docs";

export const BRAIN_CAPABILITY_NAME = "brain-engine";
export const WIKI_MAINTENANCE_SKILL = "wiki-maintenance";

const ROOT_SCOPE = "root";
const DEFAULT_RUN_TOKEN_CEILING = 24_000;
const DEFAULT_MONTHLY_TOKEN_BUDGET = 1_000_000;
const MAX_RESPONSE_EXCERPT_CHARS = 2048;
const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g;
const JSON_ENVELOPE_INSTRUCTIONS: Record<BrainLlmRequest["purpose"], string> = {
  "scope-ingest": "Return only one JSON object: {\"pages\":[{\"slug\":\"kebab-slug\",\"title\":\"Title\",\"bodyMd\":\"markdown\"}],\"recordsDistilled\":0}. No prose, no markdown fence.",
  "root-distill": "Return only one JSON object: {\"pages\":[{\"slug\":\"critical-facts|scope-map|pattern-name\",\"title\":\"Title\",\"bodyMd\":\"markdown\"}]}. No prose, no markdown fence.",
  "lint-scope": "Return only one JSON object: {\"findings\":[{\"type\":\"contradiction\",\"severity\":\"warning\",\"message\":\"...\",\"slugs\":[\"slug\"],\"action\":\"flagged\"}]}. No prose, no markdown fence.",
  "code-docs": "Return only one JSON object: {\"pages\":[{\"slug\":\"code-architecture|code-stack|code-integrations|code-ops\",\"title\":\"Title\",\"bodyMd\":\"markdown\"}]}. No prose, no markdown fence.",
};

export type BrainRunMode = "ingest" | "lint" | "backfill";
export type BrainRoleAlias = "cheap" | "analysis";

export interface BrainLlmRequest {
  role: BrainRoleAlias;
  purpose: "scope-ingest" | "root-distill" | "lint-scope" | "code-docs";
  system: string;
  prompt: string;
  maxTokens: number;
}

export interface BrainLlmResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface BrainLlmClient {
  complete(request: BrainLlmRequest): Promise<BrainLlmResponse>;
}

export interface BrainRunInput {
  mode: BrainRunMode;
  scopePath?: string;
  runRef?: string;
  tokenCeiling?: number;
  monthlyTokenBudget?: number;
}

export interface BrainDeps {
  llm: BrainLlmClient;
  github?: CodeDocsGitHubReader | null;
  now?: Date;
}

export interface BrainRunResult {
  mode: BrainRunMode;
  status: "success" | "error";
  partial: boolean;
  pagesTouched: number;
  recordsDistilled: number;
  tokens: number;
  llmCalls: number;
  scopeRuns: ScopeRunSummary[];
  lintFindings: LintFinding[];
}

export interface ScopeRunSummary {
  scopePath: string;
  inputCount: number;
  pagesTouched: number;
  recordsDistilled: number;
  skipped?: "no-new-inputs" | "budget";
  codeDocs?: CodeDocsSummary;
  parseFailed?: boolean;
  parseFailureReason?: string;
  parseFailureExcerpt?: string;
  droppedNonReservedSlugs?: number;
}

export interface BrainEventInput {
  eventType: string;
  scopePath: string;
  runRef?: string;
  tokenCeiling?: number;
}

interface ScopeInfo {
  id: string;
  parentId: string | null;
  path: string;
  name: string;
  type: string;
}

interface DocSummary {
  id: string;
  slug: string;
  title: string;
  updatedAt: Date;
}

interface LoadedDoc extends DocSummary {
  bodyMd: string;
}

export interface EngineCounters {
  pagesTouched: number;
  recordsDistilled: number;
  tokens: number;
  llmCalls: number;
  partial: boolean;
  outputFailures: number;
}

interface SourceInput {
  kind: "record" | "event";
  id: string;
  title: string;
  bodyMd: string;
  scopePath: string;
  createdAt: Date;
}

interface IngestPageOutput {
  slug: string;
  title: string;
  bodyMd: string;
}

interface IngestOutput {
  pages: IngestPageOutput[];
  recordsDistilled?: number;
}

interface RootDistillOutput {
  pages: IngestPageOutput[];
}

interface ParseFailureFields {
  parseFailed: true;
  parseFailureReason: string;
  parseFailureExcerpt: string;
  droppedNonReservedSlugs?: number;
}

export interface LintFinding {
  type: "orphan" | "duplicate" | "contradiction" | "stale";
  severity: "info" | "warning";
  message: string;
  slugs: string[];
  action: "auto-fixed" | "flagged";
}

interface LintOutput {
  findings: LintFinding[];
}

interface LintScopeResult {
  findings: LintFinding[];
  parseFailure?: ParseFailureFields;
}

export interface LiteLlmBrainClientConfig {
  baseUrl: string;
  apiKey: string;
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

function usablePage(page: Partial<IngestPageOutput> | null | undefined): page is IngestPageOutput {
  return typeof page?.slug === "string" &&
    page.slug.trim().length > 0 &&
    typeof page.title === "string" &&
    page.title.trim().length > 0 &&
    typeof page.bodyMd === "string" &&
    page.bodyMd.trim().length > 0;
}

function usableFinding(finding: Partial<LintFinding> | null | undefined): finding is LintFinding {
  return finding?.type === "contradiction" &&
    typeof finding.message === "string" &&
    finding.message.trim().length > 0 &&
    Array.isArray(finding.slugs);
}

function outputFailure(
  counters: EngineCounters,
  reason: string,
  text: string,
  extra: { droppedNonReservedSlugs?: number } = {}
): ParseFailureFields {
  counters.outputFailures += 1;
  return {
    parseFailed: true,
    parseFailureReason: reason,
    parseFailureExcerpt: responseExcerpt(text),
    ...extra,
  };
}

export function iso(date: Date): string {
  return date.toISOString();
}

function runRef(input: BrainRunInput, now: Date): string {
  return input.runRef ?? `${input.mode}-${now.toISOString()}`;
}

function effectiveCeiling(input?: number): number {
  return Math.max(1, Math.trunc(input ?? DEFAULT_RUN_TOKEN_CEILING));
}

function effectiveMonthlyBudget(input?: number): number {
  return Math.max(1, Math.trunc(input ?? DEFAULT_MONTHLY_TOKEN_BUDGET));
}

export function parseJsonObject<T>(text: string, fallback: T): T {
  return parseJsonObjectResult(text, fallback).value;
}

export interface ParseJsonObjectResult<T> {
  ok: boolean;
  value: T;
  excerpt?: string;
  reason?: string;
}

export function responseExcerpt(text: string): string {
  return text.trim().slice(0, MAX_RESPONSE_EXCERPT_CHARS);
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (fenced?.[1]) return fenced[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return trimmed.slice(first, last + 1);
}

export function parseJsonObjectResult<T>(text: string, fallback: T): ParseJsonObjectResult<T> {
  const raw = extractJsonObject(text);
  if (!raw) {
    return { ok: false, value: fallback, excerpt: responseExcerpt(text), reason: text.trim() ? "no JSON object found" : "empty response" };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch (error) {
    return {
      ok: false,
      value: fallback,
      excerpt: responseExcerpt(text),
      reason: error instanceof Error ? error.message : "invalid JSON",
    };
  }
}

export function promptWithJsonEnvelope(purpose: BrainLlmRequest["purpose"], payload: Record<string, unknown>): string {
  return JSON.stringify({
    ...payload,
    outputFormatMandatory: JSON_ENVELOPE_INSTRUCTIONS[purpose],
  });
}

function countResponseTokens(request: BrainLlmRequest, response: BrainLlmResponse): number {
  if (typeof response.totalTokens === "number") return Math.max(0, Math.trunc(response.totalTokens));
  const inputTokens = response.inputTokens ?? estimateTokens(`${request.system}\n${request.prompt}`).tokens;
  const outputTokens = response.outputTokens ?? estimateTokens(response.text).tokens;
  return Math.max(0, Math.trunc(inputTokens + outputTokens));
}

export async function callLlm(
  db: DB,
  llm: BrainLlmClient,
  request: BrainLlmRequest,
  actorPrincipalId: string,
  counters: EngineCounters,
  runTokenCeiling: number,
  monthlyTokenBudget: number,
  scopePath: string
): Promise<BrainLlmResponse> {
  const estimatedInput = estimateTokens(`${request.system}\n${request.prompt}`).tokens;
  if (counters.tokens + estimatedInput > runTokenCeiling) {
    throw new BudgetExceededError("brain run token ceiling reached before LLM call");
  }
  await enforceMonthlyBudget(db, actorPrincipalId, monthlyTokenBudget, estimatedInput);

  const response = await llm.complete(request);
  const used = countResponseTokens(request, response);
  if (counters.tokens + used > runTokenCeiling) {
    counters.tokens = runTokenCeiling;
    counters.partial = true;
    throw new BudgetExceededError("brain run token ceiling reached after LLM call");
  }
  counters.tokens += used;
  counters.llmCalls += 1;
  await logUsageEventSafely(db, {
    scopePath,
    principalId: actorPrincipalId,
    source: "brain",
    model: request.role,
    operation: "brain.llm",
    inputTokensEst: response.inputTokens ?? estimatedInput,
    outputTokensEst: response.outputTokens ?? estimateTokens(response.text).tokens,
    totalTokensEst: used,
    byteIn: estimateTokens(`${request.system}\n${request.prompt}`).bytes,
    byteOut: estimateTokens(response.text).bytes,
    success: true,
    metadata: {
      purpose: request.purpose,
      role: request.role,
    },
  });
  return response;
}

async function enforceMonthlyBudget(
  db: DB,
  actorPrincipalId: string,
  monthlyTokenBudget: number,
  nextTokens: number
): Promise<void> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const usage = await queryUsage(
    db,
    { scope: ROOT_SCOPE, since: start, operation: "brain.llm", groupBy: "operation", limit: 1000 },
    actorPrincipalId
  );
  const used = usage.rows.reduce((sum, row) => sum + row.totalTokensEst, 0);
  if (used + nextTokens > monthlyTokenBudget) {
    throw new BudgetExceededError("brain monthly token budget reached");
  }
}

export async function registerBrainCapability(
  db: DB,
  actorPrincipalId: string,
  opts: { tokenId?: string | null } = {}
) {
  return registerCapability(
    db,
    {
      scopePath: ROOT_SCOPE,
      name: BRAIN_CAPABILITY_NAME,
      engine: "native",
      engineRef: "packages/brain",
      tokenId: opts.tokenId ?? null,
      description: "CompanyOS second brain wiki maintenance engine",
      status: "active",
    },
    actorPrincipalId
  );
}

export async function runBrainEngine(
  db: DB,
  input: BrainRunInput,
  actorPrincipalId: string,
  deps: BrainDeps
): Promise<BrainRunResult> {
  const now = deps.now ?? new Date();
  const started = new Date();
  const counters: EngineCounters = {
    pagesTouched: 0,
    recordsDistilled: 0,
    tokens: 0,
    llmCalls: 0,
    partial: false,
    outputFailures: 0,
  };
  const scopeRuns: ScopeRunSummary[] = [];
  const lintFindings: LintFinding[] = [];
  const runTokenCeiling = effectiveCeiling(input.tokenCeiling);
  const monthlyTokenBudget = effectiveMonthlyBudget(input.monthlyTokenBudget);
  await registerBrainCapability(db, actorPrincipalId);

  try {
    if (input.mode === "lint") {
      const scopes = await targetScopes(db, input.scopePath);
      for (const scope of scopes) {
        try {
          const lintResult = await lintScope(db, scope.path, actorPrincipalId, deps, counters, runTokenCeiling, monthlyTokenBudget);
          lintFindings.push(...lintResult.findings);
          scopeRuns.push({
            scopePath: scope.path,
            inputCount: lintResult.findings.length,
            pagesTouched: lintResult.findings.some((finding) => finding.action === "auto-fixed") ? 1 : 0,
            recordsDistilled: 0,
            ...lintResult.parseFailure,
          });
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            counters.partial = true;
            scopeRuns.push({ scopePath: scope.path, inputCount: 0, pagesTouched: 0, recordsDistilled: 0, skipped: "budget" });
            break;
          }
          throw error;
        }
      }
    } else {
      const scopes = await targetTopLevelScopes(db, input.scopePath);
      let anyInputs = false;
      for (const scope of scopes) {
        try {
          const since = input.mode === "backfill" ? undefined : await lastSuccessfulIngestAt(db, scope.path, actorPrincipalId);
          const summary = await ingestScope(db, scope.path, since, actorPrincipalId, deps, counters, runTokenCeiling, monthlyTokenBudget);
          const codeDocs = await runCodeDocsPass(
            db,
            { scopePath: scope.path, mode: input.mode, since },
            actorPrincipalId,
            deps,
            counters,
            runTokenCeiling,
            monthlyTokenBudget
          );
          if (codeDocs) {
            summary.codeDocs = codeDocs;
            if (codeDocs.parseFailed) {
              summary.parseFailed = true;
              summary.parseFailureReason = codeDocs.parseFailureReason;
              summary.parseFailureExcerpt = codeDocs.parseFailureExcerpt;
            }
          }
          anyInputs = anyInputs || summary.inputCount > 0 || (codeDocs?.pagesTouched ?? 0) > 0;
          scopeRuns.push(summary);
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            counters.partial = true;
            scopeRuns.push({ scopePath: scope.path, inputCount: 0, pagesTouched: 0, recordsDistilled: 0, skipped: "budget" });
            break;
          }
          throw error;
        }
      }
      if (anyInputs && !counters.partial) {
        try {
          const rootSummary = await distillRoot(db, scopes.map((scope) => scope.path), actorPrincipalId, deps, counters, runTokenCeiling, monthlyTokenBudget);
          if (rootSummary) scopeRuns.push(rootSummary);
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            counters.partial = true;
          } else {
            throw error;
          }
        }
      }
    }

    const result: BrainRunResult = {
      mode: input.mode,
      status: counters.outputFailures > 0 ? "error" : "success",
      partial: counters.partial,
      pagesTouched: counters.pagesTouched,
      recordsDistilled: counters.recordsDistilled,
      tokens: counters.tokens,
      llmCalls: counters.llmCalls,
      scopeRuns,
      lintFindings,
    };
    await reportBrainRun(db, input, actorPrincipalId, started, now, result);
    return result;
  } catch (error) {
    await reportRun(
      db,
      {
        scopePath: ROOT_SCOPE,
        name: BRAIN_CAPABILITY_NAME,
        status: "error",
        runRef: runRef(input, now),
        startedAt: started,
        finishedAt: new Date(),
        summary: error instanceof Error ? error.message : "brain run failed",
        payload: {
          mode: input.mode,
          scopePath: input.scopePath ?? null,
          pagesTouched: counters.pagesTouched,
          recordsDistilled: counters.recordsDistilled,
          tokens: counters.tokens,
          llmCalls: counters.llmCalls,
          outputFailures: counters.outputFailures,
          scopeRuns,
        },
      },
      actorPrincipalId
    );
    throw error;
  }
}

export async function handleBrainEvent(
  db: DB,
  input: BrainEventInput,
  actorPrincipalId: string,
  deps: BrainDeps
): Promise<BrainRunResult | null> {
  if (!isBrainTriggerEvent(input.eventType)) return null;
  return runBrainEngine(
    db,
    {
      mode: "ingest",
      scopePath: input.scopePath,
      runRef: input.runRef ?? `event-${input.eventType}-${input.scopePath}-${Date.now()}`,
      tokenCeiling: input.tokenCeiling,
    },
    actorPrincipalId,
    deps
  );
}

function isBrainTriggerEvent(type: string): boolean {
  return type === "scope.created" ||
    type === "intake.provisioned" ||
    type === "intake.rejected" ||
    type.startsWith("workbench.");
}

async function reportBrainRun(
  db: DB,
  input: BrainRunInput,
  actorPrincipalId: string,
  started: Date,
  now: Date,
  result: BrainRunResult
): Promise<void> {
  const durationMs = Math.max(0, Date.now() - started.getTime());
  const hasWarning = result.lintFindings.some((finding) => finding.severity === "warning");
  await reportRun(
    db,
    {
      scopePath: ROOT_SCOPE,
      name: BRAIN_CAPABILITY_NAME,
      status: result.status,
      runRef: runRef(input, now),
      startedAt: started,
      finishedAt: new Date(),
      durationMs,
      summary: `${input.mode}: ${result.pagesTouched} pages, ${result.recordsDistilled} records, ${result.tokens} tokens${result.partial ? " (partial)" : ""}${result.status === "error" ? " (output contract failure)" : ""}`,
      payload: {
        mode: input.mode,
        status: result.status,
        scopePath: input.scopePath ?? null,
        pagesTouched: result.pagesTouched,
        recordsDistilled: result.recordsDistilled,
        tokens: result.tokens,
        llmCalls: result.llmCalls,
        outputFailures: result.scopeRuns.filter((scopeRun) => scopeRun.parseFailed).length,
        partial: result.partial,
        scopeRuns: result.scopeRuns,
        lintFindings: result.lintFindings,
      },
      alert: hasWarning
        ? {
          severity: "warning",
          message: `Brain lint found ${result.lintFindings.length} issue(s)`,
          metric: "brain.lint.findings",
          value: result.lintFindings.length,
        }
        : undefined,
    },
    actorPrincipalId
  );
}

async function targetTopLevelScopes(db: DB, scopePath?: string): Promise<ScopeInfo[]> {
  const all = (await getSubtree(db, ROOT_SCOPE)) as ScopeInfo[];
  const root = all.find((scope) => scope.type === "root");
  if (!root) return [];
  const top = all
    .filter((scope) => scope.type === "project" && scope.parentId === root.id)
    .sort((a, b) => a.path.localeCompare(b.path));
  if (!scopePath || scopePath === ROOT_SCOPE) return top;
  const firstSegment = scopePath.split("/").filter(Boolean)[0] ?? scopePath;
  return top.filter((scope) => scope.path === firstSegment);
}

async function targetScopes(db: DB, scopePath?: string): Promise<ScopeInfo[]> {
  if (scopePath && scopePath !== ROOT_SCOPE) {
    const subtree = (await getSubtree(db, scopePath)) as ScopeInfo[];
    return subtree.sort((a, b) => a.path.localeCompare(b.path));
  }
  return ((await getSubtree(db, ROOT_SCOPE)) as ScopeInfo[]).sort((a, b) => a.path.localeCompare(b.path));
}

async function lastSuccessfulIngestAt(db: DB, scopePath: string, actorPrincipalId: string): Promise<Date | undefined> {
  const runs = await listCapabilityRuns(
    db,
    { scopePath: ROOT_SCOPE, name: BRAIN_CAPABILITY_NAME, limit: 200 },
    actorPrincipalId
  );
  for (const run of runs) {
    if (run.status !== "success") continue;
    const payload = run.payload as { mode?: string; scopeRuns?: ScopeRunSummary[] };
    if (payload.mode !== "ingest" && payload.mode !== "backfill") continue;
    const matched = payload.scopeRuns?.some((scopeRun) => scopeRun.scopePath === scopePath && scopeRun.skipped !== "budget");
    if (matched) return run.finishedAt ?? run.startedAt;
  }
  return undefined;
}

async function collectInputs(
  db: DB,
  scopePath: string,
  since: Date | undefined,
  actorPrincipalId: string
): Promise<SourceInput[]> {
  const records = await listRecords(
    db,
    { scopePath, includeDescendants: true, since, limit: 200 },
    actorPrincipalId
  );
  const scopeIds = new Map((await getSubtree(db, scopePath) as ScopeInfo[]).map((scope) => [scope.id, scope.path]));
  const events = await listEvents(db, { since, limit: 500 });
  const eventInputs = events
    .filter((event) => event.scopeId && scopeIds.has(String(event.scopeId)))
    .filter((event) => event.type === "session.completed" || event.type.startsWith("workbench.") || event.type.startsWith("intake."))
    .map((event) => ({
      kind: "event" as const,
      id: String(event.id),
      title: event.type,
      bodyMd: JSON.stringify(event.payload ?? {}),
      scopePath: scopeIds.get(String(event.scopeId)) ?? scopePath,
      createdAt: event.createdAt,
    }));

  return [
    ...records.map(recordToInput),
    ...eventInputs,
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

function recordToInput(record: ListedRecord): SourceInput {
  return {
    kind: "record",
    id: record.id,
    title: record.title,
    bodyMd: record.bodyMd || "",
    scopePath: record.scopePath ?? "",
    createdAt: record.createdAt,
  };
}

async function ingestScope(
  db: DB,
  scopePath: string,
  since: Date | undefined,
  actorPrincipalId: string,
  deps: BrainDeps,
  counters: EngineCounters,
  runTokenCeiling: number,
  monthlyTokenBudget: number
): Promise<ScopeRunSummary> {
  const inputs = await collectInputs(db, scopePath, since, actorPrincipalId);
  if (inputs.length === 0) {
    return { scopePath, inputCount: 0, pagesTouched: 0, recordsDistilled: 0, skipped: "no-new-inputs" };
  }

  const skill = await getSkill(db, { name: WIKI_MAINTENANCE_SKILL }, actorPrincipalId);
  const docs = await loadDocs(db, scopePath, actorPrincipalId);
  const candidates = await semanticCandidates(db, scopePath, inputs, actorPrincipalId);
  const response = await callLlm(
    db,
    deps.llm,
    {
      role: "cheap",
      purpose: "scope-ingest",
      system: skill.body,
      prompt: promptWithJsonEnvelope("scope-ingest", {
        scopePath,
        wikiContract: "Update durable wiki pages in place with frontmatter, provenance-tagged Sources, and wikilinks.",
        since: since?.toISOString() ?? null,
        inputs: inputs.map(compactSource),
        currentPages: docs.map(compactDoc),
        semanticCandidates: candidates,
      }),
      maxTokens: Math.max(1, runTokenCeiling - counters.tokens),
    },
    actorPrincipalId,
    counters,
    runTokenCeiling,
    monthlyTokenBudget,
      scopePath
  );
  const parsed = parseJsonObjectResult<IngestOutput>(response.text, { pages: [] });
  const rawPages = Array.isArray(parsed.value.pages) ? parsed.value.pages : [];
  const pages = rawPages.filter(usablePage);
  const parseFailure = !parsed.ok
    ? outputFailure(counters, parsed.reason ?? "invalid JSON", response.text)
    : rawPages.length > 0 && pages.length === 0
      ? outputFailure(counters, "zero usable pages", response.text)
      : null;
  let pagesTouched = 0;
  for (const page of pages) {
    const existing = await getDoc(db, { scopePath, slug: page.slug }, actorPrincipalId);
    const finalBody = ensureWikiPageBody(page.bodyMd, deps.now ?? new Date());
    if (existing?.bodyMd === finalBody && existing.title === page.title) continue;
    await saveDoc(db, { scopePath, slug: page.slug, title: page.title, bodyMd: finalBody }, actorPrincipalId);
    pagesTouched += 1;
  }
  const recordsDistilled = parsed.value.recordsDistilled ?? inputs.filter((input) => input.kind === "record").length;
  counters.pagesTouched += pagesTouched;
  counters.recordsDistilled += recordsDistilled;
  return { scopePath, inputCount: inputs.length, pagesTouched, recordsDistilled, ...(parseFailure ?? {}) };
}

async function semanticCandidates(
  db: DB,
  scopePath: string,
  inputs: SourceInput[],
  actorPrincipalId: string
): Promise<SearchHit[]> {
  const query = inputs.slice(0, 5).map((input) => input.title).join(" ");
  if (!query.trim()) return [];
  try {
    return await search(db, { scopePath, query, kinds: ["doc"], mode: "hybrid", limit: 5 }, actorPrincipalId);
  } catch {
    return [];
  }
}

function compactSource(input: SourceInput) {
  return {
    kind: input.kind,
    id: input.id,
    title: input.title,
    scopePath: input.scopePath,
    createdAt: input.createdAt.toISOString(),
    bodyMd: input.bodyMd.slice(0, 2000),
  };
}

function compactDoc(doc: LoadedDoc) {
  return {
    slug: doc.slug,
    title: doc.title,
    updatedAt: doc.updatedAt.toISOString(),
    bodyMd: doc.bodyMd.slice(0, 4000),
  };
}

async function loadDocs(db: DB, scopePath: string, actorPrincipalId: string): Promise<LoadedDoc[]> {
  const summaries = await listDocs(db, { scopePath }, actorPrincipalId) as DocSummary[];
  const docs: LoadedDoc[] = [];
  for (const summary of summaries) {
    const doc = await getDoc(db, { scopePath, slug: summary.slug }, actorPrincipalId);
    if (!doc) continue;
    docs.push({ ...summary, bodyMd: doc.bodyMd || "" });
  }
  return docs;
}

function ensureWikiPageBody(bodyMd: string, now: Date): string {
  const trimmed = bodyMd.trim();
  const withFrontmatter = trimmed.startsWith("---")
    ? trimmed
    : `---\nlearned_at: "${iso(now)}"\nverified_at: "${iso(now)}"\nconfidence: medium\n---\n\n${trimmed}`;
  if (/^## Sources/m.test(withFrontmatter)) return withFrontmatter;
  return `${withFrontmatter}\n\n## Sources\n\n- ambiguous: engine synthesis (${iso(now)})`;
}

async function distillRoot(
  db: DB,
  scopePaths: string[],
  actorPrincipalId: string,
  deps: BrainDeps,
  counters: EngineCounters,
  runTokenCeiling: number,
  monthlyTokenBudget: number
): Promise<ScopeRunSummary | null> {
  const skill = await getSkill(db, { name: WIKI_MAINTENANCE_SKILL }, actorPrincipalId);
  const scopes = await getSubtree(db, ROOT_SCOPE) as ScopeInfo[];
  const scopeDocs: Array<{ scopePath: string; pages: Array<{ slug: string; title: string; bodyMd: string }> }> = [];
  for (const scopePath of scopePaths) {
    const docs = await loadDocs(db, scopePath, actorPrincipalId);
    scopeDocs.push({
      scopePath,
      pages: docs
        .filter((doc) => doc.slug === "wiki" || !doc.slug.startsWith("lint-report"))
        .slice(0, 10)
        .map((doc) => ({ slug: doc.slug, title: doc.title, bodyMd: doc.bodyMd.slice(0, 2500) })),
    });
  }
  const response = await callLlm(
    db,
    deps.llm,
    {
      role: "analysis",
      purpose: "root-distill",
      system: skill.body,
      prompt: promptWithJsonEnvelope("root-distill", {
        rootReservedPages: ["critical-facts", "scope-map", "pattern-*"],
        instruction: "Write root pages. Pattern pages must be client-agnostic and exclude client-confidential specifics.",
        scopes: scopes.map((scope) => ({ path: scope.path, name: scope.name, type: scope.type, parentId: scope.parentId })),
        scopeDocs,
      }),
      maxTokens: Math.max(1, runTokenCeiling - counters.tokens),
    },
    actorPrincipalId,
    counters,
    runTokenCeiling,
    monthlyTokenBudget,
    ROOT_SCOPE
  );
  const parsed = parseJsonObjectResult<RootDistillOutput>(response.text, { pages: [] });
  const rawPages = Array.isArray(parsed.value.pages) ? parsed.value.pages : [];
  const usablePages = rawPages.filter(usablePage);
  let parseFailure: ParseFailureFields | null = !parsed.ok
    ? outputFailure(counters, parsed.reason ?? "invalid JSON", response.text)
    : rawPages.length > 0 && usablePages.length === 0
      ? outputFailure(counters, "zero usable pages", response.text)
      : null;
  const scopeNames = scopes.filter((scope) => scope.type !== "root").flatMap((scope) => [scope.path, scope.name]);
  for (const scopePath of scopePaths) {
    const workbench = await findNearestWorkbench(db, scopePath);
    if (!workbench?.repo) continue;
    scopeNames.push(workbench.repo);
    const bareRepo = workbench.repo.split("/").pop();
    if (bareRepo) scopeNames.push(bareRepo);
  }
  let droppedNonReservedSlugs = 0;
  let pagesTouched = 0;
  for (const page of usablePages) {
    if (!isRootReservedSlug(page.slug)) {
      droppedNonReservedSlugs += 1;
      continue;
    }
    const bodyMd = page.slug.startsWith("pattern-")
      ? sanitizePatternBody(page.bodyMd, scopeNames)
      : page.bodyMd;
    const finalBody = ensureWikiPageBody(bodyMd, deps.now ?? new Date());
    const existing = await getDoc(db, { scopePath: ROOT_SCOPE, slug: page.slug }, actorPrincipalId);
    if (existing?.bodyMd === finalBody && existing.title === page.title) continue;
    await saveDoc(db, { scopePath: ROOT_SCOPE, slug: page.slug, title: page.title, bodyMd: finalBody }, actorPrincipalId);
    counters.pagesTouched += 1;
    pagesTouched += 1;
  }
  if (!parseFailure && droppedNonReservedSlugs > 0 && pagesTouched === 0) {
    parseFailure = outputFailure(counters, "root distill returned only non-reserved slugs", response.text, { droppedNonReservedSlugs });
  } else if (parseFailure && droppedNonReservedSlugs > 0) {
    parseFailure.droppedNonReservedSlugs = droppedNonReservedSlugs;
  }
  if (!parseFailure && droppedNonReservedSlugs === 0) return null;
  return {
    scopePath: ROOT_SCOPE,
    inputCount: scopeDocs.reduce((sum, scopeDoc) => sum + scopeDoc.pages.length, 0),
    pagesTouched,
    recordsDistilled: 0,
    droppedNonReservedSlugs,
    ...(parseFailure ?? {}),
  };
}

function isRootReservedSlug(slug: string): boolean {
  return slug === "critical-facts" || slug === "scope-map" || slug.startsWith("pattern-");
}

function sanitizePatternBody(bodyMd: string, scopeNames: string[]): string {
  let sanitized = bodyMd;
  for (const rawName of scopeNames) {
    const name = rawName.trim();
    if (!name) continue;
    sanitized = sanitized.replaceAll(name, "a scope");
  }
  return sanitized;
}

async function lintScope(
  db: DB,
  scopePath: string,
  actorPrincipalId: string,
  deps: BrainDeps,
  counters: EngineCounters,
  runTokenCeiling: number,
  monthlyTokenBudget: number
): Promise<LintScopeResult> {
  const docs = await loadDocs(db, scopePath, actorPrincipalId);
  if (docs.length === 0) return { findings: [] };
  const findings: LintFinding[] = [];
  findings.push(...await fixIndexLinks(db, scopePath, docs, actorPrincipalId));
  findings.push(...await mergeExactDuplicates(db, scopePath, docs, actorPrincipalId));
  findings.push(...staleFindings(docs, deps.now ?? new Date()));

  const skill = await getSkill(db, { name: WIKI_MAINTENANCE_SKILL }, actorPrincipalId);
  const response = await callLlm(
    db,
    deps.llm,
    {
      role: "analysis",
      purpose: "lint-scope",
      system: skill.body,
      prompt: promptWithJsonEnvelope("lint-scope", {
        scopePath,
        instruction: "Find contradictions only. Return JSON findings; do not ask to auto-fix contradictions.",
        pages: docs.map(compactDoc),
      }),
      maxTokens: Math.max(1, runTokenCeiling - counters.tokens),
    },
    actorPrincipalId,
    counters,
    runTokenCeiling,
    monthlyTokenBudget,
    scopePath
  );
  const parsed = parseJsonObjectResult<LintOutput>(response.text, { findings: [] });
  const rawFindings = Array.isArray(parsed.value.findings) ? parsed.value.findings : [];
  const usableFindings = rawFindings.filter(usableFinding);
  const parseFailure = !parsed.ok
    ? outputFailure(counters, parsed.reason ?? "invalid JSON", response.text)
    : rawFindings.length > 0 && usableFindings.length === 0
      ? outputFailure(counters, "zero usable findings", response.text)
      : undefined;
  const llmFindings = usableFindings
    .map((finding) => ({ ...finding, action: "flagged" as const, severity: "warning" as const }));
  findings.push(...llmFindings);

  if (findings.some((finding) => finding.action === "flagged" || finding.type === "orphan")) {
    await saveLintReport(db, scopePath, findings, actorPrincipalId, deps.now ?? new Date());
    counters.pagesTouched += 1;
  }
  return { findings, parseFailure };
}

async function fixIndexLinks(
  db: DB,
  scopePath: string,
  docs: LoadedDoc[],
  actorPrincipalId: string
): Promise<LintFinding[]> {
  const index = docs.find((doc) => doc.slug === "wiki");
  if (!index) return [];
  const reachable = reachableSlugs(index.bodyMd, docs);
  const topicSlugs = docs
    .map((doc) => doc.slug)
    .filter((slug) => slug !== "wiki" && slug !== "lint-report" && !slug.startsWith("lint-report"));
  const missing = topicSlugs.filter((slug) => !reachable.has(slug));
  if (missing.length === 0) return [];
  const bodyMd = `${index.bodyMd.trim()}\n\n## Linked topic pages\n\n${missing.map((slug) => `- [[${slug}]]`).join("\n")}\n`;
  await saveDoc(db, { scopePath, slug: "wiki", title: index.title, bodyMd }, actorPrincipalId);
  return missing.map((slug) => ({
    type: "orphan" as const,
    severity: "warning" as const,
    message: `Linked orphaned page [[${slug}]] from the wiki index.`,
    slugs: [slug],
    action: "auto-fixed" as const,
  }));
}

function reachableSlugs(indexBody: string, docs: LoadedDoc[]): Set<string> {
  const bySlug = new Map(docs.map((doc) => [doc.slug, doc]));
  const seen = new Set<string>(["wiki"]);
  const queue = parseWikilinks(indexBody);
  while (queue.length > 0) {
    const slug = queue.shift();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const doc = bySlug.get(slug);
    if (doc) queue.push(...parseWikilinks(doc.bodyMd));
  }
  return seen;
}

function parseWikilinks(bodyMd: string): string[] {
  const slugs: string[] = [];
  for (const match of bodyMd.matchAll(WIKILINK_RE)) {
    const target = (match[1] ?? "").split("|", 1)[0]?.trim() ?? "";
    const slug = target.includes(":") ? target.slice(target.lastIndexOf(":") + 1) : target;
    if (slug) slugs.push(slug);
  }
  return slugs;
}

async function mergeExactDuplicates(
  db: DB,
  scopePath: string,
  docs: LoadedDoc[],
  actorPrincipalId: string
): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];
  const seen = new Map<string, LoadedDoc>();
  for (const doc of docs.filter((row) => row.slug !== "wiki" && !row.slug.startsWith("lint-report"))) {
    const normalized = normalizeBody(doc.bodyMd);
    if (!normalized) continue;
    const existing = seen.get(normalized);
    if (!existing) {
      seen.set(normalized, doc);
      continue;
    }
    const loser = existing.slug.localeCompare(doc.slug) <= 0 ? doc : existing;
    await archiveDoc(db, { scopePath, slug: loser.slug }, actorPrincipalId);
    findings.push({
      type: "duplicate",
      severity: "info",
      message: `Archived exact duplicate [[${loser.slug}]].`,
      slugs: [existing.slug, doc.slug],
      action: "auto-fixed",
    });
  }
  return findings;
}

function normalizeBody(bodyMd: string): string {
  return bodyMd
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/## Sources[\s\S]*$/m, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function staleFindings(docs: LoadedDoc[], now: Date): LintFinding[] {
  return docs.flatMap((doc) => {
    const staleAfter = frontmatterValue(doc.bodyMd, "stale_after");
    if (!staleAfter) return [];
    const staleDate = new Date(staleAfter);
    if (Number.isNaN(staleDate.getTime()) || staleDate.getTime() > now.getTime()) return [];
    return [{
      type: "stale" as const,
      severity: "warning" as const,
      message: `Stale claim review elapsed for [[${doc.slug}]] (${staleAfter}).`,
      slugs: [doc.slug],
      action: "flagged" as const,
    }];
  });
}

function frontmatterValue(bodyMd: string, key: string): string | null {
  const match = /^---\s*([\s\S]*?)\s*---/.exec(bodyMd);
  if (!match) return null;
  const lines = (match[1] ?? "").split(/\r?\n/);
  for (const line of lines) {
    const pair = new RegExp(`^${key}:\\s*(.+)$`).exec(line.trim());
    if (!pair) continue;
    return (pair[1] ?? "").replace(/^["']|["']$/g, "").trim();
  }
  return null;
}

async function saveLintReport(
  db: DB,
  scopePath: string,
  findings: LintFinding[],
  actorPrincipalId: string,
  now: Date
): Promise<void> {
  const body = [
    `---`,
    `learned_at: "${iso(now)}"`,
    `verified_at: "${iso(now)}"`,
    `confidence: high`,
    `---`,
    ``,
    `# Lint Report`,
    ``,
    ...findings.map((finding) => `- ${finding.severity}: ${finding.type} (${finding.action}) - ${finding.message} ${finding.slugs.map((slug) => `[[${slug}]]`).join(" ")}`),
    ``,
    `## Sources`,
    ``,
    `- extracted: brain lint run (${iso(now)})`,
  ].join("\n");
  await saveDoc(db, { scopePath, slug: "lint-report", title: "Lint Report", bodyMd: body }, actorPrincipalId);
}

export function createLiteLlmBrainClient(config: LiteLlmBrainClientConfig): BrainLlmClient {
  return {
    async complete(request: BrainLlmRequest): Promise<BrainLlmResponse> {
      const base = config.baseUrl.replace(/\/$/, "");
      const response = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: request.role,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.prompt },
          ],
          max_tokens: request.maxTokens,
          response_format: { type: "json_object" },
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`brain LLM ${response.status}: ${text}`);
      }
      const json = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      return {
        text: json.choices?.[0]?.message?.content ?? "",
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
        totalTokens: json.usage?.total_tokens,
      };
    },
  };
}
