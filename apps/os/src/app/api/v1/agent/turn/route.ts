/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";
import { runTurn, type LLMConfig } from "@companyos/api";
import {
  authenticateAgentRequest,
  jsonError,
  db,
} from "@/lib/agent-auth";

// Minimal plane stub (matches used surface; real injected at api layer normally)
async function getPlaneStub() {
  const token = process.env.PLANE_API_TOKEN;
  if (!token) {
    return {
      listIssues: async () => [],
      getProjects: async () => [],
      createProject: async () => ({ id: "stub" }),
      createLabel: async () => ({ id: "stub" }),
      getStates: async () => [],
      createIssue: async () => ({ id: "stub" }),
      updateIssue: async () => ({}),
    };
  }
  // Dynamic to avoid require lint
  const apiMod: any = await import("@companyos/api");
  const PlaneClient = apiMod.PlaneClient;
  const baseUrl = process.env.PLANE_BASE_URL || "http://localhost:8090";
  const workspace = process.env.PLANE_WORKSPACE_SLUG || "companyos";
  return new PlaneClient({ baseUrl, apiToken: token, workspaceSlug: workspace });
}

export async function POST(req: Request) {
  try {
    const { principalId } = await authenticateAgentRequest(req);
    const body = await req.json().catch(() => ({}));
    const { conversationId, scopePath, userMessage, model } = body || {};
    if (!userMessage || typeof userMessage !== "string") {
      return jsonError("userMessage (string) is required");
    }
    const base = process.env.LITELLM_BASE_URL || "http://localhost:4000";
    const key = process.env.LITELLM_MASTER_KEY || "sk-test";
    const llm: LLMConfig = { baseUrl: base, apiKey: key };
    const plane = await getPlaneStub();
    const result = await runTurn(
      db,
      { conversationId, scopePath, userMessage, model },
      principalId,
      llm,
      plane as any
    );
    return Response.json(result);
  } catch (e: any) {
    if (e?.status === 401) {
      return jsonError("Unauthorized", 401);
    }
    return jsonError(e?.message || "Bad request", e?.status || 400);
  }
}
