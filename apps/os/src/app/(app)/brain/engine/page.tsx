import Link from "next/link";
import { notFound } from "next/navigation";
import { Network, Play, Settings2 } from "lucide-react";
import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { triggerBrainRunAction } from "@/modules/brain/actions";

function isRootAdmin(role: string | null): boolean {
  return role === "owner" || role === "admin";
}

function fmtDate(value: Date | string | null) {
  if (!value) return "-";
  return new Date(value).toISOString().slice(0, 16).replace("T", " ");
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
          <h1 className="text-[var(--font-size-2xl)] font-semibold tracking-[-0.01em]">Brain Engine</h1>
          <div className="mt-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            Runs, lint, and spend
          </div>
        </div>
        <div className="flex items-center gap-[var(--space-2)] text-[var(--font-size-sm)]">
          <Link
            href="/brain"
            className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          >
            <Network size={16} />
            Graph
          </Link>
          <Link
            href="/brain/engine"
            className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--primary)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--primary)]"
          >
            <Settings2 size={16} />
            Engine
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-[var(--space-3)] md:grid-cols-3">
        <Stat label="Brain tokens" value={ops.spend.totalTokensEst.toLocaleString()} />
        <Stat label="Actual spend" value={`$${ops.spend.actualCostUsd.toFixed(4)}`} />
        <Stat label="Open lint findings" value={String(ops.lintFindings.length)} />
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <div className="mb-[var(--space-3)] flex flex-wrap items-center justify-between gap-[var(--space-2)]">
          <div className="text-[var(--font-size-sm)] font-medium">Manual triggers</div>
          <div className="flex flex-wrap gap-[var(--space-2)]">
            {(["ingest", "lint", "backfill"] as const).map((mode) => (
              <form key={mode} action={triggerBrainRunAction}>
                <input type="hidden" name="mode" value={mode} />
                <button className="inline-flex min-h-11 items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] text-[var(--font-size-sm)] hover:bg-[var(--muted)]">
                  <Play size={16} />
                  {mode}
                </button>
              </form>
            ))}
          </div>
        </div>
      </div>

      <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)] text-[var(--font-size-sm)] font-medium">
          Run history
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[var(--font-size-sm)]">
            <thead className="text-[var(--muted-foreground)]">
              <tr>
                <th className="px-[var(--space-4)] py-[var(--space-2)]">Started</th>
                <th className="px-[var(--space-4)] py-[var(--space-2)]">Mode</th>
                <th className="px-[var(--space-4)] py-[var(--space-2)]">Status</th>
                <th className="px-[var(--space-4)] py-[var(--space-2)]">Duration</th>
                <th className="px-[var(--space-4)] py-[var(--space-2)]">Pages</th>
                <th className="px-[var(--space-4)] py-[var(--space-2)]">Records</th>
                <th className="px-[var(--space-4)] py-[var(--space-2)]">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {ops.runs.length === 0 ? (
                <tr><td className="px-[var(--space-4)] py-[var(--space-3)] text-[var(--muted-foreground)]" colSpan={7}>No runs.</td></tr>
              ) : ops.runs.map((run) => (
                <tr key={run.id} className="border-t border-[var(--border)]">
                  <td className="px-[var(--space-4)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">{fmtDate(run.startedAt)}</td>
                  <td className="px-[var(--space-4)] py-[var(--space-2)]">{run.mode || "-"}</td>
                  <td className="px-[var(--space-4)] py-[var(--space-2)]">{run.status}{run.partial ? " (partial)" : ""}</td>
                  <td className="px-[var(--space-4)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">{run.durationMs ?? 0}ms</td>
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
        <div className="border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)] text-[var(--font-size-sm)] font-medium">
          Lint findings
        </div>
        <div className="divide-y divide-[var(--border)]">
          {ops.lintFindings.length === 0 ? (
            <div className="px-[var(--space-4)] py-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No findings.</div>
          ) : ops.lintFindings.map((finding) => (
            <a key={finding.id} href={finding.href} className="block px-[var(--space-4)] py-[var(--space-3)] hover:bg-[var(--muted)]">
              <div className="flex flex-wrap items-center gap-[var(--space-2)] text-[var(--font-size-sm)]">
                <span className="font-medium">{finding.pageTitle}</span>
                <span className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-px text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{finding.severity}</span>
                <span className="font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{finding.scopePath}</span>
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
