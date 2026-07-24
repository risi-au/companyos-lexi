import type { SessionBrief } from "@companyos/db";
import { emitEvent, type DB } from "../../kernel/events";
import { getPersonalScopePath } from "../../kernel/personal-path";
import { getScope } from "../../kernel/scopes";
import { requireAccess } from "../../kernel/grants";
import { ScopeNotFoundError } from "../../errors";
import { getDoc, saveDoc } from "../docs/service";

export type KickoffLayer = "personal" | "scope";
export type KickoffSource = "run" | "personal" | "scope" | "template";
export type KickoffConnectivity = "full" | "checklist" | "paste";

export interface KickoffQuestion {
  key: string;
  question: string;
  layer?: KickoffLayer;
  default?: string;
}

export interface ResolvedAnswer {
  key: string;
  question: string;
  answer: string | null;
  source: KickoffSource | null;
  layer: KickoffLayer;
}

export interface ResolveKickoffInput {
  scopePath: string;
  questions: KickoffQuestion[];
  runAnswers?: Record<string, string>;
}

export interface ResolveKickoffResult {
  resolved: ResolvedAnswer[];
  misses: string[];
}

export interface RecordKickoffInput {
  scopePath: string;
  answers: Record<string, string>;
  target: KickoffLayer;
}

export interface AssembleKickoffInput {
  scopePath: string;
  goal: string;
  connectivity: KickoffConnectivity;
  questions?: KickoffQuestion[];
  runAnswers?: Record<string, string>;
}

export interface KickoffArtifact {
  tier: KickoffConnectivity;
  artifact: string;
  brief: SessionBrief;
  resolved: ResolvedAnswer[];
  misses: string[];
}

function nonEmptyValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function sortedAnswers(answers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(answers).sort(([left], [right]) => left.localeCompare(right)));
}

export function parseKickoffAnswers(bodyMd: string | null | undefined): Record<string, string> {
  if (!bodyMd) return {};

  // Match the LAST fenced json block: renderKickoffDoc always emits the canonical
  // block last, after the human-readable bullet list. Matching the last block makes
  // parsing immune to an answer value that itself contains a ```json fence (which
  // would otherwise inject an earlier, attacker/typo-controlled block).
  const matches = [...bodyMd.matchAll(/```json\s*\r?\n([\s\S]*?)\r?\n```/g)];
  const match = matches[matches.length - 1];
  if (!match?.[1]) return {};

  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  } catch {
    return {};
  }
}

export function renderKickoffDoc(kind: KickoffLayer, answers: Record<string, string>): string {
  const stableAnswers = sortedAnswers(answers);
  const label = kind === "personal" ? "personal profile" : "scope defaults";
  const lines = Object.entries(stableAnswers).map(([key, value]) => `- ${key}: ${value}`);

  return [
    `<!-- Kickoff ${label} answers -->`,
    "",
    "## Answers",
    ...lines,
    "",
    "```json",
    JSON.stringify(stableAnswers, null, 2),
    "```",
  ].join("\n");
}

async function readKickoffAnswers(
  db: DB,
  scopePath: string,
  slug: string,
  actorPrincipalId: string
): Promise<Record<string, string>> {
  try {
    const doc = await getDoc(db, { scopePath, slug }, actorPrincipalId);
    return parseKickoffAnswers(doc?.bodyMd);
  } catch {
    return {};
  }
}

export async function resolveKickoffAnswers(
  db: DB,
  input: ResolveKickoffInput,
  actorPrincipalId: string
): Promise<ResolveKickoffResult> {
  const scope = await getScope(db, input.scopePath);
  if (!scope) throw new ScopeNotFoundError(input.scopePath);
  await requireAccess(db, actorPrincipalId, input.scopePath, "viewer");

  // Personal layer is the actor's own scope and may not exist (e.g. agent principals);
  // read it gracefully. The scope layer read is NOT swallowed: viewer is already enforced
  // above, so a getDoc failure here is a real error, not a masked access denial.
  const personalAnswers = await readKickoffAnswers(
    db,
    getPersonalScopePath(actorPrincipalId),
    "kickoff-profile",
    actorPrincipalId
  );
  const scopeDoc = await getDoc(db, { scopePath: input.scopePath, slug: "kickoff-defaults" }, actorPrincipalId);
  const scopeAnswers = parseKickoffAnswers(scopeDoc?.bodyMd);

  const resolved = input.questions.map((question): ResolvedAnswer => {
    const candidates: Array<[KickoffSource, string | undefined]> = [
      ["run", input.runAnswers?.[question.key]],
      ["personal", personalAnswers[question.key]],
      ["scope", scopeAnswers[question.key]],
      ["template", question.default],
    ];
    const hit = candidates.find(([, value]) => nonEmptyValue(value) !== null);

    return {
      key: question.key,
      question: question.question,
      answer: hit ? nonEmptyValue(hit[1]) : null,
      source: hit?.[0] ?? null,
      layer: question.layer ?? "scope",
    };
  });

  return {
    resolved,
    misses: resolved.filter((answer) => answer.answer === null).map((answer) => answer.key),
  };
}

