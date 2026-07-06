"use server";

import { revalidatePath } from "next/cache";
import { api, getCurrentActorPrincipalId } from "@/lib/api";

export async function listConnectionTokensAction(scopePath: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Not authenticated");
  return api.listConnectionTokens({ scopePath }, actor);
}

export async function mintConnectionTokenAction(input: {
  scopePath: string;
  name: string;
  role: "agent" | "viewer";
  expiresAt?: string | null;
}) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Not authenticated");
  const minted = await api.mintConnectionToken({
    scopePath: input.scopePath,
    name: input.name,
    role: input.role,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
  }, actor);
  revalidatePath(`/s/${input.scopePath}?tab=connect`);
  return minted;
}

export async function revokeConnectionTokenAction(scopePath: string, tokenId: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Not authenticated");
  await api.revokeConnectionToken({ tokenId }, actor);
  revalidatePath(`/s/${scopePath}?tab=connect`);
}

export async function getConnectConfigAction() {
  const explicit = process.env.MCP_PUBLIC_URL?.trim();
  if (explicit) return { mcpPublicUrl: explicit };

  const companyOsUrl = process.env.COMPANYOS_URL?.trim().replace(/\/$/, "");
  return {
    mcpPublicUrl: companyOsUrl ? `${companyOsUrl}/api/mcp` : "/api/mcp",
  };
}
