import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, CircleHelp, History, Network, Play, Settings2 } from "lucide-react";
import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { ConfirmSubmitButton } from "@/modules/admin/ConfirmSubmitButton";
import { triggerBrainRunAction } from "@/modules/brain/actions";

function isRootAdmin(role: string | null): boolean {
  return role === "owner" || role === "admin";
}

function fmtDate(value: Date | string | null) {
  if (!value) return "-";
  return new Date(value).toISOString().slice(0, 16).replace("T", " ");
}

const activityLabels = {
  ingest: "Update Wiki knowledge",
  lint: "Check Wiki health",
  backfill: "Review older records",
} as const;

const activityDescriptions = {
  ingest: "Refreshes the Wiki from the latest business records.",
  lint: "Looks for Wiki questions that may need a human answer. This can spend AI tokens.",
  backfill: "Reviews older records for useful Wiki updates. This can spend AI tokens.",
} as const;

function activityLabel(mode: string | null): string {
  if (mode === "ingest" || mode === "lint" || mode === "backfill") return activityLabels[mode];
  return "Wiki maintenance";
}

function statusLabel(status: string, partial: boolean): string {
  if (partial) return "Needs attention";
  if (status === "success" || status === "completed") return "Completed";
  if (status === "running" || status === "queued") return "In progress";
  if (status === "failed" || status === "error") return "Needs attention";
  return "For review";
}

function severityLabel(severity: string): string {
  if (severity === "critical") return "Urgent";
  if (severity === "warning") return "Needs attention";
  return "For review";
}

function questionStatusLabel(status: string): string {
  if (status === "open") return "For review";
  if (status === "approved" || status === "dismissed" || status === "rejected") return "Completed";
  return "For review";
}

function durationLabel(value: number | null): string {
  if (value === null) return "-";
  if (value < 1000) return `${value}ms`;
  return `${Math.round(value / 1000)}s`;
}

export default async function BrainEnginePage() {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;
  const rootRole = await api.resolveAccess(actor, "root");
  if (!isRootAdmin(rootRole)) notFound();

  const ops = await api.getBrainEngineOps({}, actor);

  return (
    <div className="space-y-[var(--space-4)]">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <div>
          <h1 className="text-[var(--font-size-2xl)] font-semibold">Wiki health</h1>
          <div className="mt-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            See open Wiki questions, check for stale or conflicting pages, and review recent maintenance.
          </div>
        </div>
        <div className="flex items-center gap-[var(--space-2)] text-[var(--font-size-sm)]">
          <Link
            href="/brain"
            className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <Network size={16} />
            Wiki map
          </Link>
          <Link
            href="/brain/engine"
            className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--primary)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <Settings2 size={16} />
            Health
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-[var(--space-3)] md:grid-cols-3">
        <Stat label="AI tokens used" value={ops.spend.totalTokensEst.toLocaleString()} />
        <Stat label="AI spend" value={`$${ops.spend.actualCostUsd.toFixed(4)}`} />
        <Stat label="Open Wiki questions" value={String(ops.lintFindings.filter((finding) => finding.status === "open").length)} />
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <div className="mb-[var(--space-3)] flex flex-wrap items-center justify-between gap-[var(--space-2)]">
          <div className="flex items-center gap-[var(--space-2)] text-[var(--font-size-sm)] font-medium">
            <Activity size={16} />
            Check Wiki health
          </div>
          <div className="flex flex-wrap gap-[var(--space-2)]">
            {(["ingest", "lint", "backfill"] as const).map((mode) => (
              <form key={mode} action={triggerBrainRunAction}>
                <input type="hidden" name="mode" value={mode} />
                <ConfirmSubmitButton
                  title={activityLabels[mode]}
                  body={`${activityDescriptions[mode]} Start this now?`}
                  confirmLabel={activityLabels[mode]}
                  tone="default"
                  className="inline-flex min-h-11 items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] text-[var(--font-size-sm)] hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Play size={16} />
                  {activityLabels[mode]}
                </ConfirmSubmitButton>
              </form>
            ))}
          </div>
        </div>
        <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
          Each action reviews Wiki knowledge in a different way. Some checks can spend AI tokens.
        </div>
      </div>

      <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center gap-[var(--space-2)] border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)] text-[var(--font-size-sm)] font-medium">
          <History size={16} />
          Wiki maintenance history
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[var(--font-size-sm)]">
            <thead className="text-[var(--muted-foreground)]">
              <tr>
                <th className="px-[var(--space-4)] py-[var(--space-2)]">Started</th>
                <th className="px-[var(--space-4)] py-[var(--space-2)]">Activity</th>
                <th className="px-[var(--space-4)] py-[var(--space-2)]">Status</th>
                <th className="px-[var(--space-4)] py-[var(--space-2)]">Time spent</th>
                <th className="px-[var(--space-4)] py-[var(--space-2)]">Pages reviewed</th>
                <th className="px-[var(--space-4)] py-[var(--space-2)]">Records reviewed</th>
                <th className="px-[var(--space-4)] py-[var(--space-2)]">AI tokens</th>
              </tr>
            </thead>
            <tbody>
              {ops.runs.length === 0 ? (
                <tr><td className="px-[var(--space-4)] py-[var(--space-3)] text-[var(--muted-foreground)]" colSpan={7}>No maintenance yet.</td></tr>
              ) : ops.runs.map((run) => (
                <tr key={run.id} className="border-t border-[var(--border)]">
                  <td className="px-[var(--space-4)] py-[var(--space-2)] text-[var(--font-size-xs)]">{fmtDate(run.startedAt)}</td>
                  <td className="px-[var(--space-4)] py-[var(--space-2)]">{activityLabel(run.mode)}</td>
                  <td className="px-[var(--space-4)] py-[var(--space-2)]">{statusLabel(run.status, run.partial)}</td>
                  <td className="px-[var(--space-4)] py-[var(--space-2)] text-[var(--font-size-xs)]">{durationLabel(run.durationMs)}</td>
                  <td className="px-[var(--space-4)] py-[var(--space-2)] font-mono">{run.pagesTouched}</td>
                  <td className="px-[var(--space-4)] py-[var(--space-2)] font-mono">{run.recordsDistilled}</td>
                  <td className="px-[var(--space-4)] py-[var(--space-2)] font-mono">{run.tokens}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center gap-[var(--space-2)] border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)] text-[var(--font-size-sm)] font-medium">
          <CircleHelp size={16} />
          Wiki question history
        </div>
        <div className="divide-y divide-[var(--border)]">
          {ops.lintFindings.length === 0 ? (
            <div className="px-[var(--space-4)] py-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No Wiki questions have been found.</div>
          ) : ops.lintFindings.map((finding) => (
            <a key={finding.id} href={finding.href} className="block px-[var(--space-4)] py-[var(--space-3)] hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]">
              <div className="flex flex-wrap items-center gap-[var(--space-2)] text-[var(--font-size-sm)]">
                <span className="font-medium">{finding.title}</span>
                <span className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-px text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{severityLabel(finding.severity)}</span>
                <span className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-px text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{questionStatusLabel(finding.status)}</span>
                <span className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{finding.pageTitle}</span>
              </div>
              <div className="mt-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">{finding.message}</div>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]">
      <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{label}</div>
      <div className="mt-[var(--space-1)] font-mono text-[var(--font-size-xl)] tabular-nums">{value}</div>
    </div>
  );
}
