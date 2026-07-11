import { notFound } from "next/navigation";
import Link from "next/link";
import { Activity, AlertTriangle, CheckCircle2, CircleHelp, XCircle } from "lucide-react";
import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { labelForHealthStatus } from "@/lib/labels";
import { opsHealthDeps, opsHealthEnvironment } from "@/lib/ops-health";
import type { HealthStatus, OpsHealthCheck, OpsRunLogRow, WikiContributionDay } from "@companyos/api";
import { EmptyState, Table } from "@companyos/ui";

function isRootAdmin(role: string | null): boolean {
  return role === "owner" || role === "admin";
}

function fmtDate(value: Date | string | null) {
  if (!value) return "-";
  return new Date(value).toISOString().slice(0, 16).replace("T", " ");
}

function statusClass(status: HealthStatus): string {
  if (status === "ok") return "text-[var(--ok)]";
  if (status === "warning") return "text-[var(--warn)]";
  if (status === "error") return "text-[var(--err)]";
  return "text-[var(--mutedfg)]";
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
            Is everything running? Credentials, jobs, webhooks, alerts.
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
        <div className="border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)] text-[var(--font-size-sm)] font-medium">
          Wiki contributions (14d)
        </div>
        <WikiContributionsTable rows={health.wikiContributions} />
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
    <Table
      rows={checks}
      minWidth="980px"
      getRowKey={(check) => check.key}
      empty={<EmptyState icon={<Activity size={16} />} title="No health checks" body="Health checks will appear here after the first run." />}
      columns={[
        {
          key: "component",
          header: "Component",
          cell: (check) => (
            <>
              <div className="font-medium">{check.component}</div>
              <div className="mt-px text-[var(--font-size-xs)] text-[var(--mutedfg)]">{check.detail}</div>
            </>
          ),
        },
        {
          key: "status",
          header: "Status",
          cell: (check) => (
            <div className="inline-flex items-center gap-[var(--space-1)]">
              <StatusIcon status={check.status} />
              <span className={statusClass(check.status)}>{labelForHealthStatus(check.status)}</span>
            </div>
          ),
        },
        { key: "last", header: "Last activity", className: "font-mono text-[var(--font-size-xs)]", cell: (check) => fmtDate(check.lastActivityAt) },
        { key: "expiry", header: "Next expected", className: "font-mono text-[var(--font-size-xs)]", cell: (check) => fmtDate(check.expiryAt || check.nextExpectedAt) },
        { key: "error", header: "Latest error", className: "max-w-[360px] text-[var(--mutedfg)]", cell: (check) => check.latestError || "-" },
        { key: "drill", header: "Drill-down", cell: (check) => check.href ? <Link className="text-[var(--primary)] hover:underline" href={check.href}>Open</Link> : "-" },
      ]}
    />
  );
}


function WikiContributionsTable({ rows }: { rows: WikiContributionDay[] }) {
  const hasActivity = rows.some((row) => row.saves > 0 || row.verifies > 0);
  if (!hasActivity) {
    return <div className="px-[var(--space-4)] py-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--mutedfg)]">No wiki activity yet.</div>;
  }
  return (
    <Table
      rows={rows}
      minWidth="420px"
      getRowKey={(row) => row.date}
      columns={[
        { key: "date", header: "Date", className: "font-mono text-[var(--font-size-xs)]", cell: (row) => row.date },
        { key: "saves", header: "Saves", className: "font-mono", cell: (row) => row.saves },
        { key: "verifies", header: "Verifies", className: "font-mono", cell: (row) => row.verifies },
      ]}
    />
  );
}
function RunTable({ runs }: { runs: OpsRunLogRow[] }) {
  return (
    <Table
      rows={runs}
      minWidth="920px"
      getRowKey={(run) => run.id}
      empty={<EmptyState icon={<Activity size={16} />} title="No matching runs" body="Run logs matching this filter will appear after capabilities report activity." />}
      columns={[
        { key: "started", header: "Started", className: "font-mono text-[var(--font-size-xs)]", cell: (run) => fmtDate(run.startedAt) },
        { key: "capability", header: "Automation", cell: (run) => run.href ? <Link className="text-[var(--primary)] hover:underline" href={run.href}>{run.capability}</Link> : run.capability },
        { key: "scope", header: "Project path", className: "font-mono text-[var(--font-size-xs)]", cell: (run) => run.scopePath },
        { key: "status", header: "Status", cell: (run) => run.status },
        { key: "tokens", header: "Tokens", className: "font-mono", cell: (run) => run.tokenSpend ?? "-" },
        { key: "summary", header: "Result", className: "max-w-[520px] text-[var(--mutedfg)]", cell: (run) => run.latestError || run.summary || "-" },
      ]}
    />
  );
}
