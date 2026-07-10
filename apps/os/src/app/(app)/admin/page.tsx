import Link from "next/link";
import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { labelForEventType, labelForIntegrationState } from "@/lib/labels";
import { Card, EmptyState, StatCard } from "@companyos/ui";
import { Activity } from "lucide-react";

function plural(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}


function payloadPath(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const value = record.scopePath ?? record.path;
  return typeof value === "string" && value ? value : null;
}
function statusTone(configured: boolean) {
  return configured
    ? "bg-[var(--okbg)] text-[var(--ok)]"
    : "bg-[var(--muted)] text-[var(--mutedfg)]";
}

function IntegrationRow({ name, detail, configured }: { name: string; detail?: string; configured: boolean }) {
  return (
    <div className="flex items-center gap-[12px] border-b border-[var(--border)] py-[11px] last:border-b-0">
      <span className="flex-1 text-[13px] font-medium text-[var(--fg)]">
        {name}
        {detail ? <span className="text-[11.5px] font-normal text-[var(--mutedfg)]"> · {detail}</span> : null}
      </span>
      <span className={`inline-flex items-center gap-[6px] rounded-full px-[9px] py-[3px] text-[12px] font-medium ${statusTone(configured)}`}>
        {configured ? <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-current" /> : null}
        {labelForIntegrationState(configured)}
      </span>
    </div>
  );
}

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

  const agentGrants = grants.filter((grant) => grant.role === "agent").length;
  const scopedGrantCount = new Set(grants.map((grant) => grant.scopePath).filter((path) => path !== "root")).size;
  const activeAutomations = automations.filter((automation) => automation.status === "active").length;
  const connectedIntegrations = Object.values(settings.integrations).filter(Boolean).length;

  const items = [
    { label: "Users", value: users.length, subline: `${plural(users.length, "person")} · ${plural(agentGrants, "agent")}`, href: "/admin/users" },
    { label: "Access", value: grants.length, subline: `${plural(scopedGrantCount, "scope")} covered`, href: "/admin/grants" },
    { label: "Automations", value: automations.length, subline: `${plural(activeAutomations, "active runbook")}`, href: "/admin/automations" },
    { label: "Alerts", value: alerts.length, subline: alerts.length === 0 ? "No degraded components" : `${plural(alerts.length, "component")} degraded`, href: "/admin/automations" },
  ];

  return (
    <div className="space-y-[var(--space-5)]">
      <div className="grid grid-cols-2 gap-[var(--space-3)] lg:grid-cols-4">
        {items.map((item) => (
          <StatCard key={item.label} label={item.label} value={item.value} subline={item.subline} href={item.href} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-2">
        <Card>
          <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Recent activity</div>
          <div className="space-y-[var(--space-2)]">
            {events.map((event) => {
              const scopePath = payloadPath(event.payload);
              return (
                <div key={String(event.id)} className="border-t border-[var(--border)] pt-[var(--space-2)] first:border-t-0 first:pt-0">
                  <div className="text-[var(--font-size-sm)] font-medium text-[var(--fg)]">
                    {labelForEventType(event.type)}
                    {scopePath ? <span className="ml-[6px] font-mono text-[var(--font-size-xs)] font-normal text-[var(--mutedfg)]">{scopePath}</span> : null}
                  </div>
                  <div className="text-[var(--font-size-xs)] text-[var(--mutedfg)]">{new Date(event.createdAt).toLocaleString()}</div>
                </div>
              );
            })}
            {events.length === 0 ? <EmptyState icon={<Activity size={16} />} title="No activity yet" body="Instance events will appear here as users and agents make changes." /> : null}
          </div>
        </Card>

        <Card>
          <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Integrations</div>
          <div className="flex flex-col">
            <IntegrationRow name="Tasks" detail="Plane" configured={settings.integrations.plane} />
            <IntegrationRow name="GitHub" configured={settings.integrations.github} />
            <IntegrationRow name="LiteLLM" configured={settings.integrations.litellm} />
            <IntegrationRow name="n8n" configured={settings.integrations.n8n} />
            <IntegrationRow name="Flowise" configured={settings.integrations.flowise} />
          </div>
          <div className="mt-[var(--space-3)] text-[var(--font-size-xs)] text-[var(--mutedfg)]">
            {connectedIntegrations} of 5 connected
          </div>
        </Card>

        <Card>
          <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Instance settings</div>
          <dl className="grid grid-cols-[140px_1fr] gap-y-[var(--space-2)] text-[var(--font-size-sm)]">
            <dt className="text-[var(--mutedfg)]">Instance</dt>
            <dd>{settings.instanceName}</dd>
            <dt className="text-[var(--mutedfg)]">Skills repo</dt>
            <dd className="font-mono text-[var(--font-size-xs)]">{settings.skillsRepo ?? "-"}</dd>
            <dt className="text-[var(--mutedfg)]">LiteLLM</dt>
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

