"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Clipboard, FileText, Play, RefreshCw, Search, X } from "lucide-react";
import {
  acceptReusePatternAction,
  approveIntakeAction,
  dismissIntakeAction,
  externalPackAction,
  findRelatedHistoryAction,
  findReusePatternsAction,
  provisionIntakeAction,
  rejectIntakeAction,
  reopenIntakeAction,
  saveFramingFieldsAction,
  saveRelatedHistoryAction,
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

function pretty(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringifyRecordValues(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === "string" ? item : String(item ?? "")]));
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
              framingTemplates={framingTemplates}
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
  framingTemplates,
}: {
  intake: Intake;
  scopePath: string;
  canEdit: boolean;
  canAdmin: boolean;
  busy: boolean;
  run: (fn: () => Promise<void>) => void;
  mergeIntake: (next: Intake) => void;
  framingTemplates: FramingTemplate[];
}) {
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
  const [markdownOnlyWarning, setMarkdownOnlyWarning] = useState(false);
  const [spec, setSpec] = useState(pretty(intake.proposedProvisionSpec));
  const [docs, setDocs] = useState(pretty(intake.proposedDocs));
  const [tasks, setTasks] = useState(pretty(intake.proposedTasks));
  const [wiki, setWiki] = useState(pretty(intake.proposedWikiUpdates));
  const [questions, setQuestions] = useState(pretty(intake.openQuestions));
  const [risks, setRisks] = useState(pretty(intake.riskNotes));
  const [reason, setReason] = useState("");
  const template = framingTemplates.find((item) => item.slug === intake.templateSlug) || framingTemplates[0];
  const reasonText = answers.reason || "";

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
        <div className="rounded border border-[var(--border)] bg-[var(--background)] p-3 text-sm">
          <div className="text-xs text-[var(--muted-foreground)]">Reason</div>
          <div className="mt-1 whitespace-pre-wrap">{reasonText || "No reason captured."}</div>
        </div>
        <div className="grid grid-cols-1 gap-3">
          {(template?.questions || []).map((question) => (
            <label key={question.key} className="block">
              <span className="mb-1 block text-xs text-[var(--muted-foreground)]">{question.question}</span>
              <input
                value={answers[question.key] || ""}
                onChange={(e) => setAnswers((current) => ({ ...current, [question.key]: e.target.value }))}
                className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
            </label>
          ))}
        </div>
        <button disabled={!canEdit || busy} onClick={() => run(async () => {
          const next = await saveFramingFieldsAction({ intakeId: intake.id, answers: { ...answers, reason: reasonText }, scopePath }) as Intake;
          setAnswers(isRecord(next.answers) ? stringifyRecordValues(next.answers) : {});
          mergeIntake(next);
        })} className="rounded bg-[var(--primary)] px-3 py-2 text-sm text-[var(--primary-foreground)]">
          Save framing
        </button>
      </section>

      <section className="space-y-[var(--space-2)]">
        <div className="text-[var(--font-size-sm)] font-medium">Related history</div>
        <div className="flex gap-2">
          <input value={historyQuery} onChange={(e) => setHistoryQuery(e.target.value)} className="flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" placeholder="Optional extra search terms" />
          <button disabled={busy} onClick={() => run(async () => setHistoryHits(await findRelatedHistoryAction({ intakeId: intake.id, query: historyQuery, scopePath }) as RelatedHistoryHit[]))} className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-3 py-2 text-sm">
            <Search size={14} /> Find
          </button>
        </div>
        {historyHits.length > 0 && (
          <div className="space-y-2">
            {historyHits.map((hit) => {
              const checked = selectedHistory.some((item) => item.type === hit.type && item.id === hit.id);
              return (
                <label key={`${hit.type}:${hit.id}`} className="flex gap-2 rounded border border-[var(--border)] p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setSelectedHistory((current) => e.target.checked ? [...current, hit] : current.filter((item) => item.type !== hit.type || item.id !== hit.id))}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium">{hit.title}</span>
                    <span className="block text-xs text-[var(--muted-foreground)]">{hit.scopePath} · {hit.type}{hit.kind ? `:${hit.kind}` : ""}</span>
                    <span className="mt-1 block text-xs text-[var(--muted-foreground)]">{hit.snippet}</span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {selectedHistory.length > 0 && (
          <div className="rounded border border-[var(--border)] p-3 text-xs text-[var(--muted-foreground)]">
            Selected: {selectedHistory.map((hit) => hit.title).join(", ")}
          </div>
        )}
        <button disabled={!canEdit || busy} onClick={() => run(async () => {
          const next = await saveRelatedHistoryAction({ intakeId: intake.id, selections: selectedHistory, scopePath }) as Intake;
          setSelectedHistory(normalizeHistory(next.relatedHistorySelections));
          mergeIntake(next);
        })} className="rounded border border-[var(--border)] px-3 py-2 text-sm">
          Save related history
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
          setMarkdownOnlyWarning(!!result.markdownOnly);
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
        {markdownOnlyWarning && (
          <div className="rounded border border-[var(--destructive)] bg-[var(--background)] p-3 text-sm font-medium text-[var(--destructive)]">
            Markdown-only return: no fenced JSON packet was found. Review every field manually before approval.
          </div>
        )}
        {intake.packSnapshot && (
          <details className="rounded border border-[var(--border)] bg-[var(--background)] p-3">
            <summary className="cursor-pointer text-sm font-medium">Pack snapshot sent to external agent</summary>
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs">{intake.packSnapshot}</pre>
          </details>
        )}
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
