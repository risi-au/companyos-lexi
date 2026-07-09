"use server";

import { revalidatePath } from "next/cache";
import { api, getCurrentActorPrincipalId } from "@/lib/api";

/**
 * Server actions for Docs tab (M3-02). All call through api wrappers into packages/api services.
 * Access enforced in service layer via requireAccess + principal.
 */

export async function listDocsAction(scopePath: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Your session expired. Sign in again.");
  return api.listDocs({ scopePath }, actor);
}

export async function getDocAction(scopePath: string, slug: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Your session expired. Sign in again.");
  return api.getDoc({ scopePath, slug }, actor);
}

export async function saveDocAction(input: { scopePath: string; slug?: string; title: string; bodyMd?: string }) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Your session expired. Sign in again.");
  const saved = await api.saveDoc(input, actor);
  revalidatePath(`/s/${input.scopePath}?tab=docs`);
  return saved;
}

export async function renameDocAction(input: { scopePath: string; slug: string; newTitle?: string; newSlug?: string }) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Your session expired. Sign in again.");
  const updated = await api.renameDoc(input, actor);
  revalidatePath(`/s/${input.scopePath}?tab=docs`);
  return updated;
}

export async function archiveDocAction(scopePath: string, slug: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Your session expired. Sign in again.");
  const archived = await api.archiveDoc({ scopePath, slug }, actor);
  revalidatePath(`/s/${scopePath}?tab=docs`);
  return archived;
}

export async function listRevisionsAction(scopePath: string, slug: string, limit = 10) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Your session expired. Sign in again.");
  return api.listDocRevisions({ scopePath, slug, limit }, actor);
}

export async function revertDocAction(scopePath: string, slug: string, revisionId: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Your session expired. Sign in again.");
  const restored = await api.revertDoc({ scopePath, slug, revisionId }, actor);
  revalidatePath(`/s/${scopePath}?tab=docs`);
  return restored;
}

export async function getAccessAction(scopePath: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;
  return api.resolveAccess(actor, scopePath);
}

export async function getInheritedWikiAction(scopePath: string) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Your session expired. Sign in again.");
  const access = await api.resolveAccess(actor, scopePath);
  if (!access) throw new Error("You don't have access to this project's wiki.");
  const wiki = await api.findNearestWiki(scopePath);
  if (!wiki || wiki.scopePath === scopePath) return null;
  return wiki;
}
