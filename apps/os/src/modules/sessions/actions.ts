"use server";

import { api, getCurrentActorPrincipalId } from "@/lib/api";

export interface ListSessionsActionInput {
  scopePath: string;
  status?: "running" | "waiting" | "idle" | "completed" | "error" | "all";
  includeDescendants?: boolean;
}

export async function listSessionsAction(input: ListSessionsActionInput) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Your session expired. Sign in again.");

  return api.listSessions(
    {
      scopePath: input.scopePath,
      includeDescendants: input.includeDescendants ?? true,
      status: input.status && input.status !== "all" ? input.status : undefined,
    },
    actor
  );
}
