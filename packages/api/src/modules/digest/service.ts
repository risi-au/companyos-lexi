/* eslint-disable @typescript-eslint/no-explicit-any */
import { type DB } from "../../kernel/events";
import { requireAccess } from "../../kernel/grants";
import { getScope } from "../../kernel/scopes";
import { ScopeNotFoundError } from "../../errors";
import { listSessions } from "../sessions/service";
import { listAttentionItems } from "../attention/service";
import { listTasks } from "../tasks/service";
import type { PlaneClient } from "../tasks/plane-client";

export type DigestLaneKey =
  | "waiting_for_feedback"
  | "waiting_for_approval"
  | "completed_to_review"
  | "automation_candidates"
  | "ready_to_start";

export interface DigestItem {
  id: string;
  title: string;
  scopePath: string;
  workType: string;
  status?: string;
  updatedAt?: Date;
  whyItNeedsYou?: string;
  whatHappensAfter?: string;
}

export interface DigestLane {
  key: DigestLaneKey;
  label: string;
  items: DigestItem[];
  note?: string;
}

export interface DigestOptions {
  scopePath: string;
  includeDescendants?: boolean;
  limit?: number;
}

export interface Digest {
  scopePath: string;
  lanes: DigestLane[];
}

/**
 * getDigest — assemble the daily digest: 5 lanes from 4 existing read services.
 * Lane 1: waiting_for_feedback — sessions stuck on "waiting" status.
 * Lane 2: waiting_for_approval — open attention items.
 * Lane 3: completed_to_review — recently completed sessions not yet reviewed.
 * Lane 4: automation_candidates — stub (empty + note) until brain-lint wiring.
 * Lane 5: ready_to_start — open tasks (degrades to empty + note if planeClient is null).
 *
 * Explainability: each item in lanes 1-3 carries whyItNeedsYou & whatHappensAfter;
 * lanes 4-5 carry a note explaining why the lane is empty or what it would show.
 */
export async function getDigest(
  db: DB,
  planeClient: PlaneClient | null,
  opts: DigestOptions,
  actor: string
): Promise<Digest> {
  const { scopePath, includeDescendants = true, limit = 10 } = opts;

  // 1. Verify access and scope existence
  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }
  await requireAccess(db, actor, scopePath, "viewer");

  // 2. Lane 1: waiting_for_feedback — sessions in "waiting" status
  const waitingSessions = await listSessions(
    db,
    { scopePath, status: "waiting", includeDescendants, limit },
    actor
  );
  const waitingItems: DigestItem[] = waitingSessions.map((s) => ({
    id: s.id,
    title: s.title,
    scopePath: s.scopePath,
    workType: "session",
    status: s.status,
    updatedAt: s.updatedAt,
    whyItNeedsYou: `Agent "${s.engine}" is blocked; it asked a question or needs a decision.`,
    whatHappensAfter: "Reply in the session thread; the agent will resume automatically.",
  }));

  // 3. Lane 2: waiting_for_approval — open attention items
  const openAttention = await listAttentionItems(
    db,
    { scopePath, status: "open", includeDescendants, limit },
    actor
  );
  const approvalItems: DigestItem[] = openAttention.map((item) => ({
    id: item.id,
    title: item.title || `Attention item ${item.id.slice(0, 8)}`,
    scopePath: item.scopePath,
    workType: "attention",
    status: item.status,
    whyItNeedsYou:
      item.kind === "open_question"
        ? "A question is waiting in your approval queue."
        : "An agent or teammate needs your sign-off to proceed.",
    whatHappensAfter: "Approve/reject; the requester will be notified and can continue.",
  }));

  // 4. Lane 3: completed_to_review — recently completed sessions
  const completedSessions = await listSessions(
    db,
    { scopePath, status: "completed", includeDescendants, limit },
    actor
  );
  const reviewItems: DigestItem[] = completedSessions.map((s) => ({
    id: s.id,
    title: s.title,
    scopePath: s.scopePath,
    workType: "session",
    status: s.status,
    updatedAt: s.updatedAt,
    whyItNeedsYou: "This session finished; it's waiting for your review/acknowledgment.",
    whatHappensAfter: "Review the wrap-up; mark acknowledged or file follow-ups if needed.",
  }));

  // 5. Lane 4: automation_candidates — stub (brain-lint will populate this)
  const automationItems: DigestItem[] = [];
  const automationNote =
    "Brain-lint wiring is pending; this lane will suggest workflows ready to automate.";

  // 6. Lane 5: ready_to_start — open tasks (degrade if no planeClient)
  let taskItems: DigestItem[] = [];
  let taskNote: string | undefined;
  if (planeClient) {
    const openTasks = await listTasks(
      db,
      planeClient,
      { scopePath, state: "open", limit },
      actor
    );
    taskItems = openTasks.map((t) => ({
      id: t.id,
      title: t.title,
      scopePath,
      workType: "task",
      whyItNeedsYou: "This task is open and ready to be worked on.",
      whatHappensAfter: "Start the task; update status as you progress.",
    }));
  } else {
    taskNote = "Task integration unavailable; connect a project manager to see open tasks.";
  }

  // 7. Assemble the digest
  const lanes: DigestLane[] = [
    {
      key: "waiting_for_feedback",
      label: "Waiting for feedback",
      items: waitingItems,
    },
    {
      key: "waiting_for_approval",
      label: "Waiting for approval",
      items: approvalItems,
    },
    {
      key: "completed_to_review",
      label: "Completed to review",
      items: reviewItems,
    },
    {
      key: "automation_candidates",
      label: "Automation candidates",
      items: automationItems,
      note: automationNote,
    },
    {
      key: "ready_to_start",
      label: "Ready to start",
      items: taskItems,
      note: taskNote,
    },
  ];

  return { scopePath, lanes };
}
