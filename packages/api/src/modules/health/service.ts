/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import {
  capabilities,
  capabilityRuns,
  events,
  externalCredentials,
  grants,
  opsAlertState,
  principals,
  scopes,
  skillsIndex,
  tokens,
  type CapabilityRun,
  type ExternalCredential,
} from "@companyos/db";
import { emitEvent, type DB } from "../../kernel/events";
import { requireAccess } from "../../kernel/grants";
import { getScope } from "../../kernel/scopes";
import { ScopeNotFoundError } from "../../errors";

export type HealthStatus = "ok" | "warning" | "error" | "unknown";
export type HealthComponentKind =
  | "token"
  | "external_credential"
  | "capability"
  | "llm_key"
  | "webhook"
  | "skills"
  | "deploy"
  | "backup";

export interface OpsHealthCheck {
  key: string;
  component: string;
  kind: HealthComponentKind;
  status: HealthStatus;
  lastCheckedAt: Date;
  lastActivityAt: Date | null;
  expiryAt: Date | null;
  nextExpectedAt: Date | null;
  latestError: string | null;
  detail: string;
  href: string | null;
}

export interface OpsRunLogRow {
  id: string;
  scopePath: string;
  capability: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  summary: string | null;
  latestError: string | null;
  tokenSpend: number | null;
  href: string | null;
}

export interface WikiContributionDay {
  date: string;
  saves: number;
  verifies: number;
}

export interface OpsHealthResult {
  checks: OpsHealthCheck[];
  runs: OpsRunLogRow[];
  wikiContributions: WikiContributionDay[];
  alerts: Array<{
    checkKey: string;
    status: "warning" | "error";
    message: string;
    emailSent: boolean;
  }>;
  generatedAt: Date;
}

export interface OpsHealthEnvironment {
  brainCronEnabled?: boolean;
  githubWebhookConfigured?: boolean;
  planeWebhookConfigured?: boolean;
  planeApiConfigured?: boolean;
  litellmBaseUrl?: string | null;
  litellmEmbedKeyConfigured?: boolean;
  brainLiteLlmKeyConfigured?: boolean;
  smtpConfigured?: boolean;
  dailyDigestEnabled?: boolean;
}

export interface LlmProbeResult {
  ok: boolean;
  checkedAt?: Date;
  error?: string | null;
}

export interface OpsHealthDeps {
  llmProbe?: (keyName: "LITELLM_EMBED_KEY" | "BRAIN_LITELLM_API_KEY") => Promise<LlmProbeResult>;
  sendEmail?: (message: OpsHealthEmail) => Promise<void>;
}

export interface OpsHealthEmail {
  to: string[];
  subject: string;
  text: string;
}

export interface GetOpsHealthInput {
  now?: Date;
  env?: OpsHealthEnvironment;
  sendAlerts?: boolean;
  dailyDigest?: boolean;
  runStatus?: string;
}

export interface RegisterExternalCredentialInput {
  name: string;
  component: string;
  ownerNote?: string;
  whereItLives?: string;
  expiresAt?: Date | string | null;
  status?: string;
  metadata?: Record<string, unknown>;
  scopePath?: string | null;
}

const ROOT_SCOPE = "root";
const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_WARN_MS = 14 * DAY_MS;
const BRAIN_OVERDUE_MS = 36 * 60 * 60 * 1000;
const WEEKLY_EXPECTED_MS = 7 * DAY_MS;
const RUN_LOG_CAPABILITIES = ["brain-engine", "skills-sync", "provisioning", "staging-deploy-migrate", "backups"];

function severityRank(status: HealthStatus): number {
  return { ok: 0, unknown: 1, warning: 2, error: 3 }[status];
}

function normalizeDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

function daysUntil(now: Date, expiry: Date): number {
  return Math.ceil((expiry.getTime() - now.getTime()) / DAY_MS);
}

function expiryStatus(now: Date, expiry: Date | null): HealthStatus {
  if (!expiry) return "unknown";
  const delta = expiry.getTime() - now.getTime();
  if (delta <= 0) return "error";
  if (delta <= EXPIRY_WARN_MS) return "warning";
  return "ok";
}

