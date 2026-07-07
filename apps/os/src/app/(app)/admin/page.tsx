import Link from "next/link";
import { api, getCurrentActorPrincipalId } from "@/lib/api";

export default async function AdminOverviewPage() {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;
  const [users, grants, events, automations, alerts, settings] = await Promise.all([
    api.listAdminUsers(actor),
    api.listAdminGrants(actor),
    api.listAdminActivity({ limit: 8 }, actor),
    api.listAdminAutomations(actor),
    api.listAdminAlerts(actor),
    api.getAdminSettings(actor),
  ]);

  const items = [
    { label: "Users", value: users.length, href: "/admin/users" },
    { label: "Grants", value: grants.length, href: "/admin/grants" },
    { label: "Automations", value: automations.length, href: "/admin/automations" },
    { label: "Alerts", value: alerts.length, href: "/admin/automations" },
  ];

  return (
    <div className="space-y-[var(--space-5)]">
      <div className="grid grid-cols-2 gap-[var(--space-3)] lg:grid-cols-4">
        {items.map((item) => (
          <Link key={item.label} href={item.href} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] hover:bg-[var(--muted)]">
            <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{item.label}</div>
            <div className="mt-[var(--space-1)] font-mono text-[var(--font-size-2xl)]">{item.value}</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-2">
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
          <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Recent activity</div>
          <div className="space-y-[var(--space-2)]">
            {events.map((event) => (
              <div key={String(event.id)} className="border-t border-[var(--border)] pt-[var(--space-2)] first:border-t-0 first:pt-0">
                <div className="font-mono text-[var(--font-size-xs)]">{event.type}</div>
                <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{new Date(event.createdAt).toLocaleString()}</div>
              </div>
            ))}
            {events.length === 0 ? <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No activity.</div> : null}
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
          <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Instance settings</div>
          <dl className="grid grid-cols-[140px_1fr] gap-y-[var(--space-2)] text-[var(--font-size-sm)]">
            <dt className="text-[var(--muted-foreground)]">Instance</dt>
            <dd>{settings.instanceName}</dd>
            <dt className="text-[var(--muted-foreground)]">Skills repo</dt>
            <dd className="font-mono text-[var(--font-size-xs)]">{settings.skillsRepo ?? "-"}</dd>
            <dt className="text-[var(--muted-foreground)]">LiteLLM</dt>
            <dd>{settings.integrations.litellm ? "configured" : "not configured"}</dd>
          </dl>
          <div className="mt-[var(--space-4)] flex flex-wrap gap-[var(--space-2)]">
            <Link href="/admin/settings" className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--muted)]">Settings</Link>
            <Link href="/admin/mcp" className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--muted)]">MCP usage</Link>
            <Link href="/admin/health" className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--muted)]">Health</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
