/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, desc, eq, gte, inArray, like, lte, or } from "drizzle-orm";
import {
  agentSessions,
  connections,
  contextProfiles,
  scopes,
  usageEvents,
  type ContextProfile,
  type UsageEvent,
} from "@companyos/db";
import { emitEvent, type DB } from "../../kernel/events";
import { requireAccess } from "../../kernel/grants";
import { getScope } from "../../kernel/scopes";
import { ScopeNotFoundError } from "../../errors";

export interface TokenEstimate {
  bytes: number;
  tokens: number;
}

export interface ContextProfileConfig {
  preset?: "lean" | "standard" | "deep" | string;
  recentRecordCount?: number;
  recentRecordPreviewChars?: number;
  wikiDocLimit?: number;
  childLimit?: number;
  taskCount?: number;
  searchResultLimit?: number;
  searchSnippetWords?: number;
  includeSkills?: boolean;
  includeWorkbench?: boolean;
  includeKnowledge?: boolean;
  includeModules?: boolean;
  includeChildren?: boolean;
}

export interface UsageSectionMeasurement {
  name: string;
  bytes: number;
  tokensEst: number;
  itemCount?: number;
}

export interface LogUsageEventInput {
  scopePath?: string | null;
  scopeId?: string | null;
  principalId?: string | null;
  tokenId?: string | null;
  sessionId?: string | null;
  connectionId?: string | null;
  source: string;
  engine?: string | null;
  model?: string | null;
  operation: string;
  inputTokensEst?: number | null;
  outputTokensEst?: number | null;
  totalTokensEst?: number | null;
  actualInputTokens?: number | null;
  actualOutputTokens?: number | null;
  actualCostUsd?: string | number | null;
  byteIn?: number | null;
  byteOut?: number | null;
  latencyMs?: number | null;
  success: boolean;
  errorCode?: string | null;
  metadata?: Record<string, unknown>;
}

export interface QueryUsageInput {
  scope?: string | null;
  since?: Date | string | null;
  until?: Date | string | null;
  groupBy?: "operation" | "scope" | "principal" | "token" | "connection" | "session" | "source" | "model" | "success";
  operation?: string | null;
  sessionId?: string | null;
  principalId?: string | null;
  tokenId?: string | null;
  connectionId?: string | null;
  limit?: number;
}

export interface UsageSummaryRow {
  key: string;
  calls: number;
  successCount: number;
  errorCount: number;
  inputTokensEst: number;
  outputTokensEst: number;
  totalTokensEst: number;
  byteIn: number;
  byteOut: number;
  latencyMs: number;
}

export interface QueryUsageResult {
  estimated: true;
  groupBy: string;
  rows: UsageSummaryRow[];
  events: Array<UsageEvent & { scopePath?: string | null }>;
}

const DEFAULT_CONTEXT_PROFILE: Required<ContextProfileConfig> = {
  preset: "standard",
  recentRecordCount: 10,
  recentRecordPreviewChars: 200,
  wikiDocLimit: 20,
  childLimit: 50,
  taskCount: 10,
  searchResultLimit: 10,
  searchSnippetWords: 35,
  includeSkills: true,
  includeWorkbench: true,
  includeKnowledge: true,
  includeModules: true,
  includeChildren: true,
};

const PRESET_CONFIGS: Record<"lean" | "standard" | "deep", Required<ContextProfileConfig>> = {
  lean: {
    ...DEFAULT_CONTEXT_PROFILE,
    preset: "lean",
    recentRecordCount: 3,
    recentRecordPreviewChars: 80,
    wikiDocLimit: 5,
    childLimit: 10,
    taskCount: 3,
    searchResultLimit: 5,
    searchSnippetWords: 18,
    includeSkills: false,
    includeWorkbench: true,
    includeKnowledge: true,
    includeModules: true,
    includeChildren: true,
  },
  standard: DEFAULT_CONTEXT_PROFILE,
  deep: {
    ...DEFAULT_CONTEXT_PROFILE,
    preset: "deep",
    recentRecordCount: 25,
    recentRecordPreviewChars: 500,
    wikiDocLimit: 100,
    childLimit: 200,
    taskCount: 25,
    searchResultLimit: 25,
    searchSnippetWords: 60,
    includeSkills: true,
    includeWorkbench: true,
    includeKnowledge: true,
    includeModules: true,
    includeChildren: true,
  },
};