function expiryDetail(now: Date, expiry: Date | null): string {
  if (!expiry) return "No expiry registered";
  const days = daysUntil(now, expiry);
  if (days <= 0) return "Expired";
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

function nextExpected(last: Date | null, cadenceMs: number): Date | null {
  return last ? new Date(last.getTime() + cadenceMs) : null;
}

function livenessStatus(now: Date, last: Date | null, cadenceMs: number, enabled = true): HealthStatus {
  if (!enabled) return "unknown";
  if (!last) return "error";
  return now.getTime() - last.getTime() > cadenceMs ? "error" : "ok";
}

function livenessDetail(now: Date, last: Date | null, cadenceMs: number, enabled = true): string {
  if (!enabled) return "Profile/config is not enabled";
  if (!last) return "No run has been reported";
  const overdueMs = now.getTime() - last.getTime() - cadenceMs;
  if (overdueMs <= 0) return "Recent activity reported";
  const hours = Math.ceil(overdueMs / (60 * 60 * 1000));
  return `Overdue by ${hours} hour${hours === 1 ? "" : "s"}`;
}

function payloadError(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) return null;
  const direct = payload.error || payload.errorMessage || payload.message;
  return typeof direct === "string" && direct.trim() ? direct : null;
}

function runError(run: CapabilityRun | null): string | null {
  if (!run) return null;
  if (run.status !== "error") return null;
  return payloadError(run.payload) || run.summary || "Run failed";
}

function tokenSpend(payload: Record<string, unknown>): number | null {
  const candidates = [payload.tokens, payload.totalTokens, payload.totalTokensEst, payload.tokenSpend];
  const found = candidates.find((value) => typeof value === "number" && Number.isFinite(value));
  return typeof found === "number" ? Math.trunc(found) : null;
}

function runHref(name: string): string | null {
  if (name === "brain-engine") return "/brain/engine";
  if (name === "provisioning") return "/admin/intake";
  return "/admin/health";
}

async function requireRootAdmin(db: DB, actorPrincipalId: string): Promise<void> {
  const root = await getScope(db, ROOT_SCOPE);
  if (!root) throw new ScopeNotFoundError(ROOT_SCOPE);
  await requireAccess(db, actorPrincipalId, ROOT_SCOPE, "admin");
}

async function activeRootAdminEmails(db: DB): Promise<string[]> {
  const [root] = await db.select({ id: scopes.id }).from(scopes).where(eq(scopes.path, ROOT_SCOPE)).limit(1);
  if (!root) return [];
  const rows = (await db
    .select({ email: principals.email })
    .from(grants)
    .innerJoin(principals, eq(grants.principalId, principals.id))
    .where(and(eq(grants.scopeId, root.id), inArray(grants.role, ["owner", "admin"]), eq(principals.status, "active")))) as Array<{ email: string | null }>;
  return Array.from(new Set(rows.map((row) => row.email).filter((email): email is string => !!email)));
}

async function latestCapabilityRun(db: DB, name: string): Promise<(CapabilityRun & { scopePath: string; capabilityName: string }) | null> {
  const [row] = (await db
    .select({
      id: capabilityRuns.id,
      capabilityId: capabilityRuns.capabilityId,
      runRef: capabilityRuns.runRef,
      status: capabilityRuns.status,
      startedAt: capabilityRuns.startedAt,
      finishedAt: capabilityRuns.finishedAt,
      durationMs: capabilityRuns.durationMs,
      summary: capabilityRuns.summary,
      payload: capabilityRuns.payload,
      createdAt: capabilityRuns.createdAt,
      scopePath: scopes.path,
      capabilityName: capabilities.name,
    })
    .from(capabilityRuns)
    .innerJoin(capabilities, eq(capabilityRuns.capabilityId, capabilities.id))
    .innerJoin(scopes, eq(capabilities.scopeId, scopes.id))
    .where(eq(capabilities.name, name))
    .orderBy(desc(capabilityRuns.startedAt))
    .limit(1)) as Array<CapabilityRun & { scopePath: string; capabilityName: string }>;
  return row || null;
}

