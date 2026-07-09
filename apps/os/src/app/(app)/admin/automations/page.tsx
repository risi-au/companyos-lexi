import Link from "next/link";
import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { Card, EmptyState, Table } from "@companyos/ui";
import { Activity, AlertTriangle } from "lucide-react";

export default async function AdminAutomationsPage() {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;
  const [automations, alerts] = await Promise.all([
    api.listAdminAutomations(actor),
    api.listAdminAlerts(actor),
  ]);
  return (
    <div className="space-y-[var(--space-4)]">
      <Card className="text-[var(--font-size-sm)] text-[var(--mutedfg)]">
        Automation runs and alerts. Usage is under <Link href="/admin/mcp" className="text-[var(--primary)]">MCP</Link>; uptime checks under <Link href="/admin/health" className="text-[var(--primary)]">Health</Link>.
      </Card>
      <Table
        rows={automations}
        minWidth="900px"
        getRowKey={(automation) => automation.id}
        empty={<EmptyState icon={<Activity size={16} />} title="No automations yet" body="Registered automations and scheduled runs appear here." />}
        columns={[
          { key: "capability", header: "Automation", cell: (automation) => automation.name },
          { key: "scope", header: "Project path", className: "font-mono text-[var(--font-size-xs)]", cell: (automation) => automation.scopePath },
          { key: "engine", header: "Engine", cell: (automation) => automation.engine },
          { key: "lastRun", header: "Last run", cell: (automation) => automation.lastRun ? new Date(automation.lastRun.startedAt).toLocaleString() : "-" },
          { key: "status", header: "Status", cell: (automation) => automation.lastRun?.status ?? automation.status },
        ]}
      />
      <Card>
        <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Recent alerts</div>
        <div className="space-y-[var(--space-2)]">
          {alerts.map((alert: { createdAt: Date; payload: unknown; scopePath: string | null }) => (
            <div key={`${alert.createdAt.toISOString()}-${JSON.stringify(alert.payload)}`} className="border-t border-[var(--border)] pt-[var(--space-2)] first:border-t-0 first:pt-0">
              <div className="font-mono text-[var(--font-size-xs)]">{String((alert.payload as Record<string, unknown>).severity ?? "info")} {String((alert.payload as Record<string, unknown>).capability ?? "")}</div>
              <div className="text-[var(--font-size-sm)]">{String((alert.payload as Record<string, unknown>).message ?? "")}</div>
              <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{alert.scopePath ?? "root"}, {new Date(alert.createdAt).toLocaleString()}</div>
            </div>
          ))}
          {alerts.length === 0 ? <EmptyState icon={<AlertTriangle size={16} />} title="No recent alerts" body="Automation alerts appear here when a run needs attention." /> : null}
        </div>
      </Card>
    </div>
  );
}
