/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";
import { createLiteLlmBrainClient, runBrainEngine, type BrainRunMode } from "@companyos/brain";
import { AccessDeniedError } from "@companyos/api";
import {
  authenticateAgentRequest,
  unauthorized,
  jsonError,
  db,
} from "@/lib/agent-auth";

const VALID_MODES = new Set<BrainRunMode>(["ingest", "lint", "backfill"]);

function envNumber(name: string): number | undefined {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function llmClient() {
  const baseUrl = process.env.LITELLM_BASE_URL || "http://localhost:4000";
  const apiKey = process.env.BRAIN_LITELLM_API_KEY || "";
  if (!apiKey) {
    throw new Error("BRAIN_LITELLM_API_KEY is required for brain runs");
  }
  return createLiteLlmBrainClient({ baseUrl, apiKey });
}

export async function POST(req: Request) {
  try {
    const { principalId } = await authenticateAgentRequest(req);
    const body = await req.json().catch(() => ({}));
    const mode = String(body?.mode || "ingest") as BrainRunMode;
    if (!VALID_MODES.has(mode)) {
      return jsonError("mode must be ingest, lint, or backfill", 400);
    }
    const result = await runBrainEngine(
      db,
      {
        mode,
        scopePath: typeof body?.scope === "string" ? body.scope : body?.scopePath,
        runRef: typeof body?.runRef === "string" ? body.runRef : undefined,
        tokenCeiling: typeof body?.tokenCeiling === "number" ? body.tokenCeiling : envNumber("BRAIN_RUN_TOKEN_CEILING"),
        monthlyTokenBudget: envNumber("BRAIN_MONTHLY_TOKEN_BUDGET"),
      },
      principalId,
      { llm: llmClient() }
    );
    return Response.json({ ok: true, result });
  } catch (e: any) {
    if (e instanceof AccessDeniedError) {
      return jsonError("Forbidden", 403, { requires: `${e.requiredRole} on ${e.scopePath}` });
    }
    if (e?.status === 401) {
      return unauthorized();
    }
    return jsonError(e?.message || "Bad request", e?.status || 400);
  }
}
