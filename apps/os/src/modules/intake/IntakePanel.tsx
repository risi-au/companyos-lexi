"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type React from "react";
import {
  AlertTriangle,
  Check,
  Clipboard,
  Copy,
  FileText,
  LoaderCircle,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  CompletionReward,
  EmptyState,
  Stepper,
  anim,
  df,
  rm,
  useConfirm,
  useToast,
  viewEnter,
} from "@companyos/ui";
import { labelForIntakeStatus } from "@/lib/labels";
import {
  acceptReusePatternAction,
  approveIntakeAction,
  dismissIntakeAction,
  externalPackAction,
  findRelatedHistoryAction,
  findReusePatternsAction,
  getIntakeAction,
  provisionIntakeAction,
  rejectIntakeAction,
  reopenIntakeAction,
  saveFramingFieldsAction,
  saveOpenQuestionsAction,
  saveRelatedHistoryAction,
  saveReviewAction,
  submitPasteAction,
} from "./actions";
import { parseOpenQuestionEntries, serializeOpenQuestionEntries, type OpenQuestionEntry } from "./open-questions";

type Intake = {
  id: string;
  status: string;
  templateSlug: string;
  answers: unknown;
  packetMd: string | null;
  proposedProvisionSpec: unknown;
  proposedDocs: unknown;
  proposedTasks: unknown;
  proposedWikiUpdates: unknown;
  openQuestions: unknown;
  riskNotes: unknown;
  reusePatternSlug: string | null;
  packSnapshot: string | null;
  relatedHistorySelections: unknown;
  scopePath: string;
  updatedAt: string | Date;
};

interface Pattern {
  slug: string;
  title: string;
  summary: string;
  reusable: boolean;
  sourceScopePath: string | null;
  sourceVisible: boolean;
}

interface FramingTemplate {
  slug: string;
  questions: Array<{ key: string; question: string }>;
}

interface RelatedHistoryHit {
  type: "record" | "doc";
  id: string;
  title: string;
  scopePath: string;
  snippet: string;
  kind?: string;
  slug?: string;
}

const WIZARD_STEPS = [
  { id: "basics", label: "Basics" },
  { id: "framing", label: "Framing" },
  { id: "history", label: "History" },
  { id: "interview", label: "Interview" },
  { id: "review", label: "Review" },
  { id: "provision", label: "Provision" },
];

const PROVISION_ITEMS = [
  { key: "scope", status: "pending", message: "Create project registry" },
  { key: "modules", status: "pending", message: "Attach default modules" },
  { key: "records", status: "pending", message: "Generate starter records" },
  { key: "workbench", status: "pending", message: "Queue workbench sync" },
] satisfies ProvisionDisplayStep[];

type ProvisionStatus = "pending" | "running" | "created" | "existing" | "skipped" | "manual";

type ProvisionDisplayStep = {
  key: string;
  status: ProvisionStatus;
  message: string;
};

function pretty(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Only string-valued answers are framing form fields. Non-string entries are
// system metadata (required_credentials, external_systems,
// submission_markdown_only) that must never round-trip through form state --
// String() would mangle them into "[object Object]"/"true" garbage.
function stringifyRecordValues(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function normalizeHistory(value: unknown): RelatedHistoryHit[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    type: (item.type === "doc" ? "doc" : "record") as "doc" | "record",
    id: String(item.id ?? ""),
    title: String(item.title ?? ""),
    scopePath: String(item.scopePath ?? ""),
    snippet: String(item.snippet ?? ""),
    ...(typeof item.kind === "string" ? { kind: item.kind } : {}),
    ...(typeof item.slug === "string" ? { slug: item.slug } : {}),
  })).filter((item) => item.id && item.title && item.scopePath);
}

function statusStep(status: string): number {
  if (status === "needs_review") return 5;
  if (status === "approved" || status === "provisioned") return 6;
  if (status === "rejected" || status === "dismissed") return 1;
  return 4;
}