export async function recordKickoffAnswers(
  db: DB,
  input: RecordKickoffInput,
  actorPrincipalId: string
): Promise<{ layer: KickoffLayer; slug: string; scopePath: string; written: string[] }> {
  const isPersonal = input.target === "personal";
  const scopePath = isPersonal ? getPersonalScopePath(actorPrincipalId) : input.scopePath;
  const slug = isPersonal ? "kickoff-profile" : "kickoff-defaults";
  const title = isPersonal ? "Kickoff profile" : "Kickoff defaults";
  const incoming = Object.fromEntries(
    Object.entries(input.answers).flatMap(([key, value]) => {
      const answer = nonEmptyValue(value);
      return answer ? [[key, answer]] : [];
    })
  );

  // No non-blank answers: skip the write entirely. saveDoc creates a revision and
  // triggers embeddings/wikilink/follower side-effects, so a no-op write would be
  // spurious noise. Emit nothing.
  if (Object.keys(incoming).length === 0) {
    return { layer: input.target, slug, scopePath, written: [] };
  }

  const existing = await getDoc(db, { scopePath, slug }, actorPrincipalId);
  const merged = { ...parseKickoffAnswers(existing?.bodyMd), ...incoming };

  await saveDoc(
    db,
    { scopePath, slug, title, bodyMd: renderKickoffDoc(input.target, merged) },
    actorPrincipalId
  );
  await emitEvent(db, {
    type: "kickoff.answers_recorded",
    scopePath,
    principalId: actorPrincipalId,
    payload: { layer: input.target, slug, keys: Object.keys(incoming) },
  });

  return { layer: input.target, slug, scopePath, written: Object.keys(incoming) };
}

function resolvedLines(resolved: ResolvedAnswer[]): string[] {
  return resolved
    .filter((answer): answer is ResolvedAnswer & { answer: string; source: KickoffSource } => answer.answer !== null && answer.source !== null)
    .map((answer) => `- ${answer.key}: ${answer.answer} (${answer.source})`);
}

function openQuestionLines(resolved: ResolvedAnswer[]): string[] {
  return resolved
    .filter((answer) => answer.answer === null)
    .map((answer) => `- [ ] ${answer.question}`);
}

function buildFullArtifact(goal: string, scopePath: string, resolved: ResolvedAnswer[]): string {
  const known = resolvedLines(resolved);
  const questions = openQuestionLines(resolved);
  return [
    "# Kickoff",
    "",
    `Goal: ${goal}`,
    `Scope: ${scopePath}`,
    "",
    "Use the arming ritual, then run the start_task prompt:",
    "1. whoami -> get_context -> recall_memory -> register_session -> list_attention_items",
    "2. Confirm the defaults and open questions below before work begins.",
    "",
    "## Resolved defaults",
    ...(known.length > 0 ? known : ["- None"]),
    "",
    "## Open questions",
    ...(questions.length > 0 ? questions : ["- None"]),
  ].join("\n");
}

function buildChecklistArtifact(goal: string, scopePath: string, resolved: ResolvedAnswer[]): string {
  const known = resolvedLines(resolved).map((line) => line.replace("- ", "- [x] "));
  const questions = openQuestionLines(resolved);
  return [
    "# Kickoff checklist",
    "",
    `Goal: ${goal}`,
    `Scope: ${scopePath}`,
    "",
    "## Known (from your profile/scope defaults)",
    ...(known.length > 0 ? known : ["- [x] None"]),
    "",
    "## Answer these",
    ...(questions.length > 0 ? questions : ["- [ ] None"]),
  ].join("\n");
}

function buildPasteArtifact(goal: string, scopePath: string, resolved: ResolvedAnswer[]): string {
  const known = resolvedLines(resolved);
  const questions = openQuestionLines(resolved);
  return [
    "# Self-contained kickoff pack",
    "",
    `Goal: ${goal}`,
    `Scope: ${scopePath}`,
    "",
    "## Resolved answers",
    ...(known.length > 0 ? known : ["- None"]),
    "",
    "## Open questions",
    ...(questions.length > 0 ? questions : ["- None"]),
    "",
    "## Manual ritual",
    "1. Identify who is responsible for this work and review the available project context.",
    "2. Review relevant remembered knowledge, notes, and prior decisions for this scope.",
    "3. Record the session goal, scope, and expected result in your working log.",
    "4. Check outstanding approvals, blockers, and questions before beginning.",
  ].join("\n");
}

export async function assembleKickoffArtifact(
  db: DB,
  input: AssembleKickoffInput,
  actorPrincipalId: string
): Promise<KickoffArtifact> {
  const goal = input.goal.trim();
  if (!goal) throw new Error("Kickoff goal is required");

  let result: ResolveKickoffResult;
  if (input.questions && input.questions.length > 0) {
    // resolveKickoffAnswers enforces scope existence + viewer access.
    result = await resolveKickoffAnswers(
      db,
      { scopePath: input.scopePath, questions: input.questions, runAnswers: input.runAnswers },
      actorPrincipalId
    );
  } else {
    // No questions to resolve, but still honor the documented "requires viewer" contract.
    const scope = await getScope(db, input.scopePath);
    if (!scope) throw new ScopeNotFoundError(input.scopePath);
    await requireAccess(db, actorPrincipalId, input.scopePath, "viewer");
    result = { resolved: [], misses: [] };
  }
  const artifact = input.connectivity === "full"
    ? buildFullArtifact(goal, input.scopePath, result.resolved)
    : input.connectivity === "checklist"
      ? buildChecklistArtifact(goal, input.scopePath, result.resolved)
      : buildPasteArtifact(goal, input.scopePath, result.resolved);

  return {
    tier: input.connectivity,
    artifact,
    brief: { goal, contextRefs: [input.scopePath] },
    resolved: result.resolved,
    misses: result.misses,
  };
}
