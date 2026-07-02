"use server";

import { revalidatePath } from "next/cache";
import { api, getCurrentActorPrincipalId } from "@/lib/api";

/**
 * Server actions for Canvas tab (M3-03). All call through api wrappers into packages/api services.
 * Access enforced in service layer. Autosave from client debounced.
 */

export async function listCanvasesAction(scopePath: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Not authenticated");
  return api.listCanvases({ scopePath }, actor);
}

export async function getCanvasAction(scopePath: string, slug: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Not authenticated");
  return api.getCanvas({ scopePath, slug }, actor);
}

export async function saveCanvasAction(input: { scopePath: string; slug?: string; name: string; scene?: unknown }) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Not authenticated");
  const saved = await api.saveCanvas(input, actor);
  revalidatePath(`/s/${input.scopePath}?tab=canvas`);
  return saved;
}

export async function archiveCanvasAction(scopePath: string, slug: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Not authenticated");
  const archived = await api.archiveCanvas({ scopePath, slug }, actor);
  revalidatePath(`/s/${scopePath}?tab=canvas`);
  return archived;
}

export async function getAccessAction(scopePath: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;
  return api.resolveAccess(actor, scopePath);
}
