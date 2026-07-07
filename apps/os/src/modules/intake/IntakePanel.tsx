"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Clipboard, FileText, Play, RefreshCw, Search, X } from "lucide-react";
import {
  acceptReusePatternAction,
  approveIntakeAction,
  dismissIntakeAction,
  externalPackAction,
  findReusePatternsAction,
  provisionIntakeAction,
  rejectIntakeAction,
  reopenIntakeAction,
  saveFramingAction,
  saveReviewAction,
  submitPasteAction,
} from "./actions";

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

function pretty(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export function IntakePanel({
  scopePath,
  initialIntakes,
  initialOpenId,
  access,
}: {
  scopePath: string;
  initialIntakes: Intake[];
  initialOpenId?: string | null;
  access: string;
}) {
  const [intakes, setIntakes] = useState(initialIntakes);
  const [activeId, setActiveId] = useState(initialOpenId || initialIntakes.find((i) => !["provisioned", "rejected", "dismissed"].includes(i.status))?.id || initialIntakes[0]?.id || null);
  const [isPending, startTransition] = useTransition();
  const active = intakes.find((i) => i.id === activeId) || null;
  const canAdmin = access === "owner" || access === "admin";
  const canEdit = canAdmin || access === "editor" || access === "agent";

  function mergeIntake(next: Intake) {
    setIntakes((rows) => rows.map((row) => row.id === next.id ? next : row));
    setActiveId(next.id);
  }

  const resume = useMemo(() => intakes.find((i) => ["draft", "awaiting_external", "needs_review", "approved"].includes(i.status)), [intakes]);

  return (
    <div className="space-y-[var(--space-4)]">
      {resume && (
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
          <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
            <div>
              <div className="text-[var(--font-size-sm)] font-medium">Setup incomplete</div>
              <div className="mt-1 text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                {statusLabel(resume.status)} · {resume.templateSlug}
              </div>
            </div>
            <div className="flex gap-[var(--space-2)]">
              <button onClick={() => setActiveId(resume.id)} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--primary-foreground)]">
                <Play size={14} /> Resume
              </button>
              {canAdmin && (
                <button
                  onClick={() => startTransition(async () => mergeIntake(await dismissIntakeAction({ intakeId: resume.id, scopePath }) as Intake))}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]"
                >
                  <X size={14} /> Dismiss
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-[280px_1fr]">
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]">
          <div className="mb-[var(--space-2)] text-[var(--font-size-sm)] font-medium">Intake</div>
          <div className="space-y-1">
            {intakes.length === 0 ? (
              <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No intake packets.</div>
            ) : intakes.map((intake) => (
              <button
                key={intake.id}
                onClick={() => setActiveId(intake.id)}
                className={`w-full rounded-[var(--radius-sm)] border px-[var(--space-2)] py-[var(--space-2)] text-left text-[var(--font-size-sm)] ${activeId === intake.id ? "border-[var(--primary)] bg-[var(--muted)]" : "border-[var(--border)]"}`}
              >
                <div className="font-medium">{statusLabel(intake.status)}</div>
                <div className="mt-1 truncate text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{intake.id}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
          {active ? (
            <WizardWorkspace
              intake={active}
              scopePath={scopePath}
              canEdit={canEdit}
              canAdmin={canAdmin}
              busy={isPending}
              run={(fn) => startTransition(fn)}
              mergeIntake={mergeIntake}
            />
          ) : (
            <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No intake selected.</div>
          )}
        </div>
      </div>
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
}: {
  intake: Intake;
  scopePath: string;
  canEdit: boolean;
  canAdmin: boolean;
  busy: boolean;
  run: (fn: () => Promise<void>) => void;
  mergeIntake: (next: Intake) => void;
}) {
  const [answers, setAnswers] = useState(pretty(intake.answers));
  const [query, setQuery] = useState("");
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [pack, setPack] = useState<{ pasteBack: string; mcp: string } | null>(null);
  const [paste, setPaste] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [spec, setSpec] = useState(pretty(intake.proposedProvisionSpec));
  const [docs, setDocs] = useState(pretty(intake.proposedDocs));
  const [tasks, setTasks] = useState(pretty(intake.proposedTasks));
  const [wiki, setWiki] = useState(pretty(intake.proposedWikiUpdates));
  const [questions, setQuestions] = useState(pretty(intake.openQuestions));
  const [risks, setRisks] = useState(pretty(intake.riskNotes));
  const [reason, setReason] = useState("");

  return (
    <div className="space-y-[var(--space-5)]">
      <div className="flex flex-wrap items-start justify-between gap-[var(--space-3)]">
        <div>
          <div className="text-[var(--font-size-md)] font-medium">Creation wizard</div>
          <div className="mt-1 text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{intake.id} · {statusLabel(intake.status)}</div>
        </div>
        {intake.status === "dismissed" && canAdmin && (
          <button onClick={() => run(async () => mergeIntake(await reopenIntakeAction({ intakeId: intake.id, scopePath }) as Intake))} className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-3 py-2 text-sm">
            <RefreshCw size={14} /> Reopen
          </button>
        )}
      </div>

      <section className="space-y-[var(--space-2)]">
        <div className="text-[var(--font-size-sm)] font-medium">Framing</div>
        <textarea value={answers} onChange={(e) => setAnswers(e.target.value)} className="min-h-32 w-full rounded border border-[var(--border)] bg-[var(--background)] p-3 font-mono text-xs" />
        <button disabled={!canEdit || busy} onClick={() => run(async () => mergeIntake(await saveFramingAction({ intakeId: intake.id, answersJson: answers, scopePath }) as Intake))} className="rounded bg-[var(--primary)] px-3 py-2 text-sm text-[var(--primary-foreground)]">
          Save framing
        </button>
      </section>

      <section className="space-y-[var(--space-2)]">
        <div className="text-[var(--font-size-sm)] font-medium">Brain reuse</div>
        <div className="flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" placeholder="meta ads, client launch, codebase docs" />
          <button disabled={busy} onClick={() => run(async () => setPatterns(await findReusePatternsAction({ scopePath, query }) as Pattern[]))} className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-3 py-2 text-sm">
            <Search size={14} /> Check
          </button>
        </div>
        {patterns.length > 0 && (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {patterns.map((pattern) => (
              <div key={pattern.slug} className="rounded border border-[var(--border)] p-3">
                <div className="font-medium">{pattern.title}</div>
                <div className="mt-1 text-xs text-[var(--muted-foreground)]">{pattern.summary || pattern.slug}</div>
                {pattern.sourceScopePath && pattern.sourceVisible && <div className="mt-1 text-xs text-[var(--muted-foreground)]">In use at {pattern.sourceScopePath}</div>}
                <button disabled={!pattern.reusable || !canEdit || busy} onClick={() => run(async () => {
                  const next = await acceptReusePatternAction({ intakeId: intake.id, patternSlug: pattern.slug, scopePath }) as Intake;
                  setSpec(pretty(next.proposedProvisionSpec));
                  setDocs(pretty(next.proposedDocs));
                  setTasks(pretty(next.proposedTasks));
                  setWiki(pretty(next.proposedWikiUpdates));
                  mergeIntake(next);
                })} className="mt-3 rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-50">
                  Use template
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-[var(--space-2)]">
        <div className="text-[var(--font-size-sm)] font-medium">External pack</div>
        <button disabled={!canEdit || busy} onClick={() => run(async () => setPack(await externalPackAction({ intakeId: intake.id, scopePath })))} className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-3 py-2 text-sm">
          <Clipboard size={14} /> Assemble pack
        </button>
        {pack && (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <textarea readOnly value={pack.pasteBack} className="min-h-48 rounded border border-[var(--border)] bg-[var(--background)] p-3 font-mono text-xs" />
            <textarea readOnly value={pack.mcp} className="min-h-48 rounded border border-[var(--border)] bg-[var(--background)] p-3 font-mono text-xs" />
          </div>
        )}
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} className="min-h-32 w-full rounded border border-[var(--border)] bg-[var(--background)] p-3 text-sm" placeholder="Paste external packet markdown here" />
        {errors.length > 0 && <div className="rounded border border-[var(--destructive)] p-2 text-xs text-[var(--destructive)]">{errors.join(" · ")}</div>}
        <button disabled={!canEdit || busy} onClick={() => run(async () => {
          const result = await submitPasteAction({ intakeId: intake.id, pasteText: paste, scopePath });
          if (result.errors?.length) {
            setErrors(result.errors);
            return;
          }
          setErrors([]);
          const next = result.intake as Intake;
          setSpec(pretty(next.proposedProvisionSpec));
          setDocs(pretty(next.proposedDocs));
          setTasks(pretty(next.proposedTasks));
          setWiki(pretty(next.proposedWikiUpdates));
          setQuestions(pretty(next.openQuestions));
          setRisks(pretty(next.riskNotes));
          mergeIntake(next);
        })} className="rounded bg-[var(--primary)] px-3 py-2 text-sm text-[var(--primary-foreground)]">
          Submit return
        </button>
      </section>

      <section className="space-y-[var(--space-2)]">
        <div className="flex items-center gap-2 text-[var(--font-size-sm)] font-medium"><FileText size={15} /> Review</div>
        {intake.packetMd && <div className="max-h-48 overflow-auto rounded border border-[var(--border)] bg-[var(--background)] p-3 text-sm whitespace-pre-wrap">{intake.packetMd}</div>}
        <LabeledArea label="Provision spec" value={spec} onChange={setSpec} />
        <LabeledArea label="Docs" value={docs} onChange={setDocs} />
        <LabeledArea label="Tasks" value={tasks} onChange={setTasks} />
        <LabeledArea label="Wiki updates" value={wiki} onChange={setWiki} />
        <LabeledArea label="Open questions" value={questions} onChange={setQuestions} />
        <LabeledArea label="Risk notes" value={risks} onChange={setRisks} />
        <div className="flex flex-wrap gap-2">
          <button disabled={!canEdit || busy} onClick={() => run(async () => mergeIntake(await saveReviewAction({ intakeId: intake.id, scopePath, specJson: spec, docsJson: docs, tasksJson: tasks, wikiJson: wiki, questionsJson: questions, risksJson: risks }) as Intake))} className="rounded border border-[var(--border)] px-3 py-2 text-sm">
            Save review
          </button>
          <button disabled={!canAdmin || intake.status !== "needs_review" || busy} onClick={() => run(async () => mergeIntake(await approveIntakeAction({ intakeId: intake.id, scopePath }) as Intake))} className="inline-flex items-center gap-1 rounded bg-[var(--primary)] px-3 py-2 text-sm text-[var(--primary-foreground)] disabled:opacity-50">
            <Check size={14} /> Approve
          </button>
          <button disabled={!canAdmin || intake.status !== "approved" || busy} onClick={() => run(async () => {
            const result = await provisionIntakeAction({ intakeId: intake.id, scopePath });
            mergeIntake(result.intake as Intake);
          })} className="inline-flex items-center gap-1 rounded bg-[var(--primary)] px-3 py-2 text-sm text-[var(--primary-foreground)] disabled:opacity-50">
            <Play size={14} /> Provision
          </button>
        </div>
        {canAdmin && (
          <div className="flex gap-2">
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" placeholder="Reject reason" />
            <button disabled={busy} onClick={() => run(async () => mergeIntake(await rejectIntakeAction({ intakeId: intake.id, scopePath, reason }) as Intake))} className="rounded border border-[var(--destructive)] px-3 py-2 text-sm text-[var(--destructive)]">
              Reject
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function LabeledArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[var(--muted-foreground)]">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} className="min-h-28 w-full rounded border border-[var(--border)] bg-[var(--background)] p-3 font-mono text-xs" />
    </label>
  );
}
