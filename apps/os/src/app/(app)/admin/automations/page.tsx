import Link from "next/link";
import { api, getCurrentActorPrincipalId } from "@/lib/api";

export default async function AdminAutomationsPage() {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;
  const [automations, alerts] = await Promise.all([
    api.listAdminAutomations(actor),
    api.listAdminAlerts(actor),
  ]);
  return (
    <div className="space-y-[var(--space-4)]">
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
        Capability runs and alert events. MCP usage lives in <Link href="/admin/mcp" className="text-[var(--primary)]">MCP Manager</Link>; liveness checks live in <Link href="/admin/health" className="text-[var(--primary)]">Health</Link>.
      </div>
      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[900px] text-left text-[var(--font-size-sm)]">
          <thead className="border-b border-[var(--border)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
            <tr>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Capability</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Scope</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Engine</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Last run</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {automations.map((automation) => (
              <tr key={automation.id} className="border-b border-[var(--border)] last:border-b-0">
                <td className="px-[var(--space-3)] py-[var(--space-2)]">{automation.name}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">{automation.scopePath}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)]">{automation.engine}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)]">{automation.lastRun ? new Date(automation.lastRun.startedAt).toLocaleString() : "-"}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)]">{automation.lastRun?.status ?? automation.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Recent alerts</div>
        <div className="space-y-[var(--space-2)]">
          {alerts.map((alert: { createdAt: Date; payload: unknown; scopePath: string | null }) => (
            <div key={`${alert.createdAt.toISOString()}-${JSON.stringify(alert.payload)}`} className="border-t border-[var(--border)] pt-[var(--space-2)] first:border-t-0 first:pt-0">
              <div className="font-mono text-[var(--font-size-xs)]">{String((alert.payload as Record<string, unknown>).severity ?? "info")} {String((alert.payload as Record<string, unknown>).capability ?? "")}</div>
              <div className="text-[var(--font-size-sm)]">{String((alert.payload as Record<string, unknown>).message ?? "")}</div>
              <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{alert.scopePath ?? "root"} - {new Date(alert.createdAt).toLocaleString()}</div>
            </div>
          ))}
          {alerts.length === 0 ? <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No alerts.</div> : null}
        </div>
      </div>
    </div>
  );
}
