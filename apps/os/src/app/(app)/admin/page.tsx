import Link from "next/link";
import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { labelForIntegrationState } from "@/lib/labels";
import { Card, EmptyState, StatCard } from "@companyos/ui";
import { Activity } from "lucide-react";

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
    { label: "Access", value: grants.length, href: "/admin/grants" },
    { label: "Automations", value: automations.length, href: "/admin/automations" },
    { label: "Alerts", value: alerts.length, href: "/admin/automations" },
  ];

  return (
    <div className="space-y-[var(--space-5)]">
      <div className="grid grid-cols-2 gap-[var(--space-3)] lg:grid-cols-4">
        {items.map((item) => (
          <StatCard key={item.label} label={item.label} value={item.value} href={item.href} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-2">
        <Card>
          <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Recent activity</div>
          <div className="space-y-[var(--space-2)]">
            {events.map((event) => (
              <div key={String(event.id)} className="border-t border-[var(--border)] pt-[var(--space-2)] first:border-t-0 first:pt-0">
                <div className="font-mono text-[var(--font-size-xs)]">{event.type}</div>
                <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{new Date(event.createdAt).toLocaleString()}</div>
              </div>
            ))}
            {events.length === 0 ? <EmptyState icon={<Activity size={16} />} title="No activity yet" body="Instance events will appear here as users and agents make changes." /> : null}
          </div>
        </Card>

        <Card>
          <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Instance settings</div>
          <dl className="grid grid-cols-[140px_1fr] gap-y-[var(--space-2)] text-[var(--font-size-sm)]">
            <dt className="text-[var(--muted-foreground)]">Instance</dt>
            <dd>{settings.instanceName}</dd>
            <dt className="text-[var(--muted-foreground)]">Skills repo</dt>
            <dd className="font-mono text-[var(--font-size-xs)]">{settings.skillsRepo ?? "-"}</dd>
            <dt className="text-[var(--muted-foreground)]">LiteLLM</dt>
            <dd>{labelForIntegrationState(settings.integrations.litellm)}</dd>
          </dl>
          <div className="mt-[var(--space-4)] flex flex-wrap gap-[var(--space-2)]">
            <Link href="/admin/settings" className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--muted)]">Settings</Link>
            <Link href="/admin/mcp" className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--muted)]">MCP usage</Link>
            <Link href="/admin/health" className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--muted)]">Health</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
