/**
 * Server-only service bindings for apps/os.
 * Creates the DB handle (allowed only for wiring services + auth adapter per brief).
 * All page/server components MUST call through these wrappers - never raw @companyos/db queries.
 * This keeps "services only" contract.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";
import { createDb } from "@companyos/db";
import { createLiteLlmBrainClient, runBrainEngine as runNativeBrainEngine, type BrainRunInput } from "@companyos/brain";
import { auth } from "@/lib/auth";
import {
  getSubtree,
  getScope,
  createScope,
  getVisibleTree,
  archiveScope,
  unarchiveScope,
  listArchivedScopes,
  listEvents,
  listRecords,
  listTasks,
  grantRole,
  resolveAccess,
  getPlaneUrl,
  listGrants,
  revokeGrant,
  linkAuthUser,
  getPrincipalIdForAuthUser,
  getPrincipalByEmail,
  getDashboard,
  queryMetrics,
  PlaneClient,
  saveDoc,
  getDoc,
  listDocs,
  renameDoc,
  archiveDoc,
  listDocRevisions,
  revertDoc,
  getBacklinks,
  verifyDoc,
  followDoc,
  unfollowDoc,
  isFollowing,
  saveCanvas,
  getCanvas,
  listCanvases,
  archiveCanvas,
  runTurn,
  listConversations,
  getConversationMessages,
  mintConnectionToken,
  listConnectionTokens,
  ensureConnectionExpiryAttention,
  listConnections,
  listOAuthConnections,
  revokeConnectionToken,
  updateConnectionTokenExpiry,
  revokePrincipalAccess,
  revokeScopeAccess,
  setCredential,
  listCredentials,
  deleteCredential,
  listSessions,
  findNearestWiki,
  queryUsage,
  usageRecommendations,
  getContextProfile,
  setContextProfile,
  getBrainGraph,
  getBrainEngineOps,
  assertBrainManualTriggerAllowed,
  ensureDraftIntakeForScope,
  listIntakePackets,
  getIntakePacket,
  updateIntakePacket,
  submitIntakePacket,
  findRelatedHistory,
  findReusePatterns,
  acceptReusePattern,
  assembleIntakeExternalPack,
  approveIntakePacket,
  listAttentionItems,
  countOpenAttentionItems,
  resolveAttentionItem,
  rejectIntakePacket,
  dismissIntakePacket,
  reopenIntakePacket,
  provisionFromIntakePacket,
  listWizardTemplates,
  listWizardFramingQuestions,
  saveWizardTemplate,
  getOpsHealth,
  listAdminUsers,
  createAdminUser,
  disableAdminUser,
  resetAdminUserTempPassword,
  isTempPasswordChangeRequired,
  completeTempPasswordChange,
  listAdminGrants,
  grantAdminRole,
  revokeAdminGrant,
  listAdminActivity,
  listAdminAutomations,
  listAdminAlerts,
  getAdminSettings,
  listGrantablePrincipals,
  getAdminLiteLlmState,
  mintAdminLiteLlmKey,
  revokeAdminLiteLlmKey,
  setAdminLiteLlmKeyBudget,
  GitHubClient,
  type BetterAuthAdminApi,
  type CreateAdminUserInput,
  type MintLiteLlmKeyInput,
  type LLMConfig,
  type RunTurnInput,
} from "@companyos/api";

// Singleton DB for the lifetime of the server process (dev/prod)
const db = createDb();

// Graceful Plane stub when not configured (M2-03: handle Plane-unconfigured gracefully)
function getPlaneClient(): any {
  const token = process.env.PLANE_API_TOKEN;
  const baseUrl = process.env.PLANE_BASE_URL || "http://localhost:8090";
  const workspace = process.env.PLANE_WORKSPACE_SLUG || "companyos";
  if (!token) {
    // Full stub implementing surface used by service (no-ops / empties to avoid crashes)
    const planeStub = {
      isStub: true,
      listIssues: async () => [],
      getProjects: async () => [],
      createProject: async () => ({ id: "stub" }),
      createLabel: async () => ({ id: "stub" }),
      listLabels: async () => [],
      getStates: async () => [],
      forWorkspace: (slug: string) => {
        void slug;
        return planeStub;
      },
    };
    return planeStub;
  }
  return new PlaneClient({ baseUrl, apiToken: token, workspaceSlug: workspace });
}

function getBrainLlmClient() {
  const baseUrl = process.env.LITELLM_BASE_URL || "http://localhost:4000";
  const apiKey = process.env.BRAIN_LITELLM_API_KEY || "";
  if (!apiKey) throw new Error("BRAIN_LITELLM_API_KEY is required for manual brain runs");
  return createLiteLlmBrainClient({ baseUrl, apiKey });
}

function getBrainGitHubClient(): GitHubClient | null {
  const token = process.env.GITHUB_TOKEN;
  const org = process.env.GITHUB_ORG;
  if (!token || !org) return null;
  return new GitHubClient({ token, org, baseUrl: process.env.GITHUB_API_URL || undefined });
}

function getBetterAuthAdmin(): BetterAuthAdminApi {
  const authApi = auth.api as unknown as Partial<Record<string, (args: any) => Promise<any>>>;
  return {
    createUser: async (input) => {
      if (authApi.createUser) {
        return authApi.createUser({ body: input });
      }
      if (!authApi.signUpEmail) {
        throw new Error("Better Auth user creation API is not available");
      }
      const result = await authApi.signUpEmail({ body: input });
      return { user: result.user ?? result };
    },
    listUsers: undefined,
    updateUser: authApi.adminUpdateUser
      ? (input) => authApi.adminUpdateUser!({ body: { userId: input.userId, data: input.data } })
      : undefined,
    disableUser: authApi.banUser
      ? (input) => authApi.banUser!({ body: { userId: input.userId, banReason: "Disabled by tenant admin" } })
      : undefined,
    setUserPassword: authApi.setUserPassword
      ? (input) => authApi.setUserPassword!({ body: { userId: input.userId, newPassword: input.newPassword } })
      : undefined,
  };
}

function getLiteLlmAdminConfig() {
  return {
    baseUrl: process.env.LITELLM_BASE_URL || "http://localhost:4000",
    masterKey: process.env.LITELLM_MASTER_KEY || null,
    env: process.env as Record<string, string | undefined>,
  };
}

// Re-export bound versions (first arg db pre-filled)
export const api = {
  // Scopes / tree
  getSubtree: (path: string) => getSubtree(db, path),
  getScope: (path: string) => getScope(db, path),
  getVisibleTree: (principalId: string) => getVisibleTree(db, principalId),
  listArchivedScopes: (principalId: string) => listArchivedScopes(db, principalId),
  createScope: (input: any, actor?: string | null) =>
    createScope(db, input, actor),
  archiveScope: (path: string, actor: string) => archiveScope(db, path, actor),
  unarchiveScope: (path: string, actor: string) => unarchiveScope(db, path, actor),

  // Events
  listEvents: (input?: Parameters<typeof listEvents>[1]) => listEvents(db, input),

  // Records
  listRecords: (input: Parameters<typeof listRecords>[1], actorPrincipalId: string) =>
    listRecords(db, input, actorPrincipalId),

  // Tasks (injects stub/real plane)
  listTasks: (input: Parameters<typeof listTasks>[2], actorPrincipalId: string) =>
    listTasks(db, getPlaneClient() as any, input, actorPrincipalId),
  getPlaneUrl: (scopePath: string) => getPlaneUrl(db, scopePath),

  // Grants
  grantRole: (input: Parameters<typeof grantRole>[1], actor?: string | null) =>
    grantRole(db, input, actor),
  resolveAccess: (principalId: string, scopePath: string) =>
    resolveAccess(db, principalId, scopePath),
  listGrants: (scopePath: string, actorPrincipalId: string) =>
    listGrants(db, scopePath, actorPrincipalId),
  revokeGrant: (input: { principalId: string; scopePath: string }, actor?: string | null) =>
    revokeGrant(db, input, actor),
  getPrincipalByEmail: (email: string) => getPrincipalByEmail(db, email),

  // Dashboards + metrics (M2-04)
  getDashboard: (input: Parameters<typeof getDashboard>[1], actorPrincipalId: string) =>
    getDashboard(db, input, actorPrincipalId),
  queryMetrics: (input: Parameters<typeof queryMetrics>[1], actorPrincipalId: string) =>
    queryMetrics(db, input, actorPrincipalId),

  // Docs KB (M3-02) - server-only wrappers; all access checks in service layer
  saveDoc: (input: Parameters<typeof saveDoc>[1], actorPrincipalId: string) =>
    saveDoc(db, input, actorPrincipalId),
  getDoc: (input: Parameters<typeof getDoc>[1], actorPrincipalId: string) =>
    getDoc(db, input, actorPrincipalId),
  listDocs: (input: Parameters<typeof listDocs>[1], actorPrincipalId: string) =>
    listDocs(db, input, actorPrincipalId),
  renameDoc: (input: Parameters<typeof renameDoc>[1], actorPrincipalId: string) =>
    renameDoc(db, input, actorPrincipalId),
  archiveDoc: (input: Parameters<typeof archiveDoc>[1], actorPrincipalId: string) =>
    archiveDoc(db, input, actorPrincipalId),
  listDocRevisions: (input: Parameters<typeof listDocRevisions>[1], actorPrincipalId: string) =>
    listDocRevisions(db, input, actorPrincipalId),
  revertDoc: (input: Parameters<typeof revertDoc>[1], actorPrincipalId: string) =>
    revertDoc(db, input, actorPrincipalId),
  getBacklinks: (input: Parameters<typeof getBacklinks>[1], actorPrincipalId: string) =>
    getBacklinks(db, input, actorPrincipalId),
  verifyDoc: (input: Parameters<typeof verifyDoc>[1], actorPrincipalId: string) =>
    verifyDoc(db, input, actorPrincipalId),
  followDoc: (input: Parameters<typeof followDoc>[1], actorPrincipalId: string) =>
    followDoc(db, input, actorPrincipalId),
  unfollowDoc: (input: Parameters<typeof unfollowDoc>[1], actorPrincipalId: string) =>
    unfollowDoc(db, input, actorPrincipalId),
  isFollowing: (input: Parameters<typeof isFollowing>[1], actorPrincipalId: string) =>
    isFollowing(db, input, actorPrincipalId),

  // Canvas (M3-03)
  saveCanvas: (input: Parameters<typeof saveCanvas>[1], actorPrincipalId: string) =>
    saveCanvas(db, input, actorPrincipalId),
  getCanvas: (input: Parameters<typeof getCanvas>[1], actorPrincipalId: string) =>
    getCanvas(db, input, actorPrincipalId),
  listCanvases: (input: Parameters<typeof listCanvases>[1], actorPrincipalId: string) =>
    listCanvases(db, input, actorPrincipalId),
  archiveCanvas: (input: Parameters<typeof archiveCanvas>[1], actorPrincipalId: string) =>
    archiveCanvas(db, input, actorPrincipalId),

  // Modules (for tab context, though tabs unconditional in M2-03)
  listModules: async (scopePath: string, actorPrincipalId: string) => {
    const { listModules } = await import("@companyos/api");
    return listModules(db, scopePath, actorPrincipalId);
  },

  // Resident agent (M3-04) - env at boundary only; tests pass mocked LLMConfig directly to service
  runTurn: (input: RunTurnInput, actorPrincipalId: string, llm: LLMConfig, planeClient?: unknown) =>
    runTurn(db, input, actorPrincipalId, llm, planeClient as any),
  listConversations: (input: Parameters<typeof listConversations>[1], actorPrincipalId: string) =>
    listConversations(db, input, actorPrincipalId),
  getConversationMessages: (input: Parameters<typeof getConversationMessages>[1], actorPrincipalId: string) =>
    getConversationMessages(db, input, actorPrincipalId),

  // Connect to MCP (M6-02)
  mintConnectionToken: (input: Parameters<typeof mintConnectionToken>[1], actorPrincipalId: string) =>
    mintConnectionToken(db, input, actorPrincipalId),
  listConnectionTokens: (input: Parameters<typeof listConnectionTokens>[1], actorPrincipalId: string) =>
    listConnectionTokens(db, input, actorPrincipalId),
  revokeConnectionToken: (input: Parameters<typeof revokeConnectionToken>[1], actorPrincipalId: string) =>
    revokeConnectionToken(db, input, actorPrincipalId),
  updateConnectionTokenExpiry: (input: Parameters<typeof updateConnectionTokenExpiry>[1], actorPrincipalId: string) =>
    updateConnectionTokenExpiry(db, input, actorPrincipalId),
  ensureConnectionExpiryAttention: () => ensureConnectionExpiryAttention(db),
  listConnections: (input: Parameters<typeof listConnections>[1], actorPrincipalId: string) =>
    listConnections(db, input, actorPrincipalId),
  listOAuthConnections: (input: Parameters<typeof listOAuthConnections>[1], actorPrincipalId: string) =>
    listOAuthConnections(db, input, actorPrincipalId),
  revokeScopeAccess: (input: Parameters<typeof revokeScopeAccess>[1], actorPrincipalId: string) =>
    revokeScopeAccess(db, input, actorPrincipalId),
  revokePrincipalAccess: (input: Parameters<typeof revokePrincipalAccess>[1], actorPrincipalId: string) =>
    revokePrincipalAccess(db, input, actorPrincipalId),

  // Credential vault (M8-09)
  setCredential: (input: Parameters<typeof setCredential>[1], actorPrincipalId: string) =>
    setCredential(db, input, actorPrincipalId),
  listCredentials: (input: Parameters<typeof listCredentials>[1], actorPrincipalId: string) =>
    listCredentials(db, input, actorPrincipalId),
  deleteCredential: (input: Parameters<typeof deleteCredential>[1], actorPrincipalId: string) =>
    deleteCredential(db, input, actorPrincipalId),

  // Sessions registry (M6-07)
  listSessions: (input: Parameters<typeof listSessions>[1], actorPrincipalId: string) =>
    listSessions(db, input, actorPrincipalId),
  findNearestWiki: (scopePath: string) => findNearestWiki(db, scopePath),

  // Usage observability (M7-03)
  queryUsage: (input: Parameters<typeof queryUsage>[1], actorPrincipalId: string) =>
    queryUsage(db, input, actorPrincipalId),
  usageRecommendations: (input: Parameters<typeof usageRecommendations>[1], actorPrincipalId: string) =>
    usageRecommendations(db, input, actorPrincipalId),
  getContextProfile: (input: Parameters<typeof getContextProfile>[1], actorPrincipalId: string) =>
    getContextProfile(db, input, actorPrincipalId),
  setContextProfile: (input: Parameters<typeof setContextProfile>[1], actorPrincipalId: string) =>
    setContextProfile(db, input, actorPrincipalId),

  // Brain root-admin surfaces (M8-05)
  getBrainGraph: (input: Parameters<typeof getBrainGraph>[1], actorPrincipalId: string) =>
    getBrainGraph(db, input, actorPrincipalId),
  getBrainEngineOps: (input: Parameters<typeof getBrainEngineOps>[1], actorPrincipalId: string) =>
    getBrainEngineOps(db, input, actorPrincipalId),
  assertBrainManualTriggerAllowed: (input: Parameters<typeof assertBrainManualTriggerAllowed>[1], actorPrincipalId: string) =>
    assertBrainManualTriggerAllowed(db, input, actorPrincipalId),
  runBrainEngine: (input: BrainRunInput, actorPrincipalId: string) =>
    runNativeBrainEngine(db, input, actorPrincipalId, { llm: getBrainLlmClient(), github: getBrainGitHubClient() }),

  // Creation wizard intake (M8-04)
  ensureDraftIntakeForScope: (input: Parameters<typeof ensureDraftIntakeForScope>[1], actorPrincipalId: string) =>
    ensureDraftIntakeForScope(db, input, actorPrincipalId),
  listIntakePackets: (input: Parameters<typeof listIntakePackets>[1], actorPrincipalId: string) =>
    listIntakePackets(db, input, actorPrincipalId),
  getIntakePacket: (id: string, actorPrincipalId: string) =>
    getIntakePacket(db, id, actorPrincipalId),
  updateIntakePacket: (input: Parameters<typeof updateIntakePacket>[1], actorPrincipalId: string) =>
    updateIntakePacket(db, input, actorPrincipalId),
  submitIntakePacket: (input: Parameters<typeof submitIntakePacket>[1], actorPrincipalId: string) =>
    submitIntakePacket(db, input, actorPrincipalId),
  findRelatedHistory: (input: Parameters<typeof findRelatedHistory>[1], actorPrincipalId: string) =>
    findRelatedHistory(db, input, actorPrincipalId),
  findReusePatterns: (input: Parameters<typeof findReusePatterns>[1], actorPrincipalId: string) =>
    findReusePatterns(db, input, actorPrincipalId),
  acceptReusePattern: (input: Parameters<typeof acceptReusePattern>[1], actorPrincipalId: string) =>
    acceptReusePattern(db, input, actorPrincipalId),
  assembleIntakeExternalPack: (input: Parameters<typeof assembleIntakeExternalPack>[1], actorPrincipalId: string) =>
    assembleIntakeExternalPack(db, input, actorPrincipalId),
  approveIntakePacket: (input: Parameters<typeof approveIntakePacket>[1], actorPrincipalId: string) =>
    approveIntakePacket(db, input, actorPrincipalId),
  listAttentionItems: (input: Parameters<typeof listAttentionItems>[1], actorPrincipalId: string) =>
    listAttentionItems(db, input, actorPrincipalId),
  countOpenAttentionItems: (input: Parameters<typeof countOpenAttentionItems>[1], actorPrincipalId: string) =>
    countOpenAttentionItems(db, input, actorPrincipalId),
  resolveAttentionItem: (input: Parameters<typeof resolveAttentionItem>[1], actorPrincipalId: string) =>
    resolveAttentionItem(db, input, actorPrincipalId),
  rejectIntakePacket: (input: Parameters<typeof rejectIntakePacket>[1], actorPrincipalId: string) =>
    rejectIntakePacket(db, input, actorPrincipalId),
  dismissIntakePacket: (input: Parameters<typeof dismissIntakePacket>[1], actorPrincipalId: string) =>
    dismissIntakePacket(db, input, actorPrincipalId),
  reopenIntakePacket: (input: Parameters<typeof reopenIntakePacket>[1], actorPrincipalId: string) =>
    reopenIntakePacket(db, input, actorPrincipalId),
  provisionFromIntakePacket: (input: Parameters<typeof provisionFromIntakePacket>[2], actorPrincipalId: string) =>
    provisionFromIntakePacket(db, { plane: getPlaneClient(), github: getBrainGitHubClient() }, input, actorPrincipalId),
  listWizardTemplates: (actorPrincipalId: string) =>
    listWizardTemplates(db, actorPrincipalId),
  listWizardFramingQuestions: (actorPrincipalId: string) =>
    listWizardFramingQuestions(db, actorPrincipalId),
  saveWizardTemplate: (input: Omit<Parameters<typeof saveWizardTemplate>[2], "repo"> & { repo?: string }, actorPrincipalId: string) => {
    const repo = input.repo || process.env.SKILLS_REPO;
    if (!repo) throw new Error("SKILLS_REPO is required");
    const client = getBrainGitHubClient();
    if (!client) throw new Error("GitHub client not configured");
    return saveWizardTemplate(db, client, { ...input, repo }, actorPrincipalId);
  },

  // Ops health (M9-01)
  getOpsHealth: (input: Parameters<typeof getOpsHealth>[1], actorPrincipalId: string, deps?: Parameters<typeof getOpsHealth>[3]) =>
    getOpsHealth(db, input, actorPrincipalId, deps),

  // Tenant admin (M5-04)
  listAdminUsers: (actorPrincipalId: string) =>
    listAdminUsers(db, getBetterAuthAdmin(), actorPrincipalId),
  createAdminUser: (input: CreateAdminUserInput, actorPrincipalId: string) =>
    createAdminUser(db, getBetterAuthAdmin(), input, actorPrincipalId),
  disableAdminUser: (input: { authUserId: string }, actorPrincipalId: string) =>
    disableAdminUser(db, getBetterAuthAdmin(), input, actorPrincipalId),
  resetAdminUserTempPassword: (input: { authUserId: string }, actorPrincipalId: string) =>
    resetAdminUserTempPassword(db, getBetterAuthAdmin(), input, actorPrincipalId),
  isTempPasswordChangeRequired: (actorPrincipalId: string) =>
    isTempPasswordChangeRequired(db, actorPrincipalId),
  completeTempPasswordChange: (actorPrincipalId: string) =>
    completeTempPasswordChange(db, actorPrincipalId),
  listAdminGrants: (actorPrincipalId: string) =>
    listAdminGrants(db, actorPrincipalId),
  grantAdminRole: (input: { principalId: string; scopePath: string; role: "owner" | "admin" | "editor" | "viewer" | "agent" }, actorPrincipalId: string) =>
    grantAdminRole(db, input, actorPrincipalId),
  revokeAdminGrant: (input: { principalId: string; scopePath: string }, actorPrincipalId: string) =>
    revokeAdminGrant(db, input, actorPrincipalId),
  listAdminActivity: (input: { type?: string; limit?: number }, actorPrincipalId: string) =>
    listAdminActivity(db, input, actorPrincipalId),
  listAdminAutomations: (actorPrincipalId: string) =>
    listAdminAutomations(db, actorPrincipalId),
  listAdminAlerts: (actorPrincipalId: string) =>
    listAdminAlerts(db, actorPrincipalId),
  getAdminSettings: (actorPrincipalId: string) =>
    getAdminSettings(db, actorPrincipalId),
  listGrantablePrincipals: (actorPrincipalId: string) =>
    listGrantablePrincipals(db, actorPrincipalId),
  getAdminLiteLlmState: (actorPrincipalId: string) =>
    getAdminLiteLlmState(db, getLiteLlmAdminConfig(), actorPrincipalId),
  mintAdminLiteLlmKey: (input: MintLiteLlmKeyInput, actorPrincipalId: string) =>
    mintAdminLiteLlmKey(db, getLiteLlmAdminConfig(), input, actorPrincipalId),
  revokeAdminLiteLlmKey: (input: { key: string; alias?: string | null }, actorPrincipalId: string) =>
    revokeAdminLiteLlmKey(db, getLiteLlmAdminConfig(), input, actorPrincipalId),
  setAdminLiteLlmKeyBudget: (input: { key: string; alias?: string | null; budgetUsd: number }, actorPrincipalId: string) =>
    setAdminLiteLlmKeyBudget(db, getLiteLlmAdminConfig(), input, actorPrincipalId),
};

export { db }; // only for auth wiring internally

/**
 * Resolve (or bootstrap-link) the kernel principal id for the current Better Auth session.
 * Used by all protected server components/pages before calling services as `actor`.
 * Returns null if no session (should be caught by middleware/layout).
 */
export async function getCurrentActorPrincipalId(): Promise<string | null> {
  const { headers } = await import("next/headers");
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return null;

  const authUserId = session.user.id as string;
  let pid = await getPrincipalIdForAuthUser(db, authUserId);
  if (!pid) {
    const linkRes = await linkAuthUser(db, {
      authUserId,
      email: (session.user.email as string) || null,
      name: (session.user.name as string) || (session.user.email as string) || "User",
    });
    pid = linkRes.principalId;
  }
  return pid;
}

// Convenience bound service calls that auto-resolve actor when possible (for pages)
export async function getSubtreeForCurrent(path: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("No actor for subtree");
  // Note: getSubtree does not enforce access in kernel (viewer assumed for read in tree), call direct
  return getSubtree(db, path);
}

export async function getVisibleTreeForCurrent() {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("No actor for visible tree");
  return getVisibleTree(db, actor);
}

export async function createScopeForCurrent(input: Parameters<typeof createScope>[1]) {
  const actor = await getCurrentActorPrincipalId();
  return createScope(db, input, actor);
}

export async function resolveAccessForCurrent(scopePath: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;
  return resolveAccess(db, actor, scopePath);
}
