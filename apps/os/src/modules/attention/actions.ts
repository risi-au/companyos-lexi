"use server";

import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { revalidatePath } from "next/cache";

function requireActor(actor: string | null): string {
  if (!actor) throw new Error("Your session expired. Sign in again.");
  return actor;
}

export async function resolveAttentionFormAction(formData: FormData) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  const id = String(formData.get("id") ?? "");
  const scopePath = String(formData.get("scopePath") ?? "root");
  const resolution = String(formData.get("resolution") ?? "");
  const noteValue = String(formData.get("note") ?? "").trim();
  if (resolution !== "approved" && resolution !== "rejected" && resolution !== "dismissed") {
    throw new Error(`Invalid attention resolution: ${resolution}`);
  }
  await api.resolveAttentionItem({ id, resolution, note: noteValue || undefined }, actor);
  revalidatePath(`/s/${scopePath}`);
  revalidatePath("/s/root");
}

export interface WikiQuestionActionState {
  error?: string;
}

function friendlyWikiQuestionError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Attention item not found")) return "This wiki question is no longer available. Refresh the page.";
  if (message.includes("Document not found") || message.includes("Scope not found")) return "A linked wiki page is no longer available. Refresh and review the latest pages.";
  if (message.includes("Access denied")) return "You need administrator permission to resolve this wiki question.";
  return message || "CompanyOS could not save that outcome. Refresh and try again.";
}

export async function resolveWikiQuestionFormAction(_previousState: WikiQuestionActionState, formData: FormData): Promise<WikiQuestionActionState> {
  try {
    const actor = requireActor(await getCurrentActorPrincipalId());
    const id = String(formData.get("id") ?? "");
    const scopePath = String(formData.get("scopePath") ?? "root");
    const action = String(formData.get("wikiAction") ?? "");
    const noteValue = String(formData.get("note") ?? "").trim();
    if (action === "choose") {
      const choiceId = String(formData.get("choiceId") ?? "");
      if (choiceId !== "first" && choiceId !== "second") throw new Error("Choose a valid wiki outcome.");
      await api.resolveWikiQuestionAttentionItem({ id, action: { type: "choose", choiceId, note: noteValue || undefined } }, actor);
    } else if (action === "not-a-conflict") {
      await api.resolveWikiQuestionAttentionItem({ id, action: { type: "not-a-conflict", note: noteValue || undefined } }, actor);
    } else if (action === "mark-current") {
      const nextReviewAt = String(formData.get("nextReviewAt") ?? "");
      await api.resolveWikiQuestionAttentionItem({ id, action: { type: "mark-current", nextReviewAt, note: noteValue || undefined } }, actor);
    } else if (action === "close-unclear") {
      await api.resolveWikiQuestionAttentionItem({ id, action: { type: "close-unclear", note: noteValue || undefined } }, actor);
    } else {
      throw new Error(`Invalid wiki question action: ${action}`);
    }
    revalidatePath(`/s/${scopePath}`);
    revalidatePath("/s/root");
    return {};
  } catch (error) {
    return { error: friendlyWikiQuestionError(error) };
  }
}