async function latestEvent(db: DB, types: string[]): Promise<{ createdAt: Date; payload: Record<string, unknown>; type: string } | null> {
  const [row] = (await db
    .select({ createdAt: events.createdAt, payload: events.payload, type: events.type })
    .from(events)
    .where(inArray(events.type, types))
    .orderBy(desc(events.createdAt))
    .limit(1)) as Array<{ createdAt: Date; payload: Record<string, unknown>; type: string }>;
  return row || null;
}

async function latestEventMatchingPayload(db: DB, type: string, key: string, value: string): Promise<{ createdAt: Date; payload: Record<string, unknown>; type: string } | null> {
  const [row] = (await db
    .select({ createdAt: events.createdAt, payload: events.payload, type: events.type })
    .from(events)
    .where(and(eq(events.type, type), sql`${events.payload}->>${key} = ${value}`))
    .orderBy(desc(events.createdAt))
    .limit(1)) as Array<{ createdAt: Date; payload: Record<string, unknown>; type: string }>;
  return row || null;
}

async function tokenCheck(db: DB, now: Date, tokenName: string, label: string): Promise<OpsHealthCheck> {
  const [row] = (await db
    .select({
      id: tokens.id,
      name: tokens.name,
      expiresAt: tokens.expiresAt,
      lastUsedAt: tokens.lastUsedAt,
      createdAt: tokens.createdAt,
    })
    .from(tokens)
    .where(and(eq(tokens.name, tokenName), isNull(tokens.revokedAt), or(isNull(tokens.expiresAt), gte(tokens.expiresAt, new Date(0)))))
    .orderBy(tokens.expiresAt)
    .limit(1)) as Array<{ id: string; name: string; expiresAt: Date | null; lastUsedAt: Date | null; createdAt: Date }>;
  const status = row ? expiryStatus(now, row.expiresAt) : "unknown";
  return {
    key: `token:${tokenName}`,
    component: label,
    kind: "token",
    status,
    lastCheckedAt: now,
    lastActivityAt: row?.lastUsedAt ?? row?.createdAt ?? null,
    expiryAt: row?.expiresAt ?? null,
    nextExpectedAt: null,
    latestError: row ? null : "No active token row found",
    detail: row ? expiryDetail(now, row.expiresAt) : "No active token row found",
    href: "/admin/mcp",
  };
}

function externalCredentialCheck(now: Date, credential: ExternalCredential): OpsHealthCheck {
  const status = credential.status === "active" ? expiryStatus(now, credential.expiresAt) : "unknown";
  return {
    key: `external-credential:${credential.name}`,
    component: credential.name,
    kind: "external_credential",
    status,
    lastCheckedAt: now,
    lastActivityAt: credential.updatedAt,
    expiryAt: credential.expiresAt,
    nextExpectedAt: null,
    latestError: null,
    detail: `${expiryDetail(now, credential.expiresAt)}. ${credential.whereItLives}`,
    href: "/admin/health",
  };
}

async function capabilityCheck(db: DB, now: Date, name: string, label: string, cadenceMs: number, enabled = true): Promise<OpsHealthCheck> {
  const run = await latestCapabilityRun(db, name);
  const lastActivity = run?.finishedAt ?? run?.startedAt ?? null;
  const status = run?.status === "error" ? "error" : livenessStatus(now, lastActivity, cadenceMs, enabled);
  return {
    key: `capability:${name}`,
    component: label,
    kind: name === "staging-deploy-migrate" ? "deploy" : name === "backups" ? "backup" : "capability",
    status,
    lastCheckedAt: now,
    lastActivityAt: lastActivity,
    expiryAt: null,
    nextExpectedAt: nextExpected(lastActivity, cadenceMs),
    latestError: runError(run),
    detail: run?.status === "error" ? "Latest run failed" : livenessDetail(now, lastActivity, cadenceMs, enabled),
    href: runHref(name),
  };
}

