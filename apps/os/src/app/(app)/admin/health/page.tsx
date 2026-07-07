import { notFound } from "next/navigation";
import Link from "next/link";
import { Activity, AlertTriangle, CheckCircle2, CircleHelp, XCircle } from "lucide-react";
import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { opsHealthDeps, opsHealthEnvironment } from "@/lib/ops-health";
import type { HealthStatus, OpsHealthCheck, OpsRunLogRow } from "@companyos/api";

function isRootAdmin(role: string | null): boolean {
  return role === "owner" || role === "admin";
}

function fmtDate(value: Date | string | null) {
  if (!value) return "-";
  return new Date(value).toISOString().slice(0, 16).replace("T", " ");
}

function statusClass(status: HealthStatus): string {
  if (status === "ok") return "text-[var(--status-ok)]";
  if (status === "warning") return "text-[var(--status-warn)]";
  if (status === "error") return "text-[var(--status-error)]";
  return "text-[var(--muted-foreground)]";
}

function StatusIcon({ status }: { status: HealthStatus }) {
  const cls = statusClass(status);
  if (status === "ok") return <CheckCircle2 className={cls} size={16} />;
  if (status === "warning") return <AlertTriangle className={cls} size={16} />;
  if (status === "error") return <XCircle className={cls} size={16} />;
  return <CircleHelp className={cls} size={16} />;
}

export default async function HealthPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;
  const rootRole = await api.resolveAccess(actor, "root");
  if (!isRootAdmin(rootRole)) notFound();

  const params = await searchParams;
  const runStatus = params?.status && ["running", "success", "error"].includes(params.status) ? params.status : undefined;
  const env = opsHealthEnvironment();
  const health = await api.getOpsHealth({
    env,
    sendAlerts: true,
    dailyDigest: env.dailyDigestEnabled,
    runStatus,
  }, actor, opsHealthDeps());

  return (
    <div className="space-y-[var(--space-4)]">
      <div className="flex flex-wrap items-start justify-between gap-[var(--space-3)]">
        <div>
          <h1 className="text-[var(--font-size-2xl)] font-semibold tracking-[-0.01em]">Ops Health</h1>
          <div className="mt-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            Credential expiry, job liveness, webhook delivery, and alert surfacing.
          </div>
        </div>
        <div className="font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
          {fmtDate(health.generatedAt)}
        </div>
      </div>

      <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)] text-[var(--font-size-sm)] font-medium">
          Component health
        </div>
        <HealthTable checks={health.checks} />
      </section>

      <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)] border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
          <div className="flex items-center gap-[var(--space-2)] text-[var(--font-size-sm)] font-medium">
            <Activity size={16} />
            Run log
          </div>
          <div className="flex flex-wrap gap-[var(--space-2)] text-[var(--font-size-xs)]">
            <FilterLink active={!runStatus} href="/admin/health">All</FilterLink>
            <FilterLink active={runStatus === "running"} href="/admin/health?status=running">Running</FilterLink>
            <FilterLink active={runStatus === "success"} href="/admin/health?status=success">Success</FilterLink>
            <FilterLink active={runStatus === "error"} href="/admin/health?status=error">Error</FilterLink>
          </div>
        </div>
        <RunTable runs={health.runs} />
      </section>
    </div>
  );
}

function FilterLink({ active, href, children }: { active: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-[var(--radius-sm)] border px-[var(--space-2)] py-[var(--space-1)] hover:bg-[var(--muted)] ${active ? "border-[var(--primary)] text-[var(--primary)]" : "border-[var(--border)] text-[var(--muted-foreground)]"}`}
    >
      {children}
    </Link>
  );
}

function HealthTable({ checks }: { checks: OpsHealthCheck[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[var(--font-size-sm)]">
        <thead className="text-[var(--muted-foreground)]">
          <tr>
            <th className="px-[var(--space-4)] py-[var(--space-2)]">Component</th>
            <th className="px-[var(--space-4)] py-[var(--space-2)]">Status</th>
            <th className="px-[var(--space-4)] py-[var(--space-2)]">Last activity</th>
            <th className="px-[var(--space-4)] py-[var(--space-2)]">Expiry / next expected</th>
            <th className="px-[var(--space-4)] py-[var(--space-2)]">Latest error</th>
            <th className="px-[var(--space-4)] py-[var(--space-2)]">Drill-down</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((check) => (
            <tr key={check.key} className="border-t border-[var(--border)] align-top">
              <td className="px-[var(--space-4)] py-[var(--space-2)]">
                <div className="font-medium">{check.component}</div>
                <div className="mt-px text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{check.detail}</div>
              </td>
              <td className="px-[var(--space-4)] py-[var(--space-2)]">
                <div className="inline-flex items-center gap-[var(--space-1)]">
                  <StatusIcon status={check.status} />
                  <span className={statusClass(check.status)}>{check.status}</span>
                </div>
              </td>
              <td className="px-[var(--space-4)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">{fmtDate(check.lastActivityAt)}</td>
              <td className="px-[var(--space-4)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">{fmtDate(check.expiryAt || check.nextExpectedAt)}</td>
              <td className="max-w-[360px] px-[var(--space-4)] py-[var(--space-2)] text-[var(--muted-foreground)]">{check.latestError || "-"}</td>
              <td className="px-[var(--space-4)] py-[var(--space-2)]">
                {check.href ? <Link className="text-[var(--primary)] hover:underline" href={check.href}>Open</Link> : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunTable({ runs }: { runs: OpsRunLogRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[var(--font-size-sm)]">
        <thead className="text-[var(--muted-foreground)]">
          <tr>
            <th className="px-[var(--space-4)] py-[var(--space-2)]">Started</th>
            <th className="px-[var(--space-4)] py-[var(--space-2)]">Capability</th>
            <th className="px-[var(--space-4)] py-[var(--space-2)]">Scope</th>
            <th className="px-[var(--space-4)] py-[var(--space-2)]">Status</th>
            <th className="px-[var(--space-4)] py-[var(--space-2)]">Tokens</th>
            <th className="px-[var(--space-4)] py-[var(--space-2)]">Summary / error</th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 ? (
            <tr><td className="px-[var(--space-4)] py-[var(--space-3)] text-[var(--muted-foreground)]" colSpan={6}>No matching runs.</td></tr>
          ) : runs.map((run) => (
            <tr key={run.id} className="border-t border-[var(--border)] align-top">
              <td className="px-[var(--space-4)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">{fmtDate(run.startedAt)}</td>
              <td className="px-[var(--space-4)] py-[var(--space-2)]">
                {run.href ? <Link className="text-[var(--primary)] hover:underline" href={run.href}>{run.capability}</Link> : run.capability}
              </td>
              <td className="px-[var(--space-4)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">{run.scopePath}</td>
              <td className="px-[var(--space-4)] py-[var(--space-2)]">{run.status}</td>
              <td className="px-[var(--space-4)] py-[var(--space-2)] font-mono">{run.tokenSpend ?? "-"}</td>
              <td className="max-w-[520px] px-[var(--space-4)] py-[var(--space-2)] text-[var(--muted-foreground)]">{run.latestError || run.summary || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
