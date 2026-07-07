"use server";

import { api, getCurrentActorPrincipalId } from "@/lib/api";
import type { RelatedHistorySelection } from "@companyos/api";
import { revalidatePath } from "next/cache";

function requireActor(actor: string | null): string {
  if (!actor) throw new Error("Not authenticated");
  return actor;
}

function parseJson(text: string, fallback: unknown): unknown {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  return JSON.parse(trimmed);
}

export async function saveFramingAction(input: { intakeId: string; answersJson: string; scopePath: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  const answers = parseJson(input.answersJson, {});
  const updated = await api.updateIntakePacket({ id: input.intakeId, answers }, actor);
  revalidatePath(`/s/${input.scopePath}`);
  return updated;
}

export async function saveFramingFieldsAction(input: { intakeId: string; answers: Record<string, string>; scopePath: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  const updated = await api.updateIntakePacket({ id: input.intakeId, answers: input.answers }, actor);
  revalidatePath(`/s/${input.scopePath}`);
  return updated;
}

export async function findRelatedHistoryAction(input: { intakeId: string; query?: string; scopePath: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  return api.findRelatedHistory({ intakeId: input.intakeId, query: input.query, limit: 10 }, actor);
}

export async function saveRelatedHistoryAction(input: { intakeId: string; selections: RelatedHistorySelection[]; scopePath: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  const updated = await api.updateIntakePacket({ id: input.intakeId, relatedHistorySelections: input.selections }, actor);
  revalidatePath(`/s/${input.scopePath}`);
  return updated;
}

export async function findReusePatternsAction(input: { scopePath: string; query: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  return api.findReusePatterns({ scopePath: input.scopePath, query: input.query, limit: 5 }, actor);
}

export async function acceptReusePatternAction(input: { intakeId: string; patternSlug: string; scopePath: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  const updated = await api.acceptReusePattern({ intakeId: input.intakeId, patternSlug: input.patternSlug }, actor);
  revalidatePath(`/s/${input.scopePath}`);
  return updated;
}

export async function externalPackAction(input: { intakeId: string; scopePath: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  const pack = await api.assembleIntakeExternalPack({ intakeId: input.intakeId }, actor);
  revalidatePath(`/s/${input.scopePath}`);
  return pack;
}

export async function submitPasteAction(input: { intakeId: string; pasteText: string; scopePath: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  const result = await api.submitIntakePacket({ id: input.intakeId, pasteText: input.pasteText }, actor);
  revalidatePath(`/s/${input.scopePath}`);
  return result;
}

export async function saveReviewAction(input: {
  intakeId: string;
  scopePath: string;
  specJson: string;
  docsJson: string;
  tasksJson: string;
  wikiJson: string;
  questionsJson: string;
  risksJson: string;
}) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  const updated = await api.updateIntakePacket({
    id: input.intakeId,
    proposedProvisionSpec: parseJson(input.specJson, {}),
    proposedDocs: parseJson(input.docsJson, []),
    proposedTasks: parseJson(input.tasksJson, []),
    proposedWikiUpdates: parseJson(input.wikiJson, []),
    openQuestions: parseJson(input.questionsJson, []),
    riskNotes: parseJson(input.risksJson, []),
  }, actor);
  revalidatePath(`/s/${input.scopePath}`);
  return updated;
}

export async function approveIntakeAction(input: { intakeId: string; scopePath: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  const updated = await api.approveIntakePacket({ id: input.intakeId }, actor);
  revalidatePath(`/s/${input.scopePath}`);
  return updated;
}

export async function rejectIntakeAction(input: { intakeId: string; scopePath: string; reason: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  const updated = await api.rejectIntakePacket({ id: input.intakeId, reason: input.reason }, actor);
  revalidatePath(`/s/${input.scopePath}`);
  return updated;
}

export async function dismissIntakeAction(input: { intakeId: string; scopePath: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  const updated = await api.dismissIntakePacket({ id: input.intakeId }, actor);
  revalidatePath(`/s/${input.scopePath}`);
  return updated;
}

export async function reopenIntakeAction(input: { intakeId: string; scopePath: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  const updated = await api.reopenIntakePacket({ id: input.intakeId }, actor);
  revalidatePath(`/s/${input.scopePath}`);
  return updated;
}

export async function provisionIntakeAction(input: { intakeId: string; scopePath: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  const result = await api.provisionFromIntakePacket({ id: input.intakeId }, actor);
  revalidatePath(`/s/${input.scopePath}`);
  return result;
}

export async function saveWizardTemplateAction(input: { path: string; body: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  return api.saveWizardTemplate({ path: input.path, body: input.body }, actor);
}