function initialStep(status: string): number {
  if (status === "draft") return 1;
  if (status === "awaiting_external") return 4;
  return statusStep(status);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// The service stamps answers.submission_markdown_only at submit time so the
// warning survives fetch paths that bypass submitPasteAction (MCP submissions
// picked up by the interview poll, reopened wizards).
function submissionWasMarkdownOnly(intake: Pick<Intake, "answers">): boolean {
  return isRecord(intake.answers) && intake.answers.submission_markdown_only === true;
}

export function IntakePanel({
  scopePath,
  initialIntakes,
  initialOpenId,
  access,
  framingTemplates,
}: {
  scopePath: string;
  initialIntakes: Intake[];
  initialOpenId?: string | null;
  access: string;
  framingTemplates: FramingTemplate[];
}) {
  const [intakes, setIntakes] = useState(initialIntakes);
  const [activeId, setActiveId] = useState<string | null>(initialOpenId || null);
  const [isPending, startTransition] = useTransition();
  const confirm = useConfirm();
  const { toast } = useToast();
  const active = activeId ? intakes.find((i) => i.id === activeId) || null : null;
  const canAdmin = access === "owner" || access === "admin";
  const canEdit = canAdmin || access === "editor" || access === "agent";

  const mergeIntake = useCallback((next: Intake) => {
    setIntakes((rows) => rows.map((row) => row.id === next.id ? next : row));
  }, []);

  const resume = useMemo(() => intakes.find((i) => ["draft", "awaiting_external", "needs_review", "approved"].includes(i.status)), [intakes]);

  async function dismissResume(intakeId: string) {
    const ok = await confirm({
      title: "Discard setup?",
      body: "This discards the setup and removes it from the active queue.",
      confirmLabel: "Discard setup",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        mergeIntake(await dismissIntakeAction({ intakeId, scopePath }) as Intake);
        toast.warn("Setup discarded.");
      } catch (error) {
        toast.error(errorMessage(error, "Couldn't discard the setup. Check your access and try again."));
      }
    });
  }

  return (
    <div className="space-y-[var(--space-4)] text-[var(--fg)]">
      {resume && (
        <div className="rounded-[var(--radius-4)] bg-[var(--surface)] p-[var(--space-4)] shadow-[var(--shadow)]">
          <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
            <div>
              <div className="text-[var(--font-size-sm)] font-medium">Finish setting up {scopePath}</div>
              <div className="mt-1 text-[var(--font-size-xs)] text-[var(--mutedfg)]">
                Step {initialStep(resume.status)} of 6, {labelForIntakeStatus(resume.status)}
              </div>
            </div>
            <div className="flex gap-[var(--space-2)]">
              <button onClick={() => setActiveId(resume.id)} className="inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-[var(--radius-3)] bg-[var(--primary)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--primaryfg)] hover:bg-[var(--primaryhover)]">
                <Play size={14} /> Resume
              </button>
              {canAdmin && (
                <button
                  onClick={() => void dismissResume(resume.id)}
                  className="inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-[var(--radius-3)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--fg)] hover:bg-[var(--hover)]"
                >
                  <X size={14} /> Discard setup
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-[280px_1fr]">
        <div className="rounded-[var(--radius-4)] bg-[var(--surface)] p-[var(--space-3)] shadow-[var(--shadow)]">
          <div className="mb-[var(--space-2)] text-[var(--font-size-sm)] font-medium">Setup</div>
          <div className="space-y-1">
            {intakes.length === 0 ? (
              <EmptyState icon={<FileText size={16} />} title="No setups yet for this project" body="New projects create setup details here." />
            ) : intakes.map((intake) => (
              <button
                key={intake.id}
                onClick={() => setActiveId(intake.id)}
                className={`w-full cursor-pointer rounded-[var(--radius-3)] px-[var(--space-2)] py-[var(--space-2)] text-left text-[var(--font-size-sm)] ${activeId === intake.id ? "bg-[var(--selected)] text-[var(--fg)]" : "text-[var(--mutedfg)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"}`}
              >
                <div className="font-medium">{labelForIntakeStatus(intake.status)}</div>
                <div className="mt-1 truncate text-[var(--font-size-xs)] text-[var(--mutedfg)]">{intake.templateSlug}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[var(--radius-4)] bg-[var(--surface)] p-[var(--space-4)] shadow-[var(--shadow)]">
          <EmptyState icon={<FileText size={16} />} title="Setup details" body="Open a setup to continue the wizard." />
        </div>
      </div>

      {active ? (
        <WizardWorkspace
          key={active.id}
          intake={active}
          scopePath={scopePath}
          canEdit={canEdit}
          canAdmin={canAdmin}
          busy={isPending}
          run={(fn) => startTransition(fn)}
          mergeIntake={mergeIntake}
          framingTemplates={framingTemplates}
          onClose={() => setActiveId(null)}
        />
      ) : null}
    </div>
  );
}

function WizardWorkspace({
  intake,
  scopePath,
  canEdit,
  canAdmin,
  busy,
  run,
  mergeIntake,
  framingTemplates,
  onClose,
}: {
  intake: Intake;
  scopePath: string;
  canEdit: boolean;
  canAdmin: boolean;
  busy: boolean;
  run: (fn: () => Promise<void>) => void;
  mergeIntake: (next: Intake) => void;
  framingTemplates: FramingTemplate[];
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const initialAnswers = isRecord(intake.answers) ? stringifyRecordValues(intake.answers) : {};
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [query, setQuery] = useState("");
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyHits, setHistoryHits] = useState<RelatedHistoryHit[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<RelatedHistoryHit[]>(normalizeHistory(intake.relatedHistorySelections));
  const [pack, setPack] = useState<{ pasteBack: string; mcp: string } | null>(null);
  const [paste, setPaste] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [markdownOnlyWarning, setMarkdownOnlyWarning] = useState(() => submissionWasMarkdownOnly(intake));
  const [spec, setSpec] = useState(pretty(intake.proposedProvisionSpec));
  const [docs, setDocs] = useState(pretty(intake.proposedDocs));
  const [tasks, setTasks] = useState(pretty(intake.proposedTasks));
  const [wiki, setWiki] = useState(pretty(intake.proposedWikiUpdates));
  const [questions, setQuestions] = useState(pretty(intake.openQuestions));
  const [risks, setRisks] = useState(pretty(intake.riskNotes));
  const [reason, setReason] = useState("");
  const [currentStep, setCurrentStep] = useState(initialStep(intake.status));
  const [localMaxStep, setLocalMaxStep] = useState(initialStep(intake.status));
  const [menuOpen, setMenuOpen] = useState(false);
  const initialOpenQuestionEntries = useMemo(() => parseOpenQuestionEntries(intake.openQuestions), [intake.openQuestions]);
  const [openQuestionEntries, setOpenQuestionEntries] = useState<OpenQuestionEntry[]>(initialOpenQuestionEntries);
  const openQuestionEntriesRef = useRef(initialOpenQuestionEntries);
  const persistedOpenQuestionEntriesRef = useRef(initialOpenQuestionEntries);
  const queuedOpenQuestionEntriesRef = useRef<OpenQuestionEntry[] | null>(null);
  const openQuestionSavePromiseRef = useRef<Promise<void> | null>(null);
  const openQuestionSaveErrorRef = useRef<Error | null>(null);
  const [answeringQuestion, setAnsweringQuestion] = useState<number | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<number, string>>({});
  const [burstQuestion, setBurstQuestion] = useState<number | null>(null);
  const [provisionSteps, setProvisionSteps] = useState<ProvisionDisplayStep[]>(() => PROVISION_ITEMS.map((item) => ({ ...item, status: intake.status === "provisioned" ? "existing" : "pending" })));
  const [provisionRunning, setProvisionRunning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [scopeLive, setScopeLive] = useState(intake.status === "provisioned");
  const stageRef = useRef<HTMLDivElement | null>(null);
  const packButtonRef = useRef<HTMLButtonElement | null>(null);
  const mcpButtonRef = useRef<HTMLButtonElement | null>(null);
  const template = framingTemplates.find((item) => item.slug === intake.templateSlug) || framingTemplates[0];
  const reasonText = answers.reason || "";
  const statusMaxStep = statusStep(intake.status);
  const maxReached = Math.max(localMaxStep, statusMaxStep);
  const openQuestions = useMemo(
    () => intake.status === "approved" || intake.status === "provisioned"
      ? openQuestionEntries.map((entry) => ({ ...entry, done: true }))
      : openQuestionEntries,
    [intake.status, openQuestionEntries],
  );
  const remainingQuestions = openQuestions.filter((entry) => !entry.done).length;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const nextMax = statusStep(intake.status);
    setLocalMaxStep((current) => Math.max(current, nextMax));
    setCurrentStep((current) => Math.min(Math.max(current, initialStep(intake.status)), Math.max(current, nextMax)));
    setScopeLive(intake.status === "provisioned");
    // Only seed the placeholder summary when there are no real ProvisionResult steps
    // to show — runProvision sets the real steps in the same commit as mergeIntake.
    if (intake.status === "provisioned") {
      setProvisionSteps((current) =>
        current.some((step) => step.status !== "pending" && step.status !== "running")
          ? current
          : PROVISION_ITEMS.map((item) => ({ ...item, status: "existing" })));
    }
  }, [intake.status]);

  // Every local edit bumps this; a save response may only be applied to client
  // state when no newer mutation happened while it was in flight.
  const openQuestionMutationRef = useRef(0);
  // True once the user hand-edits the "Open questions JSON / notes" textarea;
  // save responses then leave the textarea alone until an authoritative sync.
  const questionsDirtyRef = useRef(false);

  const applyOpenQuestionEntries = useCallback((next: OpenQuestionEntry[], preserveTextarea = false) => {
    openQuestionEntriesRef.current = next;
    setOpenQuestionEntries(next);
    if (!preserveTextarea) {
      questionsDirtyRef.current = false;
      setQuestions(serializeOpenQuestionEntries(next));
    }
  }, []);

  const drainOpenQuestionSaveQueue = useCallback(async () => {
    while (queuedOpenQuestionEntriesRef.current) {
      const next = queuedOpenQuestionEntriesRef.current;
      queuedOpenQuestionEntriesRef.current = null;
      const mutationAtSend = openQuestionMutationRef.current;
      try {
        const updated = await saveOpenQuestionsAction({
          intakeId: intake.id,
          scopePath,
          openQuestions: next,
        }) as Intake;
        const saved = parseOpenQuestionEntries(updated.openQuestions);
        persistedOpenQuestionEntriesRef.current = saved;
        if (openQuestionMutationRef.current === mutationAtSend) {
          applyOpenQuestionEntries(saved, questionsDirtyRef.current);
        }
        mergeIntake(updated);
      } catch (error) {
        const failure = error instanceof Error ? error : new Error("Could not save open questions.");
        openQuestionSaveErrorRef.current = failure;
        queuedOpenQuestionEntriesRef.current = null;
        openQuestionMutationRef.current += 1;
        applyOpenQuestionEntries(persistedOpenQuestionEntriesRef.current);
        toast.error(failure.message);
        throw failure;
      }
    }
  }, [applyOpenQuestionEntries, intake.id, mergeIntake, scopePath, toast]);

  const enqueueOpenQuestionSave = useCallback((next: OpenQuestionEntry[]) => {
    openQuestionMutationRef.current += 1;
    applyOpenQuestionEntries(next);
    queuedOpenQuestionEntriesRef.current = next;
    openQuestionSaveErrorRef.current = null;
    if (!openQuestionSavePromiseRef.current) {
      const promise = drainOpenQuestionSaveQueue().finally(() => {
        openQuestionSavePromiseRef.current = null;
      });
      openQuestionSavePromiseRef.current = promise;
    }
    return openQuestionSavePromiseRef.current ?? Promise.resolve();
  }, [applyOpenQuestionEntries, drainOpenQuestionSaveQueue]);

  async function flushOpenQuestionSaves() {
    const pending = openQuestionSavePromiseRef.current;
    if (pending) await pending;
    if (openQuestionSaveErrorRef.current) throw openQuestionSaveErrorRef.current;
  }

  const hydrateReview = useCallback((next: Intake, viaMcp = false) => {
    setSpec(pretty(next.proposedProvisionSpec));
    setDocs(pretty(next.proposedDocs));
    setTasks(pretty(next.proposedTasks));
    setWiki(pretty(next.proposedWikiUpdates));
    const entries = parseOpenQuestionEntries(next.openQuestions);
    openQuestionEntriesRef.current = entries;
    persistedOpenQuestionEntriesRef.current = entries;
    questionsDirtyRef.current = false;
    setOpenQuestionEntries(entries);
    setQuestions(serializeOpenQuestionEntries(entries));
    setRisks(pretty(next.riskNotes));
    setMarkdownOnlyWarning(submissionWasMarkdownOnly(next));
    mergeIntake(next);
    continueTo(5);
    if (viaMcp) toast.success("Interview results received via MCP.");
  }, [mergeIntake, toast]);

  useEffect(() => {
    // Skip while a save is queued OR in flight: merging an older save response
    // into intake.openQuestions must not clobber newer local edits.
    if (queuedOpenQuestionEntriesRef.current || openQuestionSavePromiseRef.current) return;
    const next = parseOpenQuestionEntries(intake.openQuestions);
    openQuestionEntriesRef.current = next;
    persistedOpenQuestionEntriesRef.current = next;
    questionsDirtyRef.current = false;
    setOpenQuestionEntries(next);
    setQuestions(serializeOpenQuestionEntries(next));
  }, [intake.openQuestions]);

  useEffect(() => {
    if (intake.status !== "awaiting_external" || currentStep !== 4) return undefined;
    let cancelled = false;
    const poll = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      try {
        const next = await getIntakeAction({ intakeId: intake.id, scopePath }) as Intake;
        if (cancelled || next.status !== "needs_review") return;
        cancelled = true;
        window.clearInterval(timer);
        hydrateReview(next, true);
      } catch {
        /* The next poll retries transient session or network failures. */
      }
    };
    const timer = window.setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentStep, hydrateReview, intake.id, intake.status, scopePath]);

  useEffect(() => {
    if (burstQuestion === null || rm()) return;
    const timeout = window.setTimeout(() => setBurstQuestion(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [burstQuestion]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const items = stage.querySelectorAll("[data-stage-item]");
    void viewEnter(stage, items);
  }, [currentStep]);

  const runAction = useCallback((fn: () => Promise<void>, success?: string) => {
    run(async () => {
      try {
        await fn();
        if (success) toast.success(success);
      } catch (error) {
        toast.error(errorMessage(error, "Couldn't complete the action. Check the setup and try again."));
      }
    });
  }, [run, toast]);

  function goStep(step: number) {
    if (step > maxReached) return;
    setCurrentStep(step);
    setMenuOpen(false);
  }

  function continueTo(step: number) {
    setLocalMaxStep((current) => Math.max(current, step));
    setCurrentStep(step);
  }

  async function copyText(value: string, ref: React.RefObject<HTMLButtonElement | null>, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied.`);
      const button = ref.current;
      if (button && !rm()) {
        void anim((gsap) => {
          gsap.fromTo(button, { scale: 0.94 }, { scale: 1, duration: df(0.3), ease: "power3.out", clearProps: "transform" });
        });
      }
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't copy the text. Select it manually and try again."));
    }
  }

  async function menuAction(kind: "sendBack" | "reject" | "dismiss") {
    const config = kind === "sendBack"
      ? {
          title: "Send setup back?",
          body: "The setup returns to the interview step so the results can be revised.",
          confirmLabel: "Send back",
        }
      : kind === "reject"
        ? {
            title: "Send setup back?",
            body: "This sends the setup back with the reason from the review step.",
            confirmLabel: "Send back",
          }
        : {
            title: "Discard setup?",
            body: "This removes the setup from the active queue.",
            confirmLabel: "Discard setup",
          };
    const ok = await confirm(config);
    if (!ok) return;
    setMenuOpen(false);
    runAction(async () => {
      const next = kind === "sendBack"
        ? await reopenIntakeAction({ intakeId: intake.id, scopePath }) as Intake
        : kind === "reject"
          ? await rejectIntakeAction({ intakeId: intake.id, scopePath, reason }) as Intake
          : await dismissIntakeAction({ intakeId: intake.id, scopePath }) as Intake;
      mergeIntake(next);
      if (kind === "sendBack") continueTo(4);
    }, kind === "sendBack" ? "Interview reopened." : kind === "reject" ? "Setup sent back." : "Setup discarded.");
  }

  async function runProvision() {
    if (!canAdmin || intake.status !== "approved" || provisionRunning) return;
    setProvisionRunning(true);
    setProvisionError(null);
    setScopeLive(false);
    setProvisionSteps(PROVISION_ITEMS.map((item) => ({ ...item, status: "running" })));
    try {
      const result = await provisionIntakeAction({ intakeId: intake.id, scopePath });
      mergeIntake(result.intake as Intake);
      setProvisionSteps(result.result.steps as ProvisionDisplayStep[]);
      setScopeLive(true);
    } catch (error) {
      const message = errorMessage(error, "Provisioning failed. Check the setup and try again.");
      setProvisionError(message);
      setProvisionSteps([{ key: "provision", status: "manual", message }]);
      throw error;
    } finally {
      setProvisionRunning(false);
    }
  }

  function toggleQuestion(index: number) {
    if (!canEdit || intake.status === "approved" || intake.status === "provisioned") return;
    const current = openQuestionEntriesRef.current;
    const entry = current[index];
    if (!entry) return;
    const wasDone = entry.done;
    // Reopening clears the answer too: provisioning treats an answered question
    // as resolved, so a reopened-but-still-answered row would silently never
    // become an attention item. The old answer is stashed as the draft.
    const next = current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      return wasDone ? { ...item, done: false, answer: null } : { ...item, done: true };
    });
    if (wasDone && entry.answer) {
      const previousAnswer = entry.answer;
      setAnswerDrafts((drafts) => ({ ...drafts, [index]: previousAnswer }));
    }
    if (!wasDone) setBurstQuestion(index);
    void enqueueOpenQuestionSave(next).catch(() => undefined);
  }

  function openAnswerEditor(index: number) {
    if (!canEdit || intake.status === "approved" || intake.status === "provisioned") return;
    const entry = openQuestionEntriesRef.current[index];
    if (!entry) return;
    setAnsweringQuestion(index);
    setAnswerDrafts((current) => ({ ...current, [index]: current[index] ?? entry.answer ?? "" }));
  }

  function markQuestionAnswered(index: number) {
    const answer = (answerDrafts[index] ?? "").trim();
    if (!canEdit || !answer || intake.status === "approved" || intake.status === "provisioned") return;
    const next = openQuestionEntriesRef.current.map((entry, itemIndex) => itemIndex === index
      ? { ...entry, done: true, answer }
      : entry);
    setAnsweringQuestion(null);
    void enqueueOpenQuestionSave(next).catch(() => undefined);
  }

  return (
    <div data-viewroot="wizard" className="fixed bottom-0 right-0 top-0 z-[70] flex flex-col bg-[var(--bg)] text-[var(--fg)] left-[264px] max-[820px]:left-0">
      <div className="flex h-[48px] shrink-0 items-center gap-[12px] border-b border-[var(--border)] bg-[var(--surface)] px-[18px]">
        <b className="text-[14px]">Set up</b>
        <span className="font-mono text-[13px] text-[var(--mutedfg)]">{scopePath}</span>
        <span className="inline-flex items-center gap-[6px] rounded-full bg-[var(--infobg)] px-[9px] py-[4px] text-[12px] font-medium text-[var(--info)]">
          <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-current" />
          {scopeLive ? "Live" : provisionRunning ? "Creating" : labelForIntakeStatus(intake.status)}
        </span>
        <div className="relative ml-auto flex items-center gap-[12px]">
          <span className="whitespace-nowrap text-[11.5px] text-[var(--mutedfg)]">Esc saves & closes</span>
          {intake.status === "dismissed" && canAdmin ? (
            <button onClick={() => runAction(async () => mergeIntake(await reopenIntakeAction({ intakeId: intake.id, scopePath }) as Intake), "Setup reopened.")} className="inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-[var(--radius-3)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--hover)]">
              <RefreshCw size={14} /> Reopen
            </button>
          ) : null}
          {canAdmin ? (
            <button
              type="button"
              aria-label="Wizard actions"
              onClick={() => setMenuOpen((open) => !open)}
              className="grid h-11 w-11 cursor-pointer place-items-center rounded-[var(--radius-3)] border border-[var(--border)] text-[var(--mutedfg)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
            >
              <MoreHorizontal size={18} />
            </button>
          ) : null}
          {menuOpen ? (
            <div className="absolute right-0 top-12 z-10 w-48 rounded-[var(--radius-4)] border border-[var(--border)] bg-[var(--raised)] p-1 shadow-[var(--shadow)]">
              <button type="button" onClick={() => void menuAction("sendBack")} className="block w-full rounded-[var(--radius-3)] px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--font-size-sm)] hover:bg-[var(--hover)]">Send back</button>
              <button type="button" onClick={() => void menuAction("reject")} className="block w-full rounded-[var(--radius-3)] px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--font-size-sm)] text-[var(--err)] hover:bg-[var(--hover)]">Send back with reason</button>
              <button type="button" onClick={() => void menuAction("dismiss")} className="block w-full rounded-[var(--radius-3)] px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--font-size-sm)] hover:bg-[var(--hover)]">Discard setup</button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="wiz-grid grid min-h-0 flex-1 grid-cols-1 overflow-hidden min-[821px]:grid-cols-[210px_1fr]">
        <Stepper
          steps={WIZARD_STEPS}
          current={currentStep}
          maxReached={maxReached}
          onStepClick={goStep}
          className="border-b border-[var(--border)] min-[821px]:border-b-0 min-[821px]:border-r"
        />

        <div ref={stageRef} className="min-w-0 overflow-auto p-[22px]">
          {currentStep === 1 ? (
            <BasicsStep intake={intake} reasonText={reasonText} onContinue={() => continueTo(2)} />
          ) : null}
          {currentStep === 2 ? (
            <section className="space-y-[var(--space-3)]">
              <StepTitle title="Framing" body="Capture the project shape before the OS searches for useful context." />
              <div data-stage-item className="grid grid-cols-1 gap-[var(--space-3)]">
                {(template?.questions || []).map((question) => (
                  <label key={question.key} className="block">
                    <span className="mb-1 block text-[var(--font-size-xs)] text-[var(--mutedfg)]">{question.question}</span>
                    <input
                      value={answers[question.key] || ""}
                      onChange={(e) => setAnswers((current) => ({ ...current, [question.key]: e.target.value }))}
                      className="min-h-[44px] w-full rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--bg)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                    />
                  </label>
                ))}
              </div>
              <div data-stage-item className="flex flex-wrap gap-[var(--space-2)]">
                <button disabled={!canEdit || busy} onClick={() => runAction(async () => {
                  const next = await saveFramingFieldsAction({ intakeId: intake.id, answers: { ...answers, reason: reasonText }, scopePath }) as Intake;
                  setAnswers(isRecord(next.answers) ? stringifyRecordValues(next.answers) : {});
                  mergeIntake(next);
                }, "Framing saved.")} className="inline-flex min-h-[44px] cursor-pointer items-center rounded-[var(--radius-3)] bg-[var(--primary)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--primaryfg)] disabled:cursor-not-allowed disabled:opacity-50">
                  Save framing
                </button>
                <button type="button" onClick={() => continueTo(3)} className="min-h-[44px] cursor-pointer rounded-[var(--radius-3)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--hover)]">Continue</button>
              </div>
            </section>
          ) : null}
          {currentStep === 3 ? (
            <HistoryStep
              busy={busy}
              canEdit={canEdit}
              query={query}
              setQuery={setQuery}
              patterns={patterns}
              setPatterns={setPatterns}
              historyQuery={historyQuery}
              setHistoryQuery={setHistoryQuery}
              historyHits={historyHits}
              setHistoryHits={setHistoryHits}
              selectedHistory={selectedHistory}
              setSelectedHistory={setSelectedHistory}
              runAction={runAction}
              scopePath={scopePath}
              intake={intake}
              mergeIntake={mergeIntake}
              setSpec={setSpec}
              setDocs={setDocs}
              setTasks={setTasks}
              setWiki={setWiki}
              onContinue={() => continueTo(4)}
            />
          ) : null}
          {currentStep === 4 ? (
            <InterviewStep
              busy={busy}
              canEdit={canEdit}
              pack={pack}
              paste={paste}
              setPaste={setPaste}
              errors={errors}
              setErrors={setErrors}
              packButtonRef={packButtonRef}
              mcpButtonRef={mcpButtonRef}
              onCopy={copyText}
              runAction={runAction}
              intake={intake}
              scopePath={scopePath}
              setPack={setPack}
              mergeIntake={mergeIntake}
              setMarkdownOnlyWarning={setMarkdownOnlyWarning}
              hydrateReview={hydrateReview}
            />
          ) : null}
          {currentStep === 5 ? (
            <ReviewStep
              intake={intake}
              markdownOnlyWarning={markdownOnlyWarning}
              spec={spec}
              setSpec={setSpec}
              docs={docs}
              setDocs={setDocs}
              tasks={tasks}
              setTasks={setTasks}
              wiki={wiki}
              setWiki={setWiki}
              questions={questions}
              setQuestions={(value) => {
                questionsDirtyRef.current = true;
                setQuestions(value);
              }}
              risks={risks}
              setRisks={setRisks}
              reason={reason}
              setReason={setReason}
              openQuestions={openQuestions}
              remainingQuestions={remainingQuestions}
              burstQuestion={burstQuestion}
              setBurstQuestion={setBurstQuestion}
              toggleQuestion={toggleQuestion}
              answeringQuestion={answeringQuestion}
              answerDrafts={answerDrafts}
              setAnswerDrafts={setAnswerDrafts}
              openAnswerEditor={openAnswerEditor}
              markQuestionAnswered={markQuestionAnswered}
              busy={busy}
              canEdit={canEdit}
              canAdmin={canAdmin}
              runAction={runAction}
              scopePath={scopePath}
              mergeIntake={mergeIntake}
              flushOpenQuestionSaves={flushOpenQuestionSaves}
              onProvisionReady={() => continueTo(6)}
            />
          ) : null}
          {currentStep === 6 ? (
            <ProvisionStep
              steps={provisionSteps}
              running={provisionRunning}
              error={provisionError}
              live={scopeLive}
              canProvision={canAdmin && intake.status === "approved"}
              onProvision={() => runAction(runProvision, "Project is live.")}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StepTitle({ title, body }: { title: string; body: string }) {
  return (
    <div data-stage-item>
      <div className="text-[var(--font-size-lg)] font-semibold text-[var(--fg)]">{title}</div>
      <div className="mt-1 text-[var(--font-size-sm)] text-[var(--mutedfg)]">{body}</div>
    </div>
  );
}

function BasicsStep({ intake, reasonText, onContinue }: { intake: Intake; reasonText: string; onContinue: () => void }) {
  return (
    <section className="space-y-[var(--space-4)]">
      <StepTitle title="Basics" body="Confirm the project request before filling the setup details." />
      <div data-stage-item className="rounded-[var(--radius-4)] bg-[var(--raised)] p-[var(--space-4)]">
        <div className="text-[var(--font-size-xs)] text-[var(--mutedfg)]">Reason</div>
        <div className="mt-1 whitespace-pre-wrap text-[var(--font-size-sm)]">{reasonText || "No reason recorded yet. Add one."}</div>
      </div>
      <div data-stage-item className="grid grid-cols-1 gap-[var(--space-3)] md:grid-cols-3">
        <Meta label="Status" value={labelForIntakeStatus(intake.status)} />
        <Meta label="Template" value={intake.templateSlug} />
        <Meta label="Updated" value={new Date(intake.updatedAt).toLocaleString()} />
      </div>
      <button type="button" data-stage-item onClick={onContinue} className="min-h-[44px] cursor-pointer rounded-[var(--radius-3)] bg-[var(--primary)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--primaryfg)] hover:bg-[var(--primaryhover)]">
        Start framing
      </button>
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-3)] bg-[var(--raised)] px-[var(--space-3)] py-[var(--space-2)]">
      <div className="text-[var(--font-size-xs)] text-[var(--mutedfg)]">{label}</div>
      <div className="mt-1 text-[var(--font-size-xs)] text-[var(--fg)]">{value}</div>
    </div>
  );
}

function HistoryStep(props: {
  busy: boolean;
  canEdit: boolean;
  query: string;
  setQuery: (value: string) => void;
  patterns: Pattern[];
  setPatterns: (value: Pattern[]) => void;
  historyQuery: string;
  setHistoryQuery: (value: string) => void;
  historyHits: RelatedHistoryHit[];
  setHistoryHits: (value: RelatedHistoryHit[]) => void;
  selectedHistory: RelatedHistoryHit[];
  setSelectedHistory: React.Dispatch<React.SetStateAction<RelatedHistoryHit[]>>;
  runAction: (fn: () => Promise<void>, success?: string) => void;
  scopePath: string;
  intake: Intake;
  mergeIntake: (next: Intake) => void;
  setSpec: (value: string) => void;
  setDocs: (value: string) => void;
  setTasks: (value: string) => void;
  setWiki: (value: string) => void;
  onContinue: () => void;
}) {
  return (
    <section className="space-y-[var(--space-4)]">
      <StepTitle title="History" body="Pull in related records and reusable patterns before the external interview." />
      <div data-stage-item className="space-y-[var(--space-2)]">
        <div className="text-[var(--font-size-sm)] font-medium">Related history</div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={props.historyQuery} onChange={(e) => props.setHistoryQuery(e.target.value)} aria-label="Search past records and docs" className="min-h-[44px] flex-1 rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--bg)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]" placeholder="client name, domain, old project path" />
          <button disabled={props.busy} onClick={() => props.runAction(async () => props.setHistoryHits(await findRelatedHistoryAction({ intakeId: props.intake.id, query: props.historyQuery, scopePath: props.scopePath }) as RelatedHistoryHit[]))} className="inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-[var(--radius-3)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-50">
            <Search size={14} /> Search history
          </button>
        </div>
        {props.historyHits.length > 0 ? (
          <div className="space-y-2">
            {props.historyHits.map((hit) => {
              const checked = props.selectedHistory.some((item) => item.type === hit.type && item.id === hit.id);
              return (
                <label key={`${hit.type}:${hit.id}`} className="flex cursor-pointer gap-2 rounded-[var(--radius-3)] bg-[var(--raised)] p-3 text-[var(--font-size-sm)] hover:bg-[var(--hover)]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => props.setSelectedHistory((current) => e.target.checked ? [...current, hit] : current.filter((item) => item.type !== hit.type || item.id !== hit.id))}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium">{hit.title}</span>
                    <span className="block text-[var(--font-size-xs)] text-[var(--mutedfg)]">{hit.scopePath} / {hit.type}{hit.kind ? `:${hit.kind}` : ""}</span>
                    <span className="mt-1 block text-[var(--font-size-xs)] text-[var(--mutedfg)]">{hit.snippet}</span>
                  </span>
                </label>
              );
            })}
          </div>
        ) : null}
        {props.selectedHistory.length > 0 ? (
          <div className="rounded-[var(--radius-3)] bg-[var(--infobg)] p-3 text-[var(--font-size-xs)] text-[var(--info)]">
            Selected: {props.selectedHistory.map((hit) => hit.title).join(", ")}
          </div>
        ) : null}
        <button disabled={!props.canEdit || props.busy} onClick={() => props.runAction(async () => {
          const next = await saveRelatedHistoryAction({ intakeId: props.intake.id, selections: props.selectedHistory, scopePath: props.scopePath }) as Intake;
          props.setSelectedHistory(normalizeHistory(next.relatedHistorySelections));
          props.mergeIntake(next);
        }, "Related history saved.")} className="min-h-[44px] cursor-pointer rounded-[var(--radius-3)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-50">
          Save related history
        </button>
      </div>

      <div data-stage-item className="space-y-[var(--space-2)]">
        <div className="text-[var(--font-size-sm)] font-medium">Starting points</div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={props.query} onChange={(e) => props.setQuery(e.target.value)} aria-label="What kind of work is this?" className="min-h-[44px] flex-1 rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--bg)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]" placeholder="meta ads, client launch, codebase docs" />
          <button disabled={props.busy} onClick={() => props.runAction(async () => props.setPatterns(await findReusePatternsAction({ scopePath: props.scopePath, query: props.query }) as Pattern[]))} className="inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-[var(--radius-3)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-50">
            <Search size={14} /> Search patterns
          </button>
        </div>
        {props.patterns.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {props.patterns.map((pattern) => (
              <div key={pattern.slug} className="rounded-[var(--radius-3)] bg-[var(--raised)] p-3">
                <div className="font-medium">{pattern.title}</div>
                <div className="mt-1 text-[var(--font-size-xs)] text-[var(--mutedfg)]">{pattern.summary || pattern.slug}</div>
                {pattern.sourceScopePath && pattern.sourceVisible ? <div className="mt-1 text-[var(--font-size-xs)] text-[var(--mutedfg)]">Currently used by {pattern.sourceScopePath}</div> : null}
                <button disabled={!pattern.reusable || !props.canEdit || props.busy} onClick={() => props.runAction(async () => {
                  const next = await acceptReusePatternAction({ intakeId: props.intake.id, patternSlug: pattern.slug, scopePath: props.scopePath }) as Intake;
                  props.setSpec(pretty(next.proposedProvisionSpec));
                  props.setDocs(pretty(next.proposedDocs));
                  props.setTasks(pretty(next.proposedTasks));
                  props.setWiki(pretty(next.proposedWikiUpdates));
                  props.mergeIntake(next);
                }, "Reuse pattern applied.")} className="mt-3 rounded-[var(--radius-3)] border border-[var(--border)] px-2 py-1 text-[var(--font-size-xs)] hover:bg-[var(--hover)] disabled:opacity-50">
                  Start from this
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <button type="button" data-stage-item onClick={props.onContinue} className="min-h-[44px] cursor-pointer rounded-[var(--radius-3)] bg-[var(--primary)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--primaryfg)] hover:bg-[var(--primaryhover)]">Continue to interview</button>
    </section>
  );
}

function InterviewStep(props: {
  busy: boolean;
  canEdit: boolean;
  pack: { pasteBack: string; mcp: string } | null;
  paste: string;
  setPaste: (value: string) => void;
  errors: string[];
  setErrors: (value: string[]) => void;
  packButtonRef: React.RefObject<HTMLButtonElement | null>;
  mcpButtonRef: React.RefObject<HTMLButtonElement | null>;
  onCopy: (value: string, ref: React.RefObject<HTMLButtonElement | null>, label: string) => Promise<void>;
  runAction: (fn: () => Promise<void>, success?: string) => void;
  intake: Intake;
  scopePath: string;
  setPack: (value: { pasteBack: string; mcp: string } | null) => void;
  mergeIntake: (next: Intake) => void;
  setMarkdownOnlyWarning: (value: boolean) => void;
  hydrateReview: (next: Intake, viaMcp?: boolean) => void;
}) {
  return (
    <section className="space-y-[var(--space-4)]">
      <StepTitle title="Interview" body="Copy the interview pack, send it out, then paste the full reply here." />
      <div data-stage-item className="rounded-[var(--radius-3)] bg-[var(--warnbg)] p-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--warn)]">
        Markdown-only results are accepted, but structured replies are checked first and reduce manual review.
      </div>
      <button disabled={!props.canEdit || props.busy} onClick={() => props.runAction(async () => {
        const result = await externalPackAction({ intakeId: props.intake.id, scopePath: props.scopePath });
        props.setPack(result.pack);
        props.mergeIntake(result.intake as Intake);
      }, "Interview pack ready to copy.")} className="inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-[var(--radius-3)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-50">
        <Clipboard size={14} /> Copy interview pack
      </button>
      {props.pack ? (
        <div data-stage-item className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <PackBox label="Interview pack" value={props.pack.pasteBack} buttonRef={props.packButtonRef} onCopy={() => props.onCopy(props.pack!.pasteBack, props.packButtonRef, "Pack")} buttonLabel="Copy pack" minWidth={120} />
          <PackBox label="MCP variant" value={props.pack.mcp} buttonRef={props.mcpButtonRef} onCopy={() => props.onCopy(props.pack!.mcp, props.mcpButtonRef, "MCP variant")} buttonLabel="Copy MCP config" secondary minWidth={172} />
        </div>
      ) : null}
      <textarea value={props.paste} onChange={(e) => props.setPaste(e.target.value)} className="min-h-32 w-full rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--bg)] p-3 text-[var(--font-size-sm)]" placeholder="Paste the LLM's full reply here, don't trim it." />
      {props.errors.length > 0 ? (
        <ul className="rounded-[var(--radius-3)] bg-[var(--errbg)] p-2 text-[var(--font-size-xs)] text-[var(--err)]">
          {props.errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      ) : null}
      <button disabled={!props.canEdit || props.busy} onClick={() => props.runAction(async () => {
        const result = await submitPasteAction({ intakeId: props.intake.id, pasteText: props.paste, scopePath: props.scopePath });
        if (result.errors?.length) {
          props.setErrors(result.errors);
          return;
        }
        props.setErrors([]);
        props.setMarkdownOnlyWarning(!!result.markdownOnly);
        const next = result.intake as Intake;
        props.hydrateReview(next);
      }, "Interview results submitted for review.")} className="min-h-[44px] cursor-pointer rounded-[var(--radius-3)] bg-[var(--primary)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--primaryfg)] hover:bg-[var(--primaryhover)] disabled:cursor-not-allowed disabled:opacity-50">
        Submit results
      </button>
    </section>
  );
}

function PackBox({
  label,
  value,
  buttonRef,
  onCopy,
  buttonLabel,
  secondary = false,
  minWidth = 120,
}: {
  label: string;
  value: string;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  onCopy: () => void;
  buttonLabel: string;
  secondary?: boolean;
  minWidth?: number;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    onCopy();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[var(--font-size-xs)] text-[var(--mutedfg)]">{label}</div>
        <button
          ref={buttonRef}
          type="button"
          onClick={handleCopy}
          style={{ minWidth: `${minWidth}px` }}
          className={`inline-flex min-h-[36px] cursor-pointer items-center justify-center gap-1 rounded-[var(--radius-3)] px-[var(--space-2)] text-[var(--font-size-xs)] ${secondary ? "border border-[var(--border)] text-[var(--fg)] hover:bg-[var(--hover)]" : "bg-[var(--primary)] text-[var(--primaryfg)] hover:bg-[var(--primaryhover)]"}`}
        >
          <Copy size={13} /> {copied ? "Copied" : buttonLabel}
        </button>
      </div>
      <textarea readOnly value={value} className="min-h-48 w-full rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-[var(--font-size-xs)]" />
    </div>
  );
}

function ReviewStep(props: {
  intake: Intake;
  markdownOnlyWarning: boolean;
  spec: string;
  setSpec: (value: string) => void;
  docs: string;
  setDocs: (value: string) => void;
  tasks: string;
  setTasks: (value: string) => void;
  wiki: string;
  setWiki: (value: string) => void;
  questions: string;
  setQuestions: (value: string) => void;
  risks: string;
  setRisks: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  openQuestions: OpenQuestionEntry[];
  remainingQuestions: number;
  burstQuestion: number | null;
  setBurstQuestion: (value: number | null) => void;
  toggleQuestion: (index: number) => void;
  answeringQuestion: number | null;
  answerDrafts: Record<number, string>;
  setAnswerDrafts: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  openAnswerEditor: (index: number) => void;
  markQuestionAnswered: (index: number) => void;
  busy: boolean;
  canEdit: boolean;
  canAdmin: boolean;
  runAction: (fn: () => Promise<void>, success?: string) => void;
  scopePath: string;
  mergeIntake: (next: Intake) => void;
  flushOpenQuestionSaves: () => Promise<void>;
  onProvisionReady: () => void;
}) {
  return (
    <section className="space-y-[var(--space-4)]">
      <StepTitle title="Review" body="Check the generated setup artifacts, clear open questions, then approve the build." />
      {props.markdownOnlyWarning ? (
        <div data-stage-item className="flex gap-2 rounded-[var(--radius-3)] bg-[var(--errbg)] p-3 text-[var(--font-size-sm)] font-medium text-[var(--err)]">
          <AlertTriangle size={16} /> No structured reply found. You can continue, every review field will start empty and must be filled by hand.
        </div>
      ) : null}
      {props.intake.packSnapshot ? (
        <details data-stage-item className="rounded-[var(--radius-3)] bg-[var(--raised)] p-3">
          <summary className="cursor-pointer text-[var(--font-size-sm)] font-medium">What was sent to the interview</summary>
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-[var(--font-size-xs)]">{props.intake.packSnapshot}</pre>
        </details>
      ) : null}
      {props.intake.packetMd ? <div data-stage-item className="max-h-48 overflow-auto rounded-[var(--radius-3)] bg-[var(--raised)] p-3 text-[var(--font-size-sm)] whitespace-pre-wrap">{props.intake.packetMd}</div> : null}
      <div data-stage-item className="rounded-[var(--radius-4)] bg-[var(--raised)] p-[var(--space-3)]">
        <div className="mb-[var(--space-2)] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[var(--font-size-sm)] font-medium"><FileText size={15} /> Open questions</div>
          <span className="font-mono text-[var(--font-size-xs)] text-[var(--mutedfg)]">{props.remainingQuestions} open</span>
        </div>
        {props.openQuestions.length === 0 ? (
          <EmptyState icon={<Check size={16} />} title="No open questions" body="This setup can move straight to approval." />
        ) : (
          <div className="space-y-1">
            {props.openQuestions.map((question, index) => {
              const checked = question.done;
              const remainingAfter = props.openQuestions.filter((item, itemIndex) => itemIndex !== index && !item.done).length;
              const editable = props.canEdit && props.intake.status !== "approved" && props.intake.status !== "provisioned";
              const answerDraft = props.answerDrafts[index] ?? question.answer ?? "";
              return (
                <div
                  key={`${question.t}-${index}`}
                  className="rounded-[var(--radius-3)] px-[var(--space-2)] py-[var(--space-2)] hover:bg-[var(--hover)]"
                >
                  <div className="flex items-start gap-3 text-left text-[var(--font-size-sm)]">
                    {/* The hidden native input keeps keyboard/AT semantics; CompletionReward is the single visual indicator. */}
                    <label className={`mt-1 ${editable && !props.busy ? "cursor-pointer" : "cursor-not-allowed"} has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--primary)]`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!editable || props.busy}
                        onChange={() => props.toggleQuestion(index)}
                        className="sr-only"
                        aria-label={`Mark question answered: ${question.t}`}
                      />
                      <CompletionReward active={props.burstQuestion === index} checked={checked} />
                    </label>
                    <button
                      type="button"
                      onClick={() => props.openAnswerEditor(index)}
                      disabled={!editable}
                      className={`min-w-0 flex-1 text-left ${editable ? "cursor-pointer" : "cursor-default"} ${checked ? "text-[var(--mutedfg)] line-through" : "text-[var(--fg)]"}`}
                    >
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {question.t}
                        {question.tag === "decision" ? (
                          <span className="rounded-full bg-[var(--warnbg)] px-2 py-px text-[var(--font-size-xs)] text-[var(--warn)]">decision</span>
                        ) : question.tag === "unknown" ? (
                          <span className="rounded-full bg-[var(--muted)] px-2 py-px text-[var(--font-size-xs)] text-[var(--mutedfg)]">unknown</span>
                        ) : null}
                        {props.burstQuestion === index && !rm() ? (
                          <span className="completion-cheer pointer-events-none whitespace-nowrap font-mono text-[var(--font-size-xs)] text-[var(--ok)]">
                            {remainingAfter === 0 ? "all clear" : `${remainingAfter} to go`}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </div>
                  {question.answer ? (
                    <div className="ml-14 mt-1 text-[var(--font-size-xs)] text-[var(--mutedfg)]">Answer: {question.answer}</div>
                  ) : null}
                  {editable && props.answeringQuestion === index && !question.answer ? (
                    <div className="ml-14 mt-2 flex flex-wrap items-center gap-2">
                      <input
                        value={answerDraft}
                        onChange={(event) => props.setAnswerDrafts((current) => ({ ...current, [index]: event.target.value }))}
                        placeholder="Answer..."
                        aria-label={`Answer question: ${question.t}`}
                        className="min-h-[36px] min-w-[220px] flex-1 rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--font-size-xs)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                      />
                      <button
                        type="button"
                        disabled={!answerDraft.trim() || props.busy}
                        onClick={() => props.markQuestionAnswered(index)}
                        className="min-h-[36px] cursor-pointer rounded-[var(--radius-3)] bg-[var(--primary)] px-2 py-1 text-[var(--font-size-xs)] text-[var(--primaryfg)] hover:bg-[var(--primaryhover)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Mark answered
                      </button>
                    </div>
                  ) : null}
                  {editable && !question.answer && props.answeringQuestion !== index ? (
                    <button type="button" onClick={() => props.openAnswerEditor(index)} className="ml-14 mt-1 cursor-pointer text-[var(--font-size-xs)] text-[var(--primary)] hover:underline">
                      Add answer
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {props.openQuestions.length > 0 ? (
          <div className="mt-2 text-[var(--font-size-xs)] text-[var(--mutedfg)]">Unresolved questions become Things to resolve items on this scope when setup is provisioned.</div>
        ) : null}
      </div>
      <LabeledArea label="What will be created" value={props.spec} onChange={props.setSpec} />
      <LabeledArea label="Documents" value={props.docs} onChange={props.setDocs} />
      <LabeledArea label="Tasks" value={props.tasks} onChange={props.setTasks} />
      <LabeledArea label="Wiki updates" value={props.wiki} onChange={props.setWiki} />
      <LabeledArea label="Open questions JSON / notes" value={props.questions} onChange={props.setQuestions} />
      <LabeledArea label="Risk notes" value={props.risks} onChange={props.setRisks} />
      {props.canAdmin ? (
        <label className="block">
          <span className="mb-1 block text-[var(--font-size-xs)] text-[var(--mutedfg)]">Why is this going back?</span>
          <input value={props.reason} onChange={(e) => props.setReason(e.target.value)} className="min-h-[44px] w-full rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--font-size-sm)]" placeholder="Reason for the setup menu action" />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button disabled={!props.canEdit || props.busy} onClick={() => props.runAction(async () => {
          // Serialize behind the autosave queue: saveReviewAction also writes
          // openQuestions, so racing an in-flight toggle save could persist
          // whichever response lands last and lose the newer edit.
          await props.flushOpenQuestionSaves();
          props.mergeIntake(await saveReviewAction({ intakeId: props.intake.id, scopePath: props.scopePath, specJson: props.spec, docsJson: props.docs, tasksJson: props.tasks, wikiJson: props.wiki, questionsJson: props.questions, risksJson: props.risks }) as Intake);
        }, "Review saved.")} className="min-h-[44px] cursor-pointer rounded-[var(--radius-3)] border border-[var(--border)] px-3 py-2 text-[var(--font-size-sm)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-50">
          Save review
        </button>
        <button disabled={!props.canAdmin || props.intake.status !== "needs_review" || props.busy} onClick={() => props.runAction(async () => {
          await props.flushOpenQuestionSaves();
          props.mergeIntake(await approveIntakeAction({ intakeId: props.intake.id, scopePath: props.scopePath }) as Intake);
          props.onProvisionReady();
        }, "Setup approved.")} className="inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-[var(--radius-3)] bg-[var(--primary)] px-3 py-2 text-[var(--font-size-sm)] text-[var(--primaryfg)] hover:bg-[var(--primaryhover)] disabled:cursor-not-allowed disabled:opacity-50">
          <Check size={14} /> Approve
        </button>
      </div>
    </section>
  );
}

function ProvisionStep({ steps, running, error, live, canProvision, onProvision }: { steps: ProvisionDisplayStep[]; running: boolean; error: string | null; live: boolean; canProvision: boolean; onProvision: () => void }) {
  return (
    <section className="space-y-[var(--space-4)]">
      <StepTitle title={live ? "Project is live" : "Create everything"} body="Run the setup sequence and watch each operation complete." />
      <div data-stage-item className="space-y-2">
        {steps.map((item) => (
          <div key={item.key} className={`flex items-center justify-between gap-3 rounded-[var(--radius-3)] px-[var(--space-3)] py-[var(--space-2)] ${item.status === "manual" ? "bg-[var(--warnbg)] text-[var(--warn)]" : "bg-[var(--raised)]"}`}>
            <div className="min-w-0">
              <div className="text-[var(--font-size-sm)] font-medium">{item.message}</div>
              <div className="font-mono text-[var(--font-size-xs)] text-[var(--mutedfg)]">{item.status}: {item.key}</div>
            </div>
            <ProvisionStatusIcon status={item.status} />
          </div>
        ))}
      </div>
      {error ? (
        <div data-stage-item className="rounded-[var(--radius-4)] bg-[var(--errbg)] p-[var(--space-4)] text-[var(--err)]">{error}</div>
      ) : null}
      {live ? (
        <div data-stage-item className="rounded-[var(--radius-4)] bg-[var(--okbg)] p-[var(--space-4)] text-[var(--ok)]">Project is live.</div>
      ) : null}
      <button disabled={!canProvision || running || live} onClick={onProvision} className="inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-[var(--radius-3)] bg-[var(--primary)] px-3 py-2 text-[var(--font-size-sm)] text-[var(--primaryfg)] hover:bg-[var(--primaryhover)] disabled:cursor-not-allowed disabled:opacity-50">
        <Play size={14} /> {running ? "Creating…" : "Create everything"}
      </button>
    </section>
  );
}

function ProvisionStatusIcon({ status }: { status: ProvisionStatus }) {
  if (status === "running") return <ProvisionSpinner />;
  if (status === "manual") return <AlertTriangle className="text-[var(--warn)]" size={16} />;
  if (status === "skipped") return <MoreHorizontal className="text-[var(--mutedfg)]" size={16} />;
  if (status === "created" || status === "existing") return <Check className="text-[var(--ok)]" size={16} />;
  return <span className="h-4 w-4 rounded-full border border-[var(--borderstrong)]" />;
}

function ProvisionSpinner() {
  const ref = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    if (!ref.current || rm()) return;
    void anim((gsap) => {
      if (!ref.current) return;
      gsap.to(ref.current, { rotate: 360, duration: df(1), ease: "none", repeat: -1, transformOrigin: "50% 50%" });
    });
  }, []);
  return <LoaderCircle ref={ref} className="text-[var(--primary)]" size={16} />;
}

function LabeledArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label data-stage-item className="block">
      <span className="mb-1 block text-[var(--font-size-xs)] text-[var(--mutedfg)]">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} className="min-h-28 w-full rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-[var(--font-size-xs)]" />
    </label>
  );
}