async function skillsSyncCheck(db: DB, now: Date): Promise<OpsHealthCheck> {
  const [latestSkill] = (await db
    .select({ syncedAt: skillsIndex.syncedAt })
    .from(skillsIndex)
    .orderBy(desc(skillsIndex.syncedAt))
    .limit(1)) as Array<{ syncedAt: Date }>;
  const failed = await latestEvent(db, ["skills.repo_push_failed"]);
  const synced = await latestEvent(db, ["skills.synced", "skills.repo_push_synced"]);
  const lastActivity = latestSkill?.syncedAt ?? synced?.createdAt ?? null;
  const latestFailureAfterSync = failed && (!lastActivity || failed.createdAt.getTime() >= lastActivity.getTime()) ? failed : null;
  const status = latestFailureAfterSync ? "error" : livenessStatus(now, lastActivity, WEEKLY_EXPECTED_MS, true) === "error" ? "warning" : (lastActivity ? "ok" : "unknown");
  return {
    key: "skills:sync",
    component: "skills sync",
    kind: "skills",
    status,
    lastCheckedAt: now,
    lastActivityAt: lastActivity,
    expiryAt: null,
    nextExpectedAt: nextExpected(lastActivity, WEEKLY_EXPECTED_MS),
    latestError: latestFailureAfterSync ? payloadError(latestFailureAfterSync.payload) || "Latest skills sync failed" : null,
    detail: latestFailureAfterSync ? "Latest skills sync failed" : lastActivity ? "Skills index has recent sync data" : "No skills sync recorded",
    href: "/admin/intake",
  };
}

async function webhookCheck(
  db: DB,
  now: Date,
  key: string,
  label: string,
  configured: boolean | undefined,
  eventTypes: string[],
  failureEvent?: { type: string; key: string; value: string }
): Promise<OpsHealthCheck> {
  const latest = await latestEvent(db, eventTypes);
  const failure = failureEvent ? await latestEventMatchingPayload(db, failureEvent.type, failureEvent.key, failureEvent.value) : null;
  const latestFailureAfterActivity = failure && (!latest || failure.createdAt.getTime() >= latest.createdAt.getTime()) ? failure : null;
  let status: HealthStatus = "unknown";
  if (configured === false) {
    status = "warning";
  } else if (latestFailureAfterActivity) {
    status = "warning";
  } else if (latest) {
    status = now.getTime() - latest.createdAt.getTime() > WEEKLY_EXPECTED_MS ? "warning" : "ok";
  }
  return {
    key: `webhook:${key}`,
    component: label,
    kind: "webhook",
    status,
    lastCheckedAt: now,
    lastActivityAt: latest?.createdAt ?? null,
    expiryAt: null,
    nextExpectedAt: nextExpected(latest?.createdAt ?? null, WEEKLY_EXPECTED_MS),
    latestError: latestFailureAfterActivity ? payloadError(latestFailureAfterActivity.payload) || "Latest webhook handling failed/unhandled" : configured === false ? "Webhook secret/API config is missing" : null,
    detail: configured === false ? "Webhook config missing" : latest ? `Latest delivery event: ${latest.type}` : "No webhook delivery recorded",
    href: "/admin/health",
  };
}

async function llmKeyCheck(
  now: Date,
  keyName: "LITELLM_EMBED_KEY" | "BRAIN_LITELLM_API_KEY",
  configured: boolean | undefined,
  probe?: OpsHealthDeps["llmProbe"]
): Promise<OpsHealthCheck> {
  if (!configured) {
    return {
      key: `llm:${keyName}`,
      component: keyName,
      kind: "llm_key",
      status: "warning",
      lastCheckedAt: now,
      lastActivityAt: null,
      expiryAt: null,
      nextExpectedAt: null,
      latestError: "Environment key is not configured",
      detail: "LLM key is missing",
      href: "/admin/health",
    };
  }
  if (!probe) {
    return {
      key: `llm:${keyName}`,
      component: keyName,
      kind: "llm_key",
      status: "unknown",
      lastCheckedAt: now,
      lastActivityAt: null,
      expiryAt: null,
      nextExpectedAt: null,
      latestError: null,
      detail: "No LLM probe configured for this environment",
      href: "/admin/health",
    };
  }
  const result = await probe(keyName).catch((error: unknown) => ({
    ok: false,
    checkedAt: now,
    error: error instanceof Error ? error.message : String(error),
  }));
  return {
    key: `llm:${keyName}`,
    component: keyName,
    kind: "llm_key",
    status: result.ok ? "ok" : "error",
    lastCheckedAt: now,
    lastActivityAt: result.checkedAt ?? now,
    expiryAt: null,
    nextExpectedAt: null,
    latestError: result.ok ? null : result.error || "LLM probe failed",
    detail: result.ok ? "LiteLLM probe succeeded" : "LiteLLM probe failed",
    href: "/admin/health",
  };
}