const SENSITIVE_KEY = /(authorization|bearer|token|secret|password|credential|value|prompt|response|body_md|bodyMd|body|markdown|content|plaintext)/i;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function safeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeMetadataValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.startsWith("cos_") || /^Bearer\s+/i.test(value)) return "[redacted]";
    return value.length > 160 ? `${value.slice(0, 160)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeMetadataValue(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = sanitizeMetadataValue(nested, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export function sanitizeUsageMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return sanitizeMetadataValue(metadata) as Record<string, unknown>;
}

export function estimateTokens(text: string | null | undefined): TokenEstimate {
  const value = text || "";
  const bytes = byteLength(value);
  if (bytes === 0) return { bytes: 0, tokens: 0 };
  const roughSegments = value.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) || [];
  const wordPieces = roughSegments.reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / 4)), 0);
  const byteFloor = Math.ceil(bytes / 4);
  return { bytes, tokens: Math.max(byteFloor, wordPieces) };
}

export function measureSection(name: string, text: string, itemCount?: number): UsageSectionMeasurement {
  const estimate = estimateTokens(text);
  return { name, bytes: estimate.bytes, tokensEst: estimate.tokens, ...(itemCount === undefined ? {} : { itemCount }) };
}

export function contextProfileConfig(config: Record<string, unknown> | null | undefined): Required<ContextProfileConfig> {
  const presetName = config?.preset === "lean" || config?.preset === "deep" || config?.preset === "standard"
    ? config.preset
    : "standard";
  const preset = PRESET_CONFIGS[presetName];
  return {
    preset: String(config?.preset || preset.preset),
    recentRecordCount: clampInt(config?.recentRecordCount, preset.recentRecordCount, 0, 100),
    recentRecordPreviewChars: clampInt(config?.recentRecordPreviewChars, preset.recentRecordPreviewChars, 0, 2000),
    wikiDocLimit: clampInt(config?.wikiDocLimit, preset.wikiDocLimit, 0, 500),
    childLimit: clampInt(config?.childLimit, preset.childLimit, 0, 500),
    taskCount: clampInt(config?.taskCount, preset.taskCount, 0, 100),
    searchResultLimit: clampInt(config?.searchResultLimit, preset.searchResultLimit, 1, 50),
    searchSnippetWords: clampInt(config?.searchSnippetWords, preset.searchSnippetWords, 5, 100),
    includeSkills: safeBoolean(config?.includeSkills, preset.includeSkills),
    includeWorkbench: safeBoolean(config?.includeWorkbench, preset.includeWorkbench),
    includeKnowledge: safeBoolean(config?.includeKnowledge, preset.includeKnowledge),
    includeModules: safeBoolean(config?.includeModules, preset.includeModules),
    includeChildren: safeBoolean(config?.includeChildren, preset.includeChildren),
  };
}

export function presetContextProfileConfig(preset: "lean" | "standard" | "deep"): Required<ContextProfileConfig> {
  return PRESET_CONFIGS[preset];
}

function estimateProfileTokens(config: Required<ContextProfileConfig>): number {
  let tokens = 90;
  if (config.includeModules) tokens += 20;
  if (config.includeChildren) tokens += config.childLimit * 5;
  if (config.includeWorkbench) tokens += 60;
  if (config.includeKnowledge) tokens += config.wikiDocLimit * 8;
  if (config.includeSkills) tokens += 180;
  tokens += config.recentRecordCount * Math.max(8, Math.ceil(config.recentRecordPreviewChars / 4));
  return tokens;
}

export function contextProfileImpact(config: Record<string, unknown>): { estimatedTokens: number; comparedToStandard: number } {
  const normalized = contextProfileConfig(config);
  const standardTokens = estimateProfileTokens(DEFAULT_CONTEXT_PROFILE);
  const estimatedTokens = estimateProfileTokens(normalized);
  return { estimatedTokens, comparedToStandard: estimatedTokens - standardTokens };
}

async function scopeIdForPath(db: DB, scopePath: string | null | undefined): Promise<string | null> {
  if (!scopePath) return null;
  const [scope] = await db.select({ id: scopes.id }).from(scopes).where(eq(scopes.path, scopePath)).limit(1);
  return scope?.id ?? null;
}

async function connectionIdForToken(db: DB, tokenId: string | null | undefined): Promise<string | null> {
  if (!tokenId) return null;
  const [row] = await db.select({ id: connections.id }).from(connections).where(eq(connections.tokenId, tokenId)).limit(1);
  return row?.id ?? null;
}

async function scopeIdForSession(db: DB, sessionId: string | null | undefined): Promise<string | null> {
  if (!sessionId) return null;
  const [row] = await db.select({ scopeId: agentSessions.scopeId }).from(agentSessions).where(eq(agentSessions.id, sessionId)).limit(1);
  return row?.scopeId ?? null;
}

function numericOrNull(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : null;
}

export async function logUsageEvent(db: DB, input: LogUsageEventInput): Promise<void> {
  const scopeId = input.scopeId ?? await scopeIdForPath(db, input.scopePath ?? null) ?? await scopeIdForSession(db, input.sessionId ?? null);
  const connectionId = input.connectionId ?? await connectionIdForToken(db, input.tokenId ?? null);
  const inputTokens = input.inputTokensEst ?? null;
  const outputTokens = input.outputTokensEst ?? null;
  const totalTokens = input.totalTokensEst ?? (
    inputTokens !== null || outputTokens !== null ? (inputTokens ?? 0) + (outputTokens ?? 0) : null
  );

  await db.insert(usageEvents).values({
    scopeId,
    principalId: input.principalId ?? null,
    tokenId: input.tokenId ?? null,
    sessionId: input.sessionId ?? null,
    connectionId,
    source: input.source,
    engine: input.engine ?? null,
    model: input.model ?? null,
    operation: input.operation,
    inputTokensEst: inputTokens,
    outputTokensEst: outputTokens,
    totalTokensEst: totalTokens,
    actualInputTokens: input.actualInputTokens ?? null,
    actualOutputTokens: input.actualOutputTokens ?? null,
    actualCostUsd: numericOrNull(input.actualCostUsd),
    byteIn: Math.max(0, Math.trunc(input.byteIn ?? 0)),
    byteOut: Math.max(0, Math.trunc(input.byteOut ?? 0)),
    latencyMs: Math.max(0, Math.trunc(input.latencyMs ?? 0)),
    success: input.success,
    errorCode: input.errorCode ?? null,
    metadata: sanitizeUsageMetadata(input.metadata ?? {}),
  });
}

export async function logUsageEventSafely(db: DB, input: LogUsageEventInput): Promise<void> {
  try {
    await logUsageEvent(db, input);
  } catch (error) {
    if (process.env.USAGE_DEBUG === "1") {
      console.error("[usage] failed to log usage event:", error instanceof Error ? error.message : String(error));
    }
  }
}

function subtreeCondition(scopePath: string) {
  return scopePath === "root"
    ? like(scopes.path, "%")
    : or(eq(scopes.path, scopePath), like(scopes.path, `${scopePath}/%`));
}

function eventGroupKey(row: UsageEvent & { scopePath?: string | null }, groupBy: QueryUsageInput["groupBy"]): string {
  switch (groupBy) {
    case "scope": return row.scopePath || row.scopeId || "(none)";
    case "principal": return row.principalId || "(none)";
    case "token": return row.tokenId || "(none)";
    case "connection": return row.connectionId || "(none)";
    case "session": return row.sessionId || "(none)";
    case "source": return row.source || "(none)";
    case "model": return row.model || row.engine || "(none)";
    case "success": return row.success ? "success" : "error";
    case "operation":
    default: return row.operation;
  }
}

function addSummary(map: Map<string, UsageSummaryRow>, key: string, row: UsageEvent): void {
  const existing = map.get(key) || {
    key,
    calls: 0,
    successCount: 0,
    errorCount: 0,
    inputTokensEst: 0,
    outputTokensEst: 0,
    totalTokensEst: 0,
    byteIn: 0,
    byteOut: 0,
    latencyMs: 0,
  };
  existing.calls += 1;
  if (row.success) existing.successCount += 1;
  else existing.errorCount += 1;
  existing.inputTokensEst += row.inputTokensEst ?? 0;
  existing.outputTokensEst += row.outputTokensEst ?? 0;
  existing.totalTokensEst += row.totalTokensEst ?? 0;
  existing.byteIn += row.byteIn ?? 0;
  existing.byteOut += row.byteOut ?? 0;
  existing.latencyMs += row.latencyMs ?? 0;
  map.set(key, existing);
}

export async function queryUsage(
  db: DB,
  input: QueryUsageInput,
  actorPrincipalId: string
): Promise<QueryUsageResult> {
  const scopePath = input.scope?.trim() || "root";
  const scope = await getScope(db, scopePath);
  if (!scope) throw new ScopeNotFoundError(scopePath);
  await requireAccess(db, actorPrincipalId, scopePath, "admin");

  const conditions: any[] = [subtreeCondition(scopePath)];
  if (input.since) conditions.push(gte(usageEvents.createdAt, new Date(input.since)));
  if (input.until) conditions.push(lte(usageEvents.createdAt, new Date(input.until)));
  if (input.operation) conditions.push(eq(usageEvents.operation, input.operation));
  if (input.sessionId) conditions.push(eq(usageEvents.sessionId, input.sessionId));
  if (input.principalId) conditions.push(eq(usageEvents.principalId, input.principalId));
  if (input.tokenId) conditions.push(eq(usageEvents.tokenId, input.tokenId));
  if (input.connectionId) conditions.push(eq(usageEvents.connectionId, input.connectionId));

  const rows = (await db
    .select({
      id: usageEvents.id,
      scopeId: usageEvents.scopeId,
      principalId: usageEvents.principalId,
      tokenId: usageEvents.tokenId,
      sessionId: usageEvents.sessionId,
      connectionId: usageEvents.connectionId,
      source: usageEvents.source,
      engine: usageEvents.engine,
      model: usageEvents.model,
      operation: usageEvents.operation,
      inputTokensEst: usageEvents.inputTokensEst,
      outputTokensEst: usageEvents.outputTokensEst,
      totalTokensEst: usageEvents.totalTokensEst,
      actualInputTokens: usageEvents.actualInputTokens,
      actualOutputTokens: usageEvents.actualOutputTokens,
      actualCostUsd: usageEvents.actualCostUsd,
      byteIn: usageEvents.byteIn,
      byteOut: usageEvents.byteOut,
      latencyMs: usageEvents.latencyMs,
      success: usageEvents.success,
      errorCode: usageEvents.errorCode,
      metadata: usageEvents.metadata,
      createdAt: usageEvents.createdAt,
      scopePath: scopes.path,
    })
    .from(usageEvents)
    .innerJoin(scopes, eq(usageEvents.scopeId, scopes.id))
    .where(and(...conditions))
    .orderBy(desc(usageEvents.createdAt))
    .limit(Math.min(Math.max(1, input.limit ?? 500), 1000))) as Array<UsageEvent & { scopePath: string }>;

  const groupBy = input.groupBy || "operation";
  const summaries = new Map<string, UsageSummaryRow>();
  for (const row of rows) {
    addSummary(summaries, eventGroupKey(row, groupBy), row);
  }

  return {
    estimated: true,
    groupBy,
    rows: Array.from(summaries.values()).sort((a, b) => b.totalTokensEst - a.totalTokensEst || b.calls - a.calls),
    events: rows.slice(0, Math.min(Math.max(1, input.limit ?? 100), 200)),
  };
}

function ancestorPaths(scopePath: string): string[] {
  if (scopePath === "root") return ["root"];
  const parts = scopePath.split("/").filter(Boolean);
  return [...parts.map((_, idx) => parts.slice(0, parts.length - idx).join("/")), "root"];
}

export async function resolveContextProfile(
  db: DB,
  scopePath: string
): Promise<{ profile: ContextProfile | null; config: Required<ContextProfileConfig>; impact: { estimatedTokens: number; comparedToStandard: number } }> {
  const paths = ancestorPaths(scopePath);
  const scopeRows = (await db
    .select({ id: scopes.id, path: scopes.path })
    .from(scopes)
    .where(inArray(scopes.path, paths))) as Array<{ id: string; path: string }>;
  const idsByPath = new Map(scopeRows.map((row) => [row.path, row.id]));
  const orderedIds = paths.map((path) => idsByPath.get(path)).filter(Boolean) as string[];

  let profile: ContextProfile | null = null;
  if (orderedIds.length) {
    const profiles = (await db
      .select()
      .from(contextProfiles)
      .where(and(inArray(contextProfiles.scopeId, orderedIds), eq(contextProfiles.isDefault, true)))) as ContextProfile[];
    profile = profiles.sort((a, b) => orderedIds.indexOf(a.scopeId || "") - orderedIds.indexOf(b.scopeId || ""))[0] ?? null;
  }

  const config = contextProfileConfig(profile?.config ?? DEFAULT_CONTEXT_PROFILE);
  return { profile, config, impact: contextProfileImpact(config) };
}

export async function getContextProfile(
  db: DB,
  input: { scopePath: string },
  actorPrincipalId: string
) {
  const scopePath = input.scopePath.trim();
  const scope = await getScope(db, scopePath);
  if (!scope) throw new ScopeNotFoundError(scopePath);
  await requireAccess(db, actorPrincipalId, scopePath, "admin");
  return resolveContextProfile(db, scopePath);
}

export async function setContextProfile(
  db: DB,
  input: { scopePath: string; name: string; preset?: "lean" | "standard" | "deep"; config?: Record<string, unknown>; isDefault?: boolean },
  actorPrincipalId: string
) {
  const scopePath = input.scopePath.trim();
  const scope = await getScope(db, scopePath);
  if (!scope) throw new ScopeNotFoundError(scopePath);
  await requireAccess(db, actorPrincipalId, scopePath, "admin");

  const name = input.name.trim();
  if (!name) throw new Error("Context profile name is required");
  const baseConfig = input.preset ? presetContextProfileConfig(input.preset) : {};
  const config = contextProfileConfig({ ...baseConfig, ...(input.config || {}) });
  const isDefault = input.isDefault ?? true;
  const now = new Date();

  return db.transaction(async (tx: DB) => {
    if (isDefault) {
      await tx
        .update(contextProfiles)
        .set({ isDefault: false, updatedAt: now })
        .where(eq(contextProfiles.scopeId, scope.id));
    }

    const [existing] = (await tx
      .select()
      .from(contextProfiles)
      .where(and(eq(contextProfiles.scopeId, scope.id), eq(contextProfiles.name, name)))
      .limit(1)) as ContextProfile[];

    let profile: ContextProfile;
    if (existing) {
      const [updated] = (await tx
        .update(contextProfiles)
        .set({ config, isDefault, updatedAt: now })
        .where(eq(contextProfiles.id, existing.id))
        .returning()) as ContextProfile[];
      if (!updated) throw new Error("Failed to update context profile");
      profile = updated;
    } else {
      const [created] = (await tx
        .insert(contextProfiles)
        .values({ scopeId: scope.id, name, config, isDefault, createdBy: actorPrincipalId, updatedAt: now })
        .returning()) as ContextProfile[];
      if (!created) throw new Error("Failed to create context profile");
      profile = created;
    }

    await emitEvent(tx, {
      type: "usage.profile_updated",
      scopePath,
      principalId: actorPrincipalId,
      payload: {
        scopePath,
        profileId: profile.id,
        name: profile.name,
        isDefault: profile.isDefault,
        estimatedTokenImpact: contextProfileImpact(config),
      },
    });

    return { profile, config, impact: contextProfileImpact(config) };
  });
}

export async function usageRecommendations(
  db: DB,
  input: { scopePath: string; since?: Date | string | null },
  actorPrincipalId: string
): Promise<string[]> {
  const result = await queryUsage(db, { scope: input.scopePath, since: input.since, groupBy: "operation", limit: 500 }, actorPrincipalId);
  const total = result.rows.reduce((sum, row) => sum + row.totalTokensEst, 0);
  const recommendations: string[] = [];
  for (const row of result.rows) {
    if (total > 0 && row.key.startsWith("get_context") && row.totalTokensEst / total > 0.4) {
      recommendations.push(`get_context contributes ${Math.round((row.totalTokensEst / total) * 100)}% of estimated tokens; try the lean profile on this subtree.`);
    }
    if (row.key === "search" && row.outputTokensEst > 10_000) {
      recommendations.push("search returned high estimated snippet volume; lower searchResultLimit or searchSnippetWords.");
    }
  }
  return recommendations.slice(0, 5);
}

export { DEFAULT_CONTEXT_PROFILE };
