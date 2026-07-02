/**
 * Server-only service bindings for apps/os.
 * Creates the DB handle (allowed only for wiring services + auth adapter per brief).
 * All page/server components MUST call through these wrappers — never raw @companyos/db queries.
 * This keeps "services only" contract.
 */
import "server-only";
import { createDb } from "@companyos/db";
import { auth } from "@/lib/auth";
import {
  getSubtree,
  getScope,
  createScope,
  listEvents,
  listRecords,
  listTasks,
  resolveAccess,
  linkAuthUser,
  getPrincipalIdForAuthUser,
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
  saveCanvas,
  getCanvas,
  listCanvases,
  archiveCanvas,
} from "@companyos/api";

// Singleton DB for the lifetime of the server process (dev/prod)
const db = createDb();

// Graceful Plane stub when not configured (M2-03: handle Plane-unconfigured gracefully)
function getPlaneClient(): any { // eslint-disable-line @typescript-eslint/no-explicit-any -- plane or stub boundary
  const token = process.env.PLANE_API_TOKEN;
  const baseUrl = process.env.PLANE_BASE_URL || "http://localhost:8090";
  const workspace = process.env.PLANE_WORKSPACE_SLUG || "companyos";
  if (!token) {
    // Full stub implementing surface used by service (no-ops / empties to avoid crashes)
    return {
      listIssues: async () => [],
      getProjects: async () => [],
      createProject: async () => ({ id: "stub" }),
      createLabel: async () => ({ id: "stub" }),
      getStates: async () => [],
    };
  }
  return new PlaneClient({ baseUrl, apiToken: token, workspaceSlug: workspace });
}

// Re-export bound versions (first arg db pre-filled)
export const api = {
  // Scopes / tree
  getSubtree: (path: string) => getSubtree(db, path),
  getScope: (path: string) => getScope(db, path),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createScope: (input: any, actor?: string | null) =>
    createScope(db, input, actor),

  // Events
  listEvents: (input?: Parameters<typeof listEvents>[1]) => listEvents(db, input),

  // Records
  listRecords: (input: Parameters<typeof listRecords>[1], actorPrincipalId: string) =>
    listRecords(db, input, actorPrincipalId),

  // Tasks (injects stub/real plane)
  listTasks: (input: Parameters<typeof listTasks>[2], actorPrincipalId: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listTasks(db, getPlaneClient() as any, input, actorPrincipalId),

  // Grants
  resolveAccess: (principalId: string, scopePath: string) =>
    resolveAccess(db, principalId, scopePath),

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

export async function createScopeForCurrent(input: Parameters<typeof createScope>[1]) {
  const actor = await getCurrentActorPrincipalId();
  return createScope(db, input, actor);
}

export async function resolveAccessForCurrent(scopePath: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;
  return resolveAccess(db, actor, scopePath);
}
