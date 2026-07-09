import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { labelForRole } from "@/lib/labels";
import { McpManagerView, UsageDashboardView } from "@/modules/mcp-manager";

function isRootAdmin(access: string | null): boolean {
  return access === "owner" || access === "admin";
}

export default async function McpAdminPage() {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) {
    return null;
  }

  const rootAccess = await api.resolveAccess(actor, "root");
  if (!isRootAdmin(rootAccess)) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <div className="text-[var(--font-size-sm)] font-medium">Not authorized</div>
        <div className="mt-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
          MCP connection management requires admin access for this instance.
        </div>
      </div>
    );
  }

  const [initialConnections, usage, recommendations, profile] = await Promise.all([
    api.listConnections({}, actor),
    api.queryUsage({ scope: "root", since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), groupBy: "operation", limit: 500 }, actor),
    api.usageRecommendations({ scopePath: "root", since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, actor),
    api.getContextProfile({ scopePath: "root" }, actor),
  ]);

  return (
    <div className="space-y-[var(--space-6)]">
      <div className="flex items-start justify-between gap-[var(--space-4)]">
        <div>
          <h1 className="text-[var(--font-size-2xl)] font-semibold tracking-[-0.01em]">MCP Manager</h1>
          <div className="mt-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            Agent connections across all projects: review, revoke, offboard.
          </div>
        </div>
        <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Role: {labelForRole(rootAccess)}</div>
      </div>

      <McpManagerView initialConnections={initialConnections} />
      <div className="border-t border-[var(--border)] pt-[var(--space-6)]">
        <div className="mb-[var(--space-4)]">
          <h2 className="text-[var(--font-size-xl)] font-semibold tracking-[-0.01em]">Usage</h2>
          <div className="mt-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            Estimated context tokens used by agents. Model-side token counts appear when clients report them.
          </div>
        </div>
        <UsageDashboardView initial={{ usage, recommendations, profile }} />
      </div>
    </div>
  );
}