function alertSeverity(status: "warning" | "error"): "warning" | "critical" {
  return status === "error" ? "critical" : "warning";
}

async function upsertAlertState(db: DB, check: OpsHealthCheck, emailSent: boolean): Promise<void> {
  await db.insert(opsAlertState).values({
    checkKey: check.key,
    status: check.status,
    message: check.latestError || check.detail,
    lastAlertedAt: check.status === "warning" || check.status === "error" ? check.lastCheckedAt : null,
    emailSent,
    metadata: { component: check.component, kind: check.kind },
    updatedAt: check.lastCheckedAt,
  }).onConflictDoUpdate({
    target: opsAlertState.checkKey,
    set: {
      status: check.status,
      message: check.latestError || check.detail,
      lastAlertedAt: check.status === "warning" || check.status === "error" ? check.lastCheckedAt : null,
      emailSent,
      metadata: { component: check.component, kind: check.kind },
      updatedAt: check.lastCheckedAt,
    },
  });
}

async function maybeAlert(
  db: DB,
  checks: OpsHealthCheck[],
  actorPrincipalId: string,
  deps: OpsHealthDeps,
  sendAlerts: boolean,
  dailyDigest: boolean,
): Promise<OpsHealthResult["alerts"]> {
  const alerts: OpsHealthResult["alerts"] = [];
  if (!sendAlerts) return alerts;
  const recipients = await activeRootAdminEmails(db);
  for (const check of checks) {
    if (check.status !== "warning" && check.status !== "error") {
      await upsertAlertState(db, check, false);
      continue;
    }

    const [previous] = (await db
      .select()
      .from(opsAlertState)
      .where(eq(opsAlertState.checkKey, check.key))
      .limit(1)) as Array<{ status: string }>;
    const transitioned = !previous || previous.status !== check.status;
    if (!transitioned) {
      await upsertAlertState(db, check, false);
      continue;
    }

    const message = `${check.component}: ${check.latestError || check.detail}`;
    let emailSent = false;
    if (deps.sendEmail && recipients.length > 0) {
      try {
        await deps.sendEmail({
          to: recipients,
          subject: `[CompanyOS] ${check.status.toUpperCase()} ${check.component}`,
          text: `${message}\n\nStatus: ${check.status}\nLast activity: ${check.lastActivityAt ? check.lastActivityAt.toISOString() : "none"}\nNext expected: ${check.nextExpectedAt ? check.nextExpectedAt.toISOString() : "n/a"}`,
        });
        emailSent = true;
      } catch (error) {
        await emitEvent(db, {
          type: "ops.health_email_failed",
          scopePath: ROOT_SCOPE,
          principalId: actorPrincipalId,
          payload: {
            checkKey: check.key,
            component: check.component,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    await emitEvent(db, {
      type: "alert.fired",
      scopePath: ROOT_SCOPE,
      principalId: actorPrincipalId,
      payload: {
        capability: "ops-health",
        severity: alertSeverity(check.status),
        message,
        metric: "ops.health",
        value: severityRank(check.status),
        threshold: 2,
        checkKey: check.key,
      },
    });
    await upsertAlertState(db, check, emailSent);
    alerts.push({ checkKey: check.key, status: check.status, message, emailSent });
  }
  if (dailyDigest && deps.sendEmail && recipients.length > 0) {
    const unhealthy = checks.filter((check) => check.status === "warning" || check.status === "error");
    if (unhealthy.length > 0) {
      const startOfDay = new Date(checks[0]?.lastCheckedAt ?? new Date());
      startOfDay.setUTCHours(0, 0, 0, 0);
      const [digestState] = (await db
        .select()
        .from(opsAlertState)
        .where(and(eq(opsAlertState.checkKey, "digest:daily"), gte(opsAlertState.lastDigestAt, startOfDay)))
        .limit(1)) as Array<{ id: string }>;
      if (!digestState) {
        try {
          await deps.sendEmail({
            to: recipients,
            subject: "[CompanyOS] Daily ops health digest",
            text: unhealthy
              .map((check) => `${check.status.toUpperCase()} ${check.component}: ${check.latestError || check.detail}`)
              .join("\n"),
          });
          await db.insert(opsAlertState).values({
            checkKey: "digest:daily",
            status: "warning",
            message: `${unhealthy.length} unhealthy checks`,
            lastDigestAt: checks[0]?.lastCheckedAt ?? new Date(),
            emailSent: true,
            metadata: { count: unhealthy.length },
            updatedAt: checks[0]?.lastCheckedAt ?? new Date(),
          }).onConflictDoUpdate({
            target: opsAlertState.checkKey,
            set: {
              status: "warning",
              message: `${unhealthy.length} unhealthy checks`,
              lastDigestAt: checks[0]?.lastCheckedAt ?? new Date(),
              emailSent: true,
              metadata: { count: unhealthy.length },
              updatedAt: checks[0]?.lastCheckedAt ?? new Date(),
            },
          });
        } catch (error) {
          await emitEvent(db, {
            type: "ops.health_email_failed",
            scopePath: ROOT_SCOPE,
            principalId: actorPrincipalId,
            payload: {
              checkKey: "digest:daily",
              component: "daily digest",
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }
    }
  }
  return alerts;
}


function utcDayStart(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function numericCount(value: unknown): number {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function wikiContributions(db: DB, now: Date): Promise<WikiContributionDay[]> {
  const start = new Date(utcDayStart(now).getTime() - 13 * DAY_MS);
  const end = new Date(start.getTime() + 14 * DAY_MS);
  const result = await db.execute(sql`
    select
      to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as date,
      count(*) filter (where type = 'doc.saved') as saves,
      count(*) filter (where type = 'doc.verified') as verifies
    from events
    where type in ('doc.saved', 'doc.verified')
      and created_at >= ${start.toISOString()}::timestamptz
      and created_at < ${end.toISOString()}::timestamptz
    group by 1
  `);
  const rows: Array<{ date: string; saves: unknown; verifies: unknown }> = Array.isArray(result?.rows)
    ? result.rows
    : Array.isArray(result)
      ? result
      : [];
  const byDate = new Map(rows.map((row) => [row.date, { saves: numericCount(row.saves), verifies: numericCount(row.verifies) }]));
  return Array.from({ length: 14 }, (_, index) => {
    const date = dateKey(new Date(start.getTime() + index * DAY_MS));
    const counts = byDate.get(date);
    return { date, saves: counts?.saves ?? 0, verifies: counts?.verifies ?? 0 };
  });
}
async function runLog(db: DB, status?: string): Promise<OpsRunLogRow[]> {
  const conditions: any[] = [inArray(capabilities.name, RUN_LOG_CAPABILITIES)];
  if (status) conditions.push(eq(capabilityRuns.status, status));
  const rows = (await db
    .select({
      id: capabilityRuns.id,
      status: capabilityRuns.status,
      startedAt: capabilityRuns.startedAt,
      finishedAt: capabilityRuns.finishedAt,
      durationMs: capabilityRuns.durationMs,
      summary: capabilityRuns.summary,
      payload: capabilityRuns.payload,
      scopePath: scopes.path,
      capability: capabilities.name,
    })
    .from(capabilityRuns)
    .innerJoin(capabilities, eq(capabilityRuns.capabilityId, capabilities.id))
    .innerJoin(scopes, eq(capabilities.scopeId, scopes.id))
    .where(and(...conditions))
    .orderBy(desc(capabilityRuns.startedAt))
    .limit(100)) as Array<CapabilityRun & { scopePath: string; capability: string }>;

  return rows.map((run) => ({
    id: run.id,
    scopePath: run.scopePath,
    capability: run.capability,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    summary: run.summary,
    latestError: runError(run),
    tokenSpend: tokenSpend(run.payload || {}),
    href: runHref(run.capability),
  }));
}

export async function registerExternalCredential(
  db: DB,
  input: RegisterExternalCredentialInput,
  actorPrincipalId: string
): Promise<ExternalCredential> {
  await requireRootAdmin(db, actorPrincipalId);
  const name = input.name.trim();
  const component = input.component.trim();
  if (!name) throw new Error("External credential name is required");
  if (!component) throw new Error("External credential component is required");

  let scopeId: string | null = null;
  if (input.scopePath) {
    const scope = await getScope(db, input.scopePath);
    if (!scope) throw new ScopeNotFoundError(input.scopePath);
    scopeId = scope.id;
  }

  const expiresAt = normalizeDate(input.expiresAt);
  const values = {
    scopeId,
    name,
    component,
    ownerNote: input.ownerNote ?? "",
    whereItLives: input.whereItLives ?? "",
    expiresAt,
    status: input.status ?? "active",
    metadata: input.metadata ?? {},
    createdBy: actorPrincipalId,
    updatedAt: new Date(),
  };
  const [row] = (await db.insert(externalCredentials).values(values).onConflictDoUpdate({
    target: externalCredentials.name,
    set: values,
  }).returning()) as ExternalCredential[];
  if (!row) throw new Error("Failed to register external credential");
  await emitEvent(db, {
    type: "external_credential.registered",
    scopePath: input.scopePath || ROOT_SCOPE,
    principalId: actorPrincipalId,
    payload: {
      name,
      component,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      whereItLives: values.whereItLives,
    },
  });
  return row;
}

export async function getOpsHealth(
  db: DB,
  input: GetOpsHealthInput = {},
  actorPrincipalId: string,
  deps: OpsHealthDeps = {}
): Promise<OpsHealthResult> {
  await requireRootAdmin(db, actorPrincipalId);
  const now = input.now ?? new Date();
  const env = input.env ?? {};

  const externalRows = (await db
    .select()
    .from(externalCredentials)
    .where(eq(externalCredentials.status, "active"))
    .orderBy(externalCredentials.name)) as ExternalCredential[];

  const checks: OpsHealthCheck[] = [
    await tokenCheck(db, now, "BRAIN_ENGINE_TOKEN", "BRAIN_ENGINE_TOKEN"),
    ...externalRows.map((row) => externalCredentialCheck(now, row)),
    await llmKeyCheck(now, "LITELLM_EMBED_KEY", env.litellmEmbedKeyConfigured, deps.llmProbe),
    await llmKeyCheck(now, "BRAIN_LITELLM_API_KEY", env.brainLiteLlmKeyConfigured, deps.llmProbe),
    await capabilityCheck(db, now, "brain-engine", "brain-cron sidecar", BRAIN_OVERDUE_MS, env.brainCronEnabled === true),
    await webhookCheck(db, now, "github", "GitHub org webhook deliveries", env.githubWebhookConfigured, ["workbench.push", "workbench.pr_opened", "workbench.pr_updated", "workbench.pr_merged", "skills.repo_push_synced", "skills.repo_push_ignored"], { type: "skills.repo_push_failed", key: "source", value: "github" }),
    await webhookCheck(db, now, "plane", "Plane webhook + API token", env.planeWebhookConfigured !== false && env.planeApiConfigured !== false, ["task.completed_external", "task.updated_external"], { type: "webhook.unhandled", key: "source", value: "plane" }),
    await skillsSyncCheck(db, now),
    await capabilityCheck(db, now, "staging-deploy-migrate", "staging deploy migrate results", WEEKLY_EXPECTED_MS, true),
    await capabilityCheck(db, now, "backups", "M5-03 backups", WEEKLY_EXPECTED_MS, false),
  ];

  if (!checks.some((check) => check.key === "external-credential:GITHUB_TOKEN")) {
    checks.splice(1, 0, {
      key: "external-credential:GITHUB_TOKEN",
      component: "GITHUB_TOKEN",
      kind: "external_credential",
      status: "unknown",
      lastCheckedAt: now,
      lastActivityAt: null,
      expiryAt: null,
      nextExpectedAt: null,
      latestError: "No external credential registry row found",
      detail: "No external credential registry row found",
      href: "/admin/health",
    });
  }

  const alerts = await maybeAlert(db, checks, actorPrincipalId, deps, input.sendAlerts === true, input.dailyDigest === true);
  return {
    checks: checks.sort((a, b) => severityRank(b.status) - severityRank(a.status) || a.component.localeCompare(b.component)),
    runs: await runLog(db, input.runStatus),
    wikiContributions: await wikiContributions(db, now),
    alerts,
    generatedAt: now,
  };
}
