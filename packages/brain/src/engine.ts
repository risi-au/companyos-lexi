import {
  archiveDoc,
  createAttentionItem,
  estimateTokens,
  findNearestWorkbench,
  getDoc,
  getSkill,
  getSubtree,
  isReservedOperationalWikiReportSlug,
  listHumanPersonalScopeTargets,
  listCapabilityRuns,
  listAttentionItems,
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
  type PersonalScopeTarget,
  type WikiProposalPayload,
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
const PERSON_VS_WORK_ROUTING_RULE = "is the fact about the person or about the work? Person (tool prefs, folder conventions, schedules, working style) -> that person's personal wiki. Client/project truth -> scope wiki. Cross-client playbook -> root pattern.";
const PAGE_PURPOSE_TAXONOMY = "New or updated topic markdown should include frontmatter category with one of: current-work, decisions-policies, guides-processes, reference. Reserved pages keep deterministic placement: wiki/overview/critical-facts/scope-map are Start here; root pattern-* pages are Guides and processes.";
const JSON_ENVELOPE_INSTRUCTIONS: Record<BrainLlmRequest["purpose"], string> = {
  "scope-ingest": "Return only one JSON object: {\"pages\":[{\"slug\":\"kebab-slug\",\"title\":\"Title\",\"bodyMd\":\"markdown-with-category-frontmatter\",\"targetScopePath\":\"optional-valid-target\"}],\"recordsDistilled\":0}. Topic page frontmatter category must be one of current-work, decisions-policies, guides-processes, reference. No prose, no markdown fence.",
  "root-distill": "Return only one JSON object: {\"pages\":[{\"slug\":\"critical-facts|scope-map|pattern-name\",\"title\":\"Title\",\"bodyMd\":\"markdown-with-category-frontmatter\"}]}. Use category guides-processes for root pattern-* pages. No prose, no markdown fence.",
  "project-overview": "Return only one JSON object: {\"pages\":[{\"slug\":\"overview\",\"title\":\"Overview\",\"bodyMd\":\"markdown\"}]}. No prose, no markdown fence.",
  "lint-scope": "Return only one JSON object with either {\"findings\":[{\"version\":2,\"type\":\"contradiction\",\"relation\":\"scalar-mismatch|opposite-boolean|exclusive-status\",\"subject\":{\"entity\":\"normalized entity\",\"property\":\"normalized property\",\"timeframe\":\"normalized timeframe\"},\"explanation\":\"plain language\",\"claims\":[{\"slug\":\"slug-a\",\"title\":\"Title A\",\"quote\":\"exact current page quote\",\"normalizedValue\":\"value\"},{\"slug\":\"slug-b\",\"title\":\"Title B\",\"quote\":\"exact current page quote\",\"normalizedValue\":\"value\"}],\"choices\":[{\"id\":\"first\",\"label\":\"Keep first claim\",\"repair\":{\"slug\":\"slug-b\",\"title\":\"Title B\",\"currentMd\":\"current full markdown\",\"proposedMd\":\"changed full markdown\"}},{\"id\":\"second\",\"label\":\"Keep second claim\",\"repair\":{\"slug\":\"slug-a\",\"title\":\"Title A\",\"currentMd\":\"current full markdown\",\"proposedMd\":\"changed full markdown\"}}]}]} or {\"graduations\":[{\"direction\":\"personal-to-scope|scope-to-personal\",\"targetScopePath\":\"target\",\"fromScopePath\":\"source\",\"fromSlug\":\"slug\",\"proposal\":{\"slug\":\"target-slug\",\"title\":\"Title\",\"proposedMd\":\"markdown\"}}]}. No prose, no markdown fence.",
  "code-docs": "Return only one JSON object: {\"pages\":[{\"slug\":\"code-architecture|code-stack|code-integrations|code-ops\",\"title\":\"Title\",\"bodyMd\":\"markdown\"}]}. No prose, no markdown fence.",
};

export type BrainRunMode = "ingest" | "lint" | "backfill";
export type BrainRoleAlias = "cheap" | "analysis";

export interface BrainLlmRequest {
  role: BrainRoleAlias;
  purpose: "scope-ingest" | "root-distill" | "project-overview" | "lint-scope" | "code-docs";
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
  graduationProposals: GraduationProposal[];
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
  targetScopePath?: string;
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
  scopePath?: string;
  payload?: WikiConflictPayloadV2 | WikiStalePayloadV2;
  fingerprint?: string;
}

interface LintOutput {
  findings: unknown[];
}

type WikiConflictRelation = "scalar-mismatch" | "opposite-boolean" | "exclusive-status";

interface WikiConflictSubject {
  entity: string;
  property: string;
  timeframe: string;
}

interface WikiConflictClaim {
  slug: string;
  title: string;
  quote: string;
  normalizedValue: string;
}

interface WikiConflictChoice {
  id: "first" | "second";
  label: string;
  repair: SinglePageRepair;
}

interface SinglePageRepair {
  slug: string;
  title: string;
  currentMd: string;
  proposedMd: string;
}

interface WikiConflictPayloadV2 {
  version: 2;
  type: "contradiction";
  relation: WikiConflictRelation;
  subject: WikiConflictSubject;
  explanation: string;
  claims: [WikiConflictClaim, WikiConflictClaim];
  choices: [WikiConflictChoice, WikiConflictChoice];
  scopePath: string;
}

interface WikiStalePayloadV2 {
  version: 2;
  type: "stale";
  slug: string;
  title: string;
  currentMd: string;
  reviewDueAt: string;
}

interface GraduationProposal {
  direction: "personal-to-scope" | "scope-to-personal";
  targetScopePath: string;
  fromScopePath: string;
  fromSlug: string;
  proposal: WikiProposalPayload;
}

interface GraduationOutput {
  graduations: GraduationProposal[];
}

interface LintScopeResult {
  findings: LintFinding[];
  graduationProposals: GraduationProposal[];
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
  const graduationProposals: GraduationProposal[] = [];
  const runTokenCeiling = effectiveCeiling(input.tokenCeiling);
  const monthlyTokenBudget = effectiveMonthlyBudget(input.monthlyTokenBudget);
  await registerBrainCapability(db, actorPrincipalId);

  try {
    if (input.mode === "lint") {
      const scopes = await targetScopes(db, input.scopePath);
      for (const scope of scopes) {
        try {
          const lintResult = await lintScope(db, scope.path, actorPrincipalId, deps, counters, runTokenCeiling, monthlyTokenBudget);
          lintFindings.push(...lintResult.findings.map((finding) => ({ ...finding, scopePath: scope.path })));
          graduationProposals.push(...lintResult.graduationProposals);
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
          const overviewSummary = scope.type === "project"
            ? await distillProjectOverview(db, scope, since, actorPrincipalId, deps, counters, runTokenCeiling, monthlyTokenBudget)
            : null;
          if (overviewSummary) {
            summary.pagesTouched += overviewSummary.pagesTouched;
            summary.recordsDistilled += overviewSummary.recordsDistilled;
            if (overviewSummary.parseFailed) {
              summary.parseFailed = true;
              summary.parseFailureReason = overviewSummary.parseFailureReason;
              summary.parseFailureExcerpt = overviewSummary.parseFailureExcerpt;
            }
          }
          anyInputs = anyInputs || summary.inputCount > 0 || (codeDocs?.pagesTouched ?? 0) > 0 || (overviewSummary?.pagesTouched ?? 0) > 0;
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
      graduationProposals,
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
  await createAttentionItemsForLintFindings(db, result.lintFindings, actorPrincipalId);
  await createAttentionItemsForGraduationProposals(db, result.graduationProposals, actorPrincipalId);
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
        graduationProposals: result.graduationProposals,
      },
      alert: hasWarning
        ? {
          severity: "warning",
          message: `Wiki health found ${result.lintFindings.length} question(s)`,
          metric: "brain.lint.findings",
          value: result.lintFindings.length,
        }
        : undefined,
    },
    actorPrincipalId
  );
}

function lintFindingKey(finding: Pick<LintFinding, "type" | "slugs">): string {
  return `${finding.type}:${[...finding.slugs].sort().join(",")}`;
}

function lintFindingFingerprint(finding: LintFinding): string {
  return finding.fingerprint ?? lintFindingKey(finding);
}

function graduationProposalKey(proposal: Pick<GraduationProposal, "direction" | "targetScopePath" | "fromScopePath" | "fromSlug" | "proposal">): string {
  return `${proposal.direction}:${proposal.targetScopePath}:${proposal.fromScopePath}:${proposal.fromSlug}:${proposal.proposal.slug}`;
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function lowerStable(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function sameSubject(a: WikiConflictSubject, b: WikiConflictSubject): boolean {
  return lowerStable(a.entity) === lowerStable(b.entity) &&
    lowerStable(a.property) === lowerStable(b.property) &&
    lowerStable(a.timeframe) === lowerStable(b.timeframe);
}

function subjectFromValue(value: unknown): WikiConflictSubject | null {
  const raw = payloadRecord(value);
  const subject = {
    entity: normalizeText(raw.entity),
    property: normalizeText(raw.property),
    timeframe: normalizeText(raw.timeframe),
  };
  return subject.entity && subject.property && subject.timeframe ? subject : null;
}

function claimFromValue(value: unknown): WikiConflictClaim | null {
  const raw = payloadRecord(value);
  const claim = {
    slug: normalizeText(raw.slug),
    title: normalizeText(raw.title),
    quote: normalizeText(raw.quote),
    normalizedValue: normalizeText(raw.normalizedValue),
  };
  return claim.slug && claim.title && claim.quote && claim.normalizedValue ? claim : null;
}

function repairFromValue(value: unknown): SinglePageRepair | null {
  const raw = payloadRecord(value);
  const repair = {
    slug: normalizeText(raw.slug),
    title: normalizeText(raw.title),
    currentMd: typeof raw.currentMd === "string" ? raw.currentMd : "",
    proposedMd: typeof raw.proposedMd === "string" ? raw.proposedMd : "",
  };
  return repair.slug && repair.title && repair.currentMd && repair.proposedMd ? repair : null;
}

function choiceFromValue(value: unknown): WikiConflictChoice | null {
  const raw = payloadRecord(value);
  const id = raw.id === "first" || raw.id === "second" ? raw.id : null;
  const label = normalizeText(raw.label);
  const repair = repairFromValue(raw.repair);
  return id && label && repair ? { id, label, repair } : null;
}

function valuesShareExplicitStatusFamily(first: string, second: string): boolean {
  const firstValue = lowerStable(first);
  const secondValue = lowerStable(second);
  const families = [
    ["accepted", "rejected", "dismissed", "pending"],
    ["approved", "rejected", "dismissed", "pending"],
    ["open", "closed", "paused", "cancelled", "blocked"],
    ["active", "inactive", "paused", "cancelled"],
    ["draft", "published", "archived"],
  ];
  return families.some((family) => family.includes(firstValue) && family.includes(secondValue));
}

function booleanValue(value: string): boolean | null {
  const normalized = lowerStable(value);
  if (["true", "yes", "enabled", "active", "on"].includes(normalized)) return true;
  if (["false", "no", "disabled", "inactive", "off"].includes(normalized)) return false;
  return null;
}

function scalarParts(value: string): { scalar: string; unit: string } | null {
  const normalized = lowerStable(value);
  const suffixUnit = /^([-+]?\d+(?:\.\d+)?)\s*([a-z%$][a-z0-9%$-]*)$/i.exec(normalized);
  if (suffixUnit) return { scalar: suffixUnit[1] ?? "", unit: suffixUnit[2] ?? "" };
  const prefixUnit = /^([a-z%$][a-z%$-]*)\s*([-+]?\d+(?:\.\d+)?)$/i.exec(normalized);
  if (prefixUnit) return { scalar: prefixUnit[2] ?? "", unit: prefixUnit[1] ?? "" };
  return null;
}

function isProcessCompletionOutcomeConfusion(subject: WikiConflictSubject, claims: [WikiConflictClaim, WikiConflictClaim]): boolean {
  const text = lowerStable(`${subject.property} ${claims[0].quote} ${claims[1].quote} ${claims[0].normalizedValue} ${claims[1].normalizedValue}`);
  return text.includes("completed") &&
    (text.includes("approved") || text.includes("accepted") || text.includes("successful") || text.includes("dismissed"));
}

function relationIsValid(relation: WikiConflictRelation, subject: WikiConflictSubject, claims: [WikiConflictClaim, WikiConflictClaim]): boolean {
  const first = claims[0].normalizedValue;
  const second = claims[1].normalizedValue;
  if (lowerStable(first) === lowerStable(second)) return false;
  if (isProcessCompletionOutcomeConfusion(subject, claims)) return false;
  if (relation === "scalar-mismatch") {
    const a = scalarParts(first);
    const b = scalarParts(second);
    return !!a && !!b && a.scalar !== b.scalar && a.unit === b.unit;
  }
  if (relation === "opposite-boolean") {
    const a = booleanValue(first);
    const b = booleanValue(second);
    return a !== null && b !== null && a !== b;
  }
  return valuesShareExplicitStatusFamily(first, second);
}

function validateWikiConflictFinding(value: unknown, scopePath: string, docs: LoadedDoc[]): { finding?: LintFinding; reason?: string } {
  const raw = payloadRecord(value);
  if (raw.version !== 2 || raw.type !== "contradiction") return { reason: "finding is not a V2 contradiction" };
  const relation = raw.relation === "scalar-mismatch" || raw.relation === "opposite-boolean" || raw.relation === "exclusive-status"
    ? raw.relation
    : null;
  if (!relation) return { reason: "unsupported contradiction relation" };
  const subject = subjectFromValue(raw.subject);
  if (!subject) return { reason: "missing normalized subject" };
  const explanation = normalizeText(raw.explanation);
  if (!explanation) return { reason: "missing plain-language explanation" };
  if (!Array.isArray(raw.claims) || raw.claims.length !== 2) return { reason: "expected exactly two claims" };
  if (!Array.isArray(raw.choices) || raw.choices.length !== 2) return { reason: "expected exactly two choices" };
  const claims = raw.claims.map(claimFromValue);
  if (!claims[0] || !claims[1]) return { reason: "claim is missing title, quote, or normalized value" };
  const pair = [claims[0], claims[1]] as [WikiConflictClaim, WikiConflictClaim];
  if (pair[0].slug === pair[1].slug) return { reason: "claims must cite two different pages" };
  const claimSubjects = raw.claims.map((claim) => subjectFromValue(payloadRecord(claim).subject));
  if (claimSubjects.some(Boolean) && (!claimSubjects[0] || !claimSubjects[1] || !sameSubject(subject, claimSubjects[0]) || !sameSubject(subject, claimSubjects[1]))) {
    return { reason: "claims do not describe the same normalized subject" };
  }
  const docsBySlug = new Map(docs.map((doc) => [doc.slug, doc]));
  const firstDoc = docsBySlug.get(pair[0].slug);
  const secondDoc = docsBySlug.get(pair[1].slug);
  if (!firstDoc || !secondDoc) return { reason: "referenced page does not exist" };
  if (firstDoc.title !== pair[0].title || secondDoc.title !== pair[1].title) return { reason: "referenced page title does not match current state" };
  if (!firstDoc.bodyMd.includes(pair[0].quote) || !secondDoc.bodyMd.includes(pair[1].quote)) return { reason: "exact quote is missing from current page" };
  if (!pair[0].quote.includes(pair[0].normalizedValue) || !pair[1].quote.includes(pair[1].normalizedValue)) return { reason: "normalized value is not present in quote" };
  if (!relationIsValid(relation, subject, pair)) return { reason: "relation and values are not a supported conflict" };
  const choices = raw.choices.map(choiceFromValue);
  if (!choices[0] || !choices[1]) return { reason: "choice repair is incomplete" };
  const choicePair = [choices[0], choices[1]] as [WikiConflictChoice, WikiConflictChoice];
  if (choicePair[0].id !== "first" || choicePair[1].id !== "second") return { reason: "choices must be first then second" };
  const expectedRepairs = { first: pair[1], second: pair[0] };
  for (const choice of choicePair) {
    const expected = expectedRepairs[choice.id];
    const current = docsBySlug.get(choice.repair.slug);
    if (!current || ![pair[0].slug, pair[1].slug].includes(choice.repair.slug)) return { reason: "repair targets an uncited page" };
    if (choice.repair.slug !== expected.slug) return { reason: "choice must repair the page for the losing claim" };
    if (choice.repair.title !== current.title) return { reason: "repair title does not match current page" };
    if (choice.repair.currentMd !== current.bodyMd) return { reason: "repair current markdown is not byte-equal to current page" };
    if (choice.repair.proposedMd === choice.repair.currentMd) return { reason: "repair proposed markdown makes no change" };
  }
  const payload: WikiConflictPayloadV2 = {
    version: 2,
    type: "contradiction",
    relation,
    subject,
    explanation,
    claims: pair,
    choices: choicePair,
    scopePath,
  };
  const sortedClaims = [...pair].sort((a, b) => a.slug.localeCompare(b.slug));
  const fingerprint = [
    "v2",
    scopePath,
    relation,
    lowerStable(subject.entity),
    lowerStable(subject.property),
    lowerStable(subject.timeframe),
    ...sortedClaims.flatMap((claim) => [claim.slug, claim.quote]),
  ].join("|");
  return {
    finding: {
      type: "contradiction",
      severity: "warning",
      message: explanation,
      slugs: pair.map((claim) => claim.slug),
      action: "flagged",
      payload,
      fingerprint,
    },
  };
}

async function createAttentionItemsForLintFindings(
  db: DB,
  findings: LintFinding[],
  actorPrincipalId: string
): Promise<void> {
  const flagged = findings.filter((finding) => finding.action === "flagged" && finding.scopePath);
  const byScope = new Map<string, LintFinding[]>();
  for (const finding of flagged) {
    const scopePath = finding.scopePath!;
    const bucket = byScope.get(scopePath) ?? [];
    bucket.push(finding);
    byScope.set(scopePath, bucket);
  }

  for (const [scopePath, scopeFindings] of byScope) {
    const open = await listAttentionItems(db, { scopePath, kind: "lint_finding", status: "open", limit: 200 }, actorPrincipalId);
    const existingKeys = new Set(open.map((item) => {
      const payload = payloadRecord(item.payload);
      if (typeof payload.fingerprint === "string" && payload.fingerprint.startsWith("v2|")) return payload.fingerprint;
      return lintFindingKey({
        type: String(payload.type ?? "") as LintFinding["type"],
        slugs: Array.isArray(payload.slugs) ? payload.slugs.map(String) : [],
      });
    }));

    for (const finding of scopeFindings) {
      const key = lintFindingFingerprint(finding);
      if (existingKeys.has(key)) continue;
      await createAttentionItem(db, {
        scopePath,
        kind: "lint_finding",
        title: finding.type === "contradiction" ? "Two wiki pages disagree" : "This page may be out of date",
        summary: finding.message,
        payload: finding.payload
          ? { ...finding.payload, scopePath, fingerprint: key }
          : { ...finding, scopePath, fingerprint: key },
      }, actorPrincipalId);
      existingKeys.add(key);
    }
  }
}

async function createAttentionItemsForGraduationProposals(
  db: DB,
  proposals: GraduationProposal[],
  actorPrincipalId: string
): Promise<void> {
  const byTarget = new Map<string, GraduationProposal[]>();
  for (const proposal of proposals) {
    const bucket = byTarget.get(proposal.targetScopePath) ?? [];
    bucket.push(proposal);
    byTarget.set(proposal.targetScopePath, bucket);
  }

  for (const [scopePath, scopeProposals] of byTarget) {
    const open = await listAttentionItems(db, { scopePath, kind: "graduation", status: "open", limit: 200 }, actorPrincipalId);
    const existingKeys = new Set(open.map((item) => {
      const payload = payloadRecord(item.payload);
      const nested = payloadRecord(payload.proposal);
      return graduationProposalKey({
        direction: String(payload.direction ?? "") as GraduationProposal["direction"],
        targetScopePath: item.scopePath,
        fromScopePath: String(payload.fromScopePath ?? ""),
        fromSlug: String(payload.fromSlug ?? ""),
        proposal: {
          slug: String(nested.slug ?? ""),
          title: String(nested.title ?? ""),
          proposedMd: String(nested.proposedMd ?? ""),
        },
      });
    }));

    for (const proposal of scopeProposals) {
      const key = graduationProposalKey(proposal);
      if (existingKeys.has(key)) continue;
      await createAttentionItem(db, {
        scopePath,
        kind: "graduation",
        title: proposal.direction === "personal-to-scope" ? "Graduate personal fact to scope wiki" : "Move person-specific fact to personal wiki",
        summary: `${proposal.fromScopePath}:${proposal.fromSlug} -> ${scopePath}:${proposal.proposal.slug}`,
        payload: {
          direction: proposal.direction,
          fromScopePath: proposal.fromScopePath,
          fromSlug: proposal.fromSlug,
          proposal: proposal.proposal,
        },
      }, actorPrincipalId);
      existingKeys.add(key);
    }
  }
}

async function targetTopLevelScopes(db: DB, scopePath?: string): Promise<ScopeInfo[]> {
  const all = (await getSubtree(db, ROOT_SCOPE)) as ScopeInfo[];
  const root = all.find((scope) => scope.type === "root");
  if (!root) return [];
  const top = all
    .filter((scope) => scope.type === "project" && scope.parentId === root.id)
    .sort((a, b) => a.path.localeCompare(b.path));
  if (!scopePath || scopePath === ROOT_SCOPE) return top;
  const requested = all.find((scope) => scope.path === scopePath);
  if (requested?.type === "personal") return [requested];
  const firstSegment = scopePath.split("/").filter(Boolean)[0] ?? scopePath;
  const personalTop = all.find((scope) => scope.type === "personal" && scope.path === firstSegment);
  if (personalTop) return [personalTop];
  return top.filter((scope) => scope.path === firstSegment);
}

async function targetScopes(db: DB, scopePath?: string): Promise<ScopeInfo[]> {
  if (scopePath && scopePath !== ROOT_SCOPE) {
    const subtree = (await getSubtree(db, scopePath)) as ScopeInfo[];
    return subtree.sort((a, b) => a.path.localeCompare(b.path));
  }
  return ((await getSubtree(db, ROOT_SCOPE)) as ScopeInfo[])
    .filter((scope) => scope.type !== "personal")
    .sort((a, b) => a.path.localeCompare(b.path));
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

function routeIngestTarget(page: IngestPageOutput, ingestScopePath: string, personalTargetPaths: ReadonlySet<string>): string | null {
  const requested = typeof page.targetScopePath === "string" ? page.targetScopePath.trim() : "";
  if (!requested) return ingestScopePath;
  if (requested === ingestScopePath) return ingestScopePath;
  if (personalTargetPaths.has(requested)) return requested;
  return null;
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
  const personalTargets = await listHumanPersonalScopeTargets(db);
  const personalTargetPaths = new Set(personalTargets.map((target) => target.scopePath));
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
        pagePurposeTaxonomy: PAGE_PURPOSE_TAXONOMY,
        routingRule: PERSON_VS_WORK_ROUTING_RULE,
        personalWikiTargets: personalTargets.map((target) => ({
          principalId: target.principalId,
          principalName: target.principalName,
          scopePath: target.scopePath,
        })),
        validTargetScopePaths: [scopePath, ...personalTargets.map((target) => target.scopePath)],
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
    const targetScopePath = routeIngestTarget(page, scopePath, personalTargetPaths);
    if (!targetScopePath) continue;
    const existing = await getDoc(db, { scopePath: targetScopePath, slug: page.slug }, actorPrincipalId);
    const finalBody = ensureWikiPageBody(page.bodyMd, deps.now ?? new Date());
    if (existing?.bodyMd === finalBody && existing.title === page.title) continue;
    await saveDoc(db, { scopePath: targetScopePath, slug: page.slug, title: page.title, bodyMd: finalBody }, actorPrincipalId);
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

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function wikiProposalFromValue(value: unknown): WikiProposalPayload | null {
  const raw = recordValue(value);
  if (!raw) return null;
  const slug = String(raw.slug ?? "").trim();
  const title = String(raw.title ?? "").trim();
  if (!slug || !title || typeof raw.proposedMd !== "string") return null;
  return {
    slug,
    title,
    proposedMd: raw.proposedMd,
    ...(typeof raw.baseRevisionId === "string" ? { baseRevisionId: raw.baseRevisionId } : {}),
    ...(typeof raw.currentMd === "string" ? { currentMd: raw.currentMd } : {}),
  };
}

function normalizeGraduationProposal(
  value: unknown,
  scopePath: string,
  personalTargetPaths: ReadonlySet<string>
): GraduationProposal | null {
  const raw = recordValue(value);
  if (!raw) return null;
  const direction = raw.direction;
  if (direction !== "personal-to-scope" && direction !== "scope-to-personal") return null;
  const targetScopePath = String(raw.targetScopePath ?? "").trim();
  const fromScopePath = String(raw.fromScopePath ?? "").trim();
  const fromSlug = String(raw.fromSlug ?? "").trim();
  const proposal = wikiProposalFromValue(raw.proposal);
  if (!targetScopePath || !fromScopePath || !fromSlug || !proposal) return null;

  const validPersonalToScope = direction === "personal-to-scope" &&
    personalTargetPaths.has(fromScopePath) &&
    (targetScopePath === scopePath || targetScopePath === ROOT_SCOPE);
  const validScopeToPersonal = direction === "scope-to-personal" &&
    fromScopePath === scopePath &&
    personalTargetPaths.has(targetScopePath);
  if (!validPersonalToScope && !validScopeToPersonal) return null;

  return { direction, targetScopePath, fromScopePath, fromSlug, proposal };
}

async function loadPersonalDocsForGraduation(
  db: DB,
  targets: PersonalScopeTarget[],
  actorPrincipalId: string
): Promise<Array<{ principalName: string; scopePath: string; pages: ReturnType<typeof compactDoc>[] }>> {
  const result: Array<{ principalName: string; scopePath: string; pages: ReturnType<typeof compactDoc>[] }> = [];
  for (const target of targets.slice(0, 20)) {
    const docs = await loadDocs(db, target.scopePath, actorPrincipalId);
    const pages = docs
      .filter((doc) => !isReservedOperationalWikiReportSlug(doc.slug))
      .slice(0, 5)
      .map(compactDoc);
    if (pages.length > 0) {
      result.push({ principalName: target.principalName, scopePath: target.scopePath, pages });
    }
  }
  return result;
}

async function graduationProposalsForScope(
  db: DB,
  scopePath: string,
  docs: LoadedDoc[],
  actorPrincipalId: string,
  deps: BrainDeps,
  counters: EngineCounters,
  runTokenCeiling: number,
  monthlyTokenBudget: number
): Promise<{ proposals: GraduationProposal[]; parseFailure?: ParseFailureFields }> {
  const personalTargets = await listHumanPersonalScopeTargets(db);
  if (personalTargets.length === 0) return { proposals: [] };
  const personalTargetPaths = new Set(personalTargets.map((target) => target.scopePath));
  const personalPages = await loadPersonalDocsForGraduation(db, personalTargets, actorPrincipalId);
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
        instruction: "Flag graduation proposals only. Do not auto-pick winners. Return proposed target-page markdown as an embedded proposal.",
        routingRule: PERSON_VS_WORK_ROUTING_RULE,
        privacyGuard: "For personal-to-scope items, payloads must contain only the proposed target page content and source identifiers; do not include other personal pages.",
        workTargets: [scopePath, ROOT_SCOPE],
        personalWikiTargets: personalTargets.map((target) => ({
          principalId: target.principalId,
          principalName: target.principalName,
          scopePath: target.scopePath,
        })),
        scopePages: docs.map(compactDoc),
        personalPages,
      }),
      maxTokens: Math.max(1, runTokenCeiling - counters.tokens),
    },
    actorPrincipalId,
    counters,
    runTokenCeiling,
    monthlyTokenBudget,
    scopePath
  );
  const parsed = parseJsonObjectResult<GraduationOutput>(response.text, { graduations: [] });
  const raw = Array.isArray(parsed.value.graduations) ? parsed.value.graduations : [];
  const proposals = raw
    .map((item) => normalizeGraduationProposal(item, scopePath, personalTargetPaths))
    .filter((item): item is GraduationProposal => !!item);
  const parseFailure = !parsed.ok
    ? outputFailure(counters, parsed.reason ?? "invalid JSON", response.text)
    : raw.length > 0 && proposals.length === 0
      ? outputFailure(counters, "zero usable graduation proposals", response.text)
      : undefined;
  return { proposals, parseFailure };
}

function ensureWikiPageBody(bodyMd: string, now: Date): string {
  const trimmed = bodyMd.trim();
  const withFrontmatter = trimmed.startsWith("---")
    ? trimmed
    : `---\nlearned_at: "${iso(now)}"\nverified_at: "${iso(now)}"\nconfidence: medium\n---\n\n${trimmed}`;
  if (/^## Sources/m.test(withFrontmatter)) return withFrontmatter;
  return `${withFrontmatter}\n\n## Sources\n\n- ambiguous: engine synthesis (${iso(now)})`;
}


async function distillProjectOverview(
  db: DB,
  scope: ScopeInfo,
  since: Date | undefined,
  actorPrincipalId: string,
  deps: BrainDeps,
  counters: EngineCounters,
  runTokenCeiling: number,
  monthlyTokenBudget: number
): Promise<ScopeRunSummary | null> {
  const existing = await getDoc(db, { scopePath: scope.path, slug: "overview" }, actorPrincipalId);
  const inputs = await collectInputs(db, scope.path, since, actorPrincipalId);
  if (inputs.length === 0 && existing) return null;

  const skill = await getSkill(db, { name: WIKI_MAINTENANCE_SKILL }, actorPrincipalId);
  const docs = await loadDocs(db, scope.path, actorPrincipalId);
  const response = await callLlm(
    db,
    deps.llm,
    {
      role: "analysis",
      purpose: "project-overview",
      system: skill.body,
      prompt: promptWithJsonEnvelope("project-overview", {
        reservedSlug: "overview",
        instruction: "Write the project overview page. Cover what this project is, current state, and a recent-activity digest linking to changelog and decision record ids where available.",
        pagePurposeTaxonomy: PAGE_PURPOSE_TAXONOMY,
        scope: { path: scope.path, name: scope.name, type: scope.type },
        since: since?.toISOString() ?? null,
        inputs: inputs.map(compactSource),
        currentPages: docs.map(compactDoc),
        currentOverview: existing ? { title: existing.title, bodyMd: existing.bodyMd.slice(0, 4000) } : null,
      }),
      maxTokens: Math.max(1, runTokenCeiling - counters.tokens),
    },
    actorPrincipalId,
    counters,
    runTokenCeiling,
    monthlyTokenBudget,
    scope.path
  );

  const parsed = parseJsonObjectResult<RootDistillOutput>(response.text, { pages: [] });
  const rawPages = Array.isArray(parsed.value.pages) ? parsed.value.pages : [];
  const usablePages = rawPages.filter(usablePage);
  const page = usablePages.find((candidate) => candidate.slug === "overview");
  const parseFailure = !parsed.ok
    ? outputFailure(counters, parsed.reason ?? "invalid JSON", response.text)
    : !page
      ? outputFailure(counters, "project overview returned no overview page", response.text)
      : null;

  if (!page) {
    return { scopePath: scope.path, inputCount: inputs.length, pagesTouched: 0, recordsDistilled: 0, ...(parseFailure ?? {}) };
  }

  const finalBody = ensureWikiPageBody(page.bodyMd, deps.now ?? new Date());
  if (existing?.bodyMd === finalBody) return parseFailure
    ? { scopePath: scope.path, inputCount: inputs.length, pagesTouched: 0, recordsDistilled: 0, ...parseFailure }
    : null;

  await saveDoc(db, { scopePath: scope.path, slug: "overview", title: page.title, bodyMd: finalBody }, actorPrincipalId);
  counters.pagesTouched += 1;
  return { scopePath: scope.path, inputCount: inputs.length, pagesTouched: 1, recordsDistilled: 0, ...(parseFailure ?? {}) };
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
        .filter((doc) => !isReservedOperationalWikiReportSlug(doc.slug))
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
        pagePurposeTaxonomy: PAGE_PURPOSE_TAXONOMY,
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
  if (docs.length === 0) return { findings: [], graduationProposals: [] };
  const currentDocs = docs.filter((doc) => !isReservedOperationalWikiReportSlug(doc.slug));
  const findings: LintFinding[] = [];
  findings.push(...await fixIndexLinks(db, scopePath, docs, actorPrincipalId));
  findings.push(...await mergeExactDuplicates(db, scopePath, docs, actorPrincipalId));
  findings.push(...staleFindings(currentDocs, deps.now ?? new Date()));

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
        instruction: "Find contradictions only when two existing pages make exact quoted claims about the same entity, property, and timeframe. Use only scalar-mismatch, opposite-boolean, or exclusive-status. Never treat process completion as approval, acceptance, or success. Return a V2 evidence finding with one safe one-page repair for each possible outcome.",
        pages: currentDocs.map(compactDoc),
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
  const validated = rawFindings.map((finding) => validateWikiConflictFinding(finding, scopePath, currentDocs));
  const llmFindings = validated.flatMap((result) => result.finding ? [result.finding] : []);
  const rejectedReasons = validated.flatMap((result) => result.reason ? [result.reason] : []);
  const parseFailure = !parsed.ok
    ? outputFailure(counters, parsed.reason ?? "invalid JSON", response.text)
    : rejectedReasons.length > 0
      ? outputFailure(counters, `unsupported-conflict: ${rejectedReasons[0] ?? "invalid V2 finding"}`, response.text)
      : undefined;
  findings.push(...llmFindings);
  const graduation = await graduationProposalsForScope(
    db,
    scopePath,
    currentDocs,
    actorPrincipalId,
    deps,
    counters,
    runTokenCeiling,
    monthlyTokenBudget
  );

  return { findings, graduationProposals: graduation.proposals, parseFailure: parseFailure ?? graduation.parseFailure };
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
    .filter((slug) => slug !== "wiki" && !isReservedOperationalWikiReportSlug(slug));
  const missing = topicSlugs.filter((slug) => !reachable.has(slug));
  if (missing.length === 0) return [];
  const bodyMd = `${index.bodyMd.trim()}\n\n## Linked topic pages\n\n${missing.map((slug) => `- [[${slug}]]`).join("\n")}\n`;
  await saveDoc(db, { scopePath, slug: "wiki", title: index.title, bodyMd }, actorPrincipalId);
  return missing.map((slug) => ({
    type: "orphan" as const,
    severity: "warning" as const,
    message: `Added ${slug} to the wiki menu so the page is easier to find.`,
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
  for (const doc of docs.filter((row) => row.slug !== "wiki" && !isReservedOperationalWikiReportSlug(row.slug))) {
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
      message: `Removed an extra copy of ${loser.slug}; the matching page remains available.`,
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
    const payload: WikiStalePayloadV2 = {
      version: 2,
      type: "stale",
      slug: doc.slug,
      title: doc.title,
      currentMd: doc.bodyMd,
      reviewDueAt: staleAfter,
    };
    return [{
      type: "stale" as const,
      severity: "warning" as const,
      message: `${doc.title} may need a fresh review because its review date has passed (${staleAfter}).`,
      slugs: [doc.slug],
      action: "flagged" as const,
      payload,
      fingerprint: `v2|stale|${doc.slug}|${staleAfter}`,
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
