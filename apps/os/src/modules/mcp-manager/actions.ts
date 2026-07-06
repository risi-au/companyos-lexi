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

export interface QueryUsageActionInput {
  scope?: string;
  since?: string;
  groupBy?: "operation" | "scope" | "principal" | "token" | "connection" | "session" | "source" | "model" | "success";
  operation?: string;
  sessionId?: string;
  principalId?: string;
  tokenId?: string;
  connectionId?: string;
}

export async function queryUsageAction(input: QueryUsageActionInput) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Not authenticated");
  const scope = input.scope?.trim() || "root";
  const [usage, recommendations, profile] = await Promise.all([
    api.queryUsage(
      {
        scope,
        since: input.since ? new Date(input.since) : null,
        groupBy: input.groupBy || "operation",
        operation: input.operation?.trim() || null,
        sessionId: input.sessionId?.trim() || null,
        principalId: input.principalId?.trim() || null,
        tokenId: input.tokenId?.trim() || null,
        connectionId: input.connectionId?.trim() || null,
        limit: 500,
      },
      actor
    ),
    api.usageRecommendations({ scopePath: scope, since: input.since ? new Date(input.since) : null }, actor),
    api.getContextProfile({ scopePath: scope }, actor),
  ]);
  return { usage, recommendations, profile };
}

export async function setContextProfileAction(input: {
  scope: string;
  name: string;
  preset: "lean" | "standard" | "deep";
}) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Not authenticated");
  const result = await api.setContextProfile(
    {
      scopePath: input.scope.trim() || "root",
      name: input.name.trim() || input.preset,
      preset: input.preset,
      isDefault: true,
    },
    actor
  );
  revalidatePath("/admin/mcp");
  return result;
}
