"use server";

import { revalidatePath } from "next/cache";
import { api, getCurrentActorPrincipalId } from "@/lib/api";

export interface ListMcpConnectionsInput {
  scopePath?: string;
  principalId?: string;
  activeWithinDays?: number | null;
  expiringWithinDays?: number | null;
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function daysAhead(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

export async function listMcpConnectionsAction(input: ListMcpConnectionsInput) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Not authenticated");

  return api.listConnections(
    {
      scopePath: input.scopePath?.trim() || undefined,
      principalId: input.principalId?.trim() || undefined,
      activeSince: input.activeWithinDays ? daysAgo(input.activeWithinDays) : undefined,
      expiringWithin: input.expiringWithinDays ? daysAhead(input.expiringWithinDays) : undefined,
    },
    actor
  );
}

export async function revokeScopeAccessAction(scopePath: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Not authenticated");
  const result = await api.revokeScopeAccess({ scopePath }, actor);
  revalidatePath("/admin/mcp");
  return result;
}

export async function revokePrincipalAccessAction(principalId: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Not authenticated");
  const result = await api.revokePrincipalAccess({ principalId }, actor);
  revalidatePath("/admin/mcp");
  return result;
}
