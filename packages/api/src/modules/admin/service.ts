/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from "node:crypto";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import {
  account,
  capabilities,
  capabilityRuns,
  events,
  grants,
  principals,
  scopes,
  user,
  type Grant,
  type Principal,
} from "@companyos/db";
import { emitEvent, listEvents, type DB } from "../../kernel/events";
import { grantRole, requireAccess, revokeGrant } from "../../kernel/grants";
import { linkAuthUser } from "../../kernel/auth-link";
import { getScope } from "../../kernel/scopes";
import {
  getLiteLlmAdminState,
  mintLiteLlmVirtualKey,
  revokeLiteLlmVirtualKey,
  setLiteLlmKeyBudget,
  type LiteLlmAdminConfig,
  type LiteLlmAdminState,
  type LiteLlmKeyMutationResult,
  type MintLiteLlmKeyInput,
} from "./litellm";

export interface BetterAuthAdminUser {
  id: string;
  email: string;
  name: string;
  emailVerified?: boolean;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface BetterAuthAdminApi {
  createUser(input: { email: string; name: string; password: string }): Promise<{ user: BetterAuthAdminUser } | BetterAuthAdminUser>;
  listUsers?(input?: { limit?: number; offset?: number }): Promise<{ users: BetterAuthAdminUser[]; total?: number } | BetterAuthAdminUser[]>;
  updateUser?(input: { userId: string; data: Partial<Pick<BetterAuthAdminUser, "name" | "email">> }): Promise<unknown>;
  disableUser?(input: { userId: string }): Promise<unknown>;
  setUserPassword?(input: { userId: string; newPassword: string }): Promise<unknown>;
}

export interface AdminUser {
  authUserId: string;
  principalId: string | null;
  name: string;
  email: string;
  principalStatus: Principal["status"] | null;
  forcePasswordChange: boolean;
  createdAt: Date | string | null;
  grants: Array<{ scopePath: string; role: Grant["role"] }>;
}

export interface CreateAdminUserInput {
  email: string;
  name: string;
  tempPassword?: string;
  grants?: Array<{ scopePath: string; role: Grant["role"] }>;
}

export interface CreateAdminUserResult {
  user: AdminUser;
  tempPassword: string;
}

export interface AdminGrantRow {
  grantId: string;
  principalId: string;
  principalName: string;
  principalEmail: string | null;
  scopePath: string;
  role: Grant["role"];
  createdAt: Date;
}

export interface AdminAutomationRow {
  id: string;
  scopePath: string;
  name: string;
  engine: string;
  engineRef: string | null;
  status: string;
  lastRun: {
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    summary: string | null;
  } | null;
}

const TEMP_PASSWORD_META_KEY = "companyos";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function generatedTempPassword(): string {
  return `Cos-${randomBytes(18).toString("base64url").slice(0, 24)}`;
}

function parseAccountScope(value: string | null): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringifyAccountScope(meta: Record<string, any>): string {
  return JSON.stringify(meta);
}

function forcePasswordChangeFromScope(value: string | null): boolean {
  const parsed = parseAccountScope(value);
  return Boolean(parsed[TEMP_PASSWORD_META_KEY]?.forcePasswordChange);
}

async function assertRootAdmin(db: DB, actorPrincipalId: string): Promise<void> {
  await requireAccess(db, actorPrincipalId, "root", "admin");
}

async function setForcePasswordChange(db: DB, authUserId: string, required: boolean): Promise<void> {
  const [credentialAccount] = await db
    .select()
    .from(account)
    .where(and(eq(account.userId, authUserId), eq(account.providerId, "credential")))
    .limit(1);
  if (!credentialAccount) return;
  const meta = parseAccountScope(credentialAccount.scope);
  meta[TEMP_PASSWORD_META_KEY] = {
    ...(meta[TEMP_PASSWORD_META_KEY] ?? {}),
    forcePasswordChange: required,
  };
  await db.update(account).set({ scope: stringifyAccountScope(meta), updatedAt: new Date() }).where(eq(account.id, credentialAccount.id));
}

async function getForcePasswordChange(db: DB, authUserId: string): Promise<boolean> {
  const [credentialAccount] = await db
    .select({ scope: account.scope })
    .from(account)
    .where(and(eq(account.userId, authUserId), eq(account.providerId, "credential")))
    .limit(1);
  return forcePasswordChangeFromScope(credentialAccount?.scope ?? null);
}

async function getPrincipalByAuthUserId(db: DB, authUserId: string): Promise<Principal | null> {
  const [principal] = await db.select().from(principals).where(eq(principals.authUserId, authUserId)).limit(1);
  return principal as Principal | undefined ?? null;
}

function normalizeCreatedUser(result: { user: BetterAuthAdminUser } | BetterAuthAdminUser): BetterAuthAdminUser {
  return "user" in result ? result.user : result;
}

async function buildAdminUsers(db: DB, authUsers: BetterAuthAdminUser[]): Promise<AdminUser[]> {
  const rows: AdminUser[] = [];
  for (const authUser of authUsers) {
    const principal = await getPrincipalByAuthUserId(db, authUser.id);
    const grantRows = principal
      ? await db
        .select({ scopePath: scopes.path, role: grants.role })
        .from(grants)
        .innerJoin(scopes, eq(grants.scopeId, scopes.id))
        .where(eq(grants.principalId, principal.id))
        .orderBy(scopes.path)
      : [];
    rows.push({
      authUserId: authUser.id,
      principalId: principal?.id ?? null,
      name: authUser.name,
      email: authUser.email,
      principalStatus: principal?.status ?? null,
      forcePasswordChange: await getForcePasswordChange(db, authUser.id),
      createdAt: authUser.createdAt ?? null,
      grants: grantRows as Array<{ scopePath: string; role: Grant["role"] }>,
    });
  }
  return rows;
}

async function listAuthUsersFromDb(db: DB): Promise<BetterAuthAdminUser[]> {
  const rows = (await db.select().from(user).orderBy(user.email)) as BetterAuthAdminUser[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function listAdminUsers(
  db: DB,
  authAdmin: BetterAuthAdminApi,
  actorPrincipalId: string
): Promise<AdminUser[]> {
  await assertRootAdmin(db, actorPrincipalId);
  const listed = authAdmin.listUsers ? await authAdmin.listUsers({ limit: 500, offset: 0 }) : await listAuthUsersFromDb(db);
  const authUsers = Array.isArray(listed) ? listed : listed.users;
  return buildAdminUsers(db, authUsers);
}

export async function createAdminUser(
  db: DB,
  authAdmin: BetterAuthAdminApi,
  input: CreateAdminUserInput,
  actorPrincipalId: string
): Promise<CreateAdminUserResult> {
  await assertRootAdmin(db, actorPrincipalId);
  const email = normalizeEmail(input.email);
  const tempPassword = input.tempPassword ?? generatedTempPassword();
  const authUser = normalizeCreatedUser(await authAdmin.createUser({ email, name: input.name.trim(), password: tempPassword }));
  const link = await linkAuthUser(db, { authUserId: authUser.id, email: authUser.email, name: authUser.name });
  await setForcePasswordChange(db, authUser.id, true);

  for (const grant of input.grants ?? []) {
    await grantRole(db, { principalId: link.principalId, scopePath: grant.scopePath, role: grant.role }, actorPrincipalId);
  }

  await emitEvent(db, {
    type: "admin.user_created",
    scopePath: "root",
    principalId: actorPrincipalId,
    payload: {
      authUserId: authUser.id,
      principalId: link.principalId,
      email,
      grantCount: input.grants?.length ?? 0,
      forcedPasswordChange: true,
    },
  });

  const [adminUser] = await buildAdminUsers(db, [authUser]);
  if (!adminUser) throw new Error("Failed to load created user");
  return { user: adminUser, tempPassword };
}

export async function disableAdminUser(
  db: DB,
  authAdmin: BetterAuthAdminApi,
  input: { authUserId: string },
  actorPrincipalId: string
): Promise<void> {
  await assertRootAdmin(db, actorPrincipalId);
  await authAdmin.disableUser?.({ userId: input.authUserId });
  const principal = await getPrincipalByAuthUserId(db, input.authUserId);
  if (principal) {
    await db.update(principals).set({ status: "disabled" }).where(eq(principals.id, principal.id));
  }
  await emitEvent(db, {
    type: "admin.user_disabled",
    scopePath: "root",
    principalId: actorPrincipalId,
    payload: { authUserId: input.authUserId, principalId: principal?.id ?? null },
  });
}

export async function resetAdminUserTempPassword(
  db: DB,
  authAdmin: BetterAuthAdminApi,
  input: { authUserId: string; tempPassword?: string },
  actorPrincipalId: string
): Promise<{ tempPassword: string }> {
  await assertRootAdmin(db, actorPrincipalId);
  const tempPassword = input.tempPassword ?? generatedTempPassword();
  await authAdmin.setUserPassword?.({ userId: input.authUserId, newPassword: tempPassword });
  await setForcePasswordChange(db, input.authUserId, true);
  await emitEvent(db, {
    type: "admin.user_temp_password_reset",
    scopePath: "root",
    principalId: actorPrincipalId,
    payload: { authUserId: input.authUserId, forcedPasswordChange: true },
  });
  return { tempPassword };
}

export async function isTempPasswordChangeRequired(
  db: DB,
  actorPrincipalId: string
): Promise<boolean> {
  const [principal] = await db
    .select({ authUserId: principals.authUserId })
    .from(principals)
    .where(eq(principals.id, actorPrincipalId))
    .limit(1);
  if (!principal?.authUserId) return false;
  return getForcePasswordChange(db, principal.authUserId);
}

export async function completeTempPasswordChange(
  db: DB,
  actorPrincipalId: string
): Promise<void> {
  const [principal] = await db
    .select({ authUserId: principals.authUserId })
    .from(principals)
    .where(eq(principals.id, actorPrincipalId))
    .limit(1);
  if (!principal?.authUserId) return;
  await setForcePasswordChange(db, principal.authUserId, false);
  await emitEvent(db, {
    type: "admin.user_password_changed",
    scopePath: "root",
    principalId: actorPrincipalId,
    payload: { authUserId: principal.authUserId, forcedPasswordChange: false },
  });
}

export async function listAdminGrants(db: DB, actorPrincipalId: string): Promise<AdminGrantRow[]> {
  await assertRootAdmin(db, actorPrincipalId);
  const rows = await db
    .select({
      grantId: grants.id,
      principalId: grants.principalId,
      principalName: principals.name,
      principalEmail: principals.email,
      scopePath: scopes.path,
      role: grants.role,
      createdAt: grants.createdAt,
    })
    .from(grants)
    .innerJoin(principals, eq(grants.principalId, principals.id))
    .innerJoin(scopes, eq(grants.scopeId, scopes.id))
    .orderBy(scopes.path, principals.name);
  return rows as AdminGrantRow[];
}

export async function grantAdminRole(
  db: DB,
  input: { principalId: string; scopePath: string; role: Grant["role"] },
  actorPrincipalId: string
): Promise<Grant> {
  await assertRootAdmin(db, actorPrincipalId);
  return grantRole(db, input, actorPrincipalId);
}

export async function revokeAdminGrant(
  db: DB,
  input: { principalId: string; scopePath: string },
  actorPrincipalId: string
): Promise<void> {
  await assertRootAdmin(db, actorPrincipalId);
  await revokeGrant(db, input, actorPrincipalId);
}

export async function listAdminActivity(
  db: DB,
  input: { type?: string; limit?: number } = {},
  actorPrincipalId: string
) {
  await assertRootAdmin(db, actorPrincipalId);
  return listEvents(db, { type: input.type, limit: Math.min(Math.max(input.limit ?? 100, 1), 200) });
}

export async function listAdminAutomations(db: DB, actorPrincipalId: string): Promise<AdminAutomationRow[]> {
  await assertRootAdmin(db, actorPrincipalId);
  const rows = await db
    .select({
      id: capabilities.id,
      scopePath: scopes.path,
      name: capabilities.name,
      engine: capabilities.engine,
      engineRef: capabilities.engineRef,
      status: capabilities.status,
    })
    .from(capabilities)
    .innerJoin(scopes, eq(capabilities.scopeId, scopes.id))
    .orderBy(scopes.path, capabilities.name);

  const output: AdminAutomationRow[] = [];
  for (const row of rows) {
    const [lastRun] = await db
      .select({
        status: capabilityRuns.status,
        startedAt: capabilityRuns.startedAt,
        finishedAt: capabilityRuns.finishedAt,
        summary: capabilityRuns.summary,
      })
      .from(capabilityRuns)
      .where(eq(capabilityRuns.capabilityId, row.id))
      .orderBy(desc(capabilityRuns.startedAt))
      .limit(1);
    output.push({ ...row, lastRun: lastRun ?? null });
  }
  return output;
}

export async function listAdminAlerts(db: DB, actorPrincipalId: string) {
  await assertRootAdmin(db, actorPrincipalId);
  const rows = await db
    .select({ type: events.type, payload: events.payload, createdAt: events.createdAt, scopePath: scopes.path })
    .from(events)
    .leftJoin(scopes, eq(events.scopeId, scopes.id))
    .where(eq(events.type, "alert.fired"))
    .orderBy(desc(events.createdAt))
    .limit(50);
  return rows;
}

export async function getAdminSettings(db: DB, actorPrincipalId: string) {
  await assertRootAdmin(db, actorPrincipalId);
  const root = await getScope(db, "root");
  return {
    instanceName: process.env.INSTANCE_NAME || "CompanyOS",
    skillsRepo: process.env.SKILLS_REPO || null,
    rootScopeId: root?.id ?? null,
    integrations: {
      plane: Boolean(process.env.PLANE_API_TOKEN),
      github: Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_ORG),
      litellm: Boolean(process.env.LITELLM_MASTER_KEY),
      n8n: Boolean(process.env.N8N_BASE_URL),
      flowise: Boolean(process.env.FLOWISE_BASE_URL),
    },
  };
}

export async function listGrantablePrincipals(db: DB, actorPrincipalId: string): Promise<Principal[]> {
  await assertRootAdmin(db, actorPrincipalId);
  return (await db.select().from(principals).where(isNotNull(principals.authUserId)).orderBy(principals.name)) as Principal[];
}

export async function getAdminLiteLlmState(
  db: DB,
  config: LiteLlmAdminConfig,
  actorPrincipalId: string
): Promise<LiteLlmAdminState> {
  await assertRootAdmin(db, actorPrincipalId);
  return getLiteLlmAdminState(config);
}

export async function mintAdminLiteLlmKey(
  db: DB,
  config: LiteLlmAdminConfig,
  input: MintLiteLlmKeyInput,
  actorPrincipalId: string
): Promise<LiteLlmKeyMutationResult> {
  await assertRootAdmin(db, actorPrincipalId);
  const result = await mintLiteLlmVirtualKey(config, input);
  await emitEvent(db, {
    type: "admin.litellm_key_minted",
    scopePath: "root",
    principalId: actorPrincipalId,
    payload: { alias: result.alias ?? input.alias, budgetUsd: input.budgetUsd ?? null, models: input.models ?? [] },
  });
  return result;
}

export async function revokeAdminLiteLlmKey(
  db: DB,
  config: LiteLlmAdminConfig,
  input: { key: string; alias?: string | null },
  actorPrincipalId: string
): Promise<void> {
  await assertRootAdmin(db, actorPrincipalId);
  await revokeLiteLlmVirtualKey(config, input.key);
  await emitEvent(db, {
    type: "admin.litellm_key_revoked",
    scopePath: "root",
    principalId: actorPrincipalId,
    payload: { alias: input.alias ?? null },
  });
}

export async function setAdminLiteLlmKeyBudget(
  db: DB,
  config: LiteLlmAdminConfig,
  input: { key: string; alias?: string | null; budgetUsd: number },
  actorPrincipalId: string
): Promise<void> {
  await assertRootAdmin(db, actorPrincipalId);
  await setLiteLlmKeyBudget(config, input.key, input.budgetUsd);
  await emitEvent(db, {
    type: "admin.litellm_key_budget_set",
    scopePath: "root",
    principalId: actorPrincipalId,
    payload: { alias: input.alias ?? null, budgetUsd: input.budgetUsd },
  });
}
