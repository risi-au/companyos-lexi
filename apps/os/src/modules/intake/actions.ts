"use server";

import { api, getCurrentActorPrincipalId } from "@/lib/api";
import type { RelatedHistorySelection } from "@companyos/api";
import { revalidatePath } from "next/cache";
import type { OpenQuestionEntry } from "./open-questions";

function requireActor(actor: string | null): string {
  if (!actor) throw new Error("Your session expired. Sign in again.");
  return actor;
}

function parseJson(text: string, fallback: unknown): unknown {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  return JSON.parse(trimmed);
}

// Known domain errors that should surface as structured action results (not raw
// 500s). Kept to an explicit allowlist so unrelated library errors (whose names
// might happen to end in "ValidationError") still throw. JSON parse failures are
// handled locally at their call site, not here.
const KNOWN_DOMAIN_ERROR_NAMES = new Set(["IntakeStateError"]);
function isKnownDomainError(error: unknown): error is Error {
  return error instanceof Error && KNOWN_DOMAIN_ERROR_NAMES.has(error.name);
}

type ActionFailure = { ok: false; error: string };

function actionFailure(error: unknown): ActionFailure {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Something went wrong with this setup action.",
  };
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
  // Merge over stored answers: the form only carries string framing fields, and
  // a whole-object replace would drop system metadata written at submit time
  // (required_credentials, external_systems, submission_markdown_only).
  const current = await api.getIntakePacket(input.intakeId, actor);
  const preserved = current.answers && typeof current.answers === "object" && !Array.isArray(current.answers)
    ? Object.fromEntries(Object.entries(current.answers as Record<string, unknown>).filter(([, value]) => typeof value !== "string"))
    : {};
  const updated = await api.updateIntakePacket({ id: input.intakeId, answers: { ...preserved, ...input.answers } }, actor);
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
  const intake = await api.getIntakePacket(input.intakeId, actor);
  revalidatePath(`/s/${input.scopePath}`);
  return { pack, intake };
}

export async function getIntakeAction(input: { intakeId: string; scopePath: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  return api.getIntakePacket(input.intakeId, actor);
}

export async function saveOpenQuestionsAction(input: {
  intakeId: string;
  scopePath: string;
  openQuestions: OpenQuestionEntry[];
}) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  const updated = await api.updateIntakePacket({ id: input.intakeId, openQuestions: input.openQuestions }, actor);
  revalidatePath(`/s/${input.scopePath}`);
  return updated;
}

export async function submitPasteAction(input: { intakeId: string; pasteText: string; scopePath: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  try {
    const result = await api.submitIntakePacket({ id: input.intakeId, pasteText: input.pasteText }, actor);
    revalidatePath(`/s/${input.scopePath}`);
    return {
      ok: true as const,
      intake: result.intake,
      markdownOnly: result.markdownOnly,
      errors: result.errors,
    };
  } catch (error) {
    if (isKnownDomainError(error)) return actionFailure(error);
    throw error;
  }
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
  let proposedProvisionSpec: unknown;
  let proposedDocs: unknown;
  let proposedTasks: unknown;
  let proposedWikiUpdates: unknown;
  let openQuestions: unknown;
  let riskNotes: unknown;
  try {
    proposedProvisionSpec = parseJson(input.specJson, {});
    proposedDocs = parseJson(input.docsJson, []);
    proposedTasks = parseJson(input.tasksJson, []);
    proposedWikiUpdates = parseJson(input.wikiJson, []);
    openQuestions = parseJson(input.questionsJson, []);
    riskNotes = parseJson(input.risksJson, []);
  } catch {
    return { ok: false as const, error: "One of the review fields is not valid JSON. Fix it and try again." };
  }
  try {
    const updated = await api.updateIntakePacket({
      id: input.intakeId,
      proposedProvisionSpec,
      proposedDocs,
      proposedTasks,
      proposedWikiUpdates,
      openQuestions,
      riskNotes,
    }, actor);
    revalidatePath(`/s/${input.scopePath}`);
    return { ok: true as const, intake: updated };
  } catch (error) {
    if (isKnownDomainError(error)) return actionFailure(error);
    throw error;
  }
}

export async function approveIntakeAction(input: { intakeId: string; scopePath: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  try {
    const updated = await api.approveIntakePacket({ id: input.intakeId }, actor);
    revalidatePath(`/s/${input.scopePath}`);
    return { ok: true as const, intake: updated };
  } catch (error) {
    if (isKnownDomainError(error)) return actionFailure(error);
    throw error;
  }
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
  try {
    const result = await api.provisionFromIntakePacket({ id: input.intakeId }, actor);
    revalidatePath(`/s/${input.scopePath}`);
    return { ok: true as const, result };
  } catch (error) {
    if (isKnownDomainError(error)) return actionFailure(error);
    throw error;
  }
}

export async function saveWizardTemplateAction(input: { path: string; body: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  return api.saveWizardTemplate({ path: input.path, body: input.body }, actor);
}
