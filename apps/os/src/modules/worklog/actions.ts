"use server";

import { api, getCurrentActorPrincipalId } from "@/lib/api";
import type { Record as DbRecord } from "@companyos/db";

export interface ListWorkLogRecordsInput {
  scopePath: string;
  kind?: DbRecord["kind"] | "all";
  since?: string;
  limit?: number;
}

export async function listWorkLogRecordsAction(input: ListWorkLogRecordsInput) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Your session expired. Sign in again.");

  return api.listRecords(
    {
      scopePath: input.scopePath,
      includeDescendants: true,
      kind: input.kind && input.kind !== "all" ? input.kind : undefined,
      since: input.since ? new Date(input.since) : undefined,
      limit: input.limit ?? 100,
    },
    actor
  );
}
