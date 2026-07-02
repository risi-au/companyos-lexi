"use server";
import "server-only";
import { api, getCurrentActorPrincipalId } from "@/lib/api";
import type { LLMConfig } from "@companyos/api";

// Env only at this boundary (UI server action). Tests bypass via direct service calls.
function getLLMConfig(): LLMConfig {
  return {
    baseUrl: process.env.LITELLM_BASE_URL || "http://localhost:4000",
    apiKey: process.env.LITELLM_MASTER_KEY || "sk-",
  };
}

export async function runAgentTurnAction(params: {
  conversationId?: string;
  scopePath: string;
  userMessage: string;
  model?: string;
}) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("No authenticated actor");
  const llm = getLLMConfig();
  // Note: plane stub handled inside api wrapper
  return api.runTurn(
    {
      conversationId: params.conversationId,
      scopePath: params.scopePath,
      userMessage: params.userMessage,
      model: params.model,
    },
    actor,
    llm
  );
}

export async function listConversationsAction(scopePath: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return [];
  return api.listConversations({ scopePath }, actor);
}

export async function getMessagesAction(conversationId: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return [];
  return api.getConversationMessages({ conversationId }, actor);
}
