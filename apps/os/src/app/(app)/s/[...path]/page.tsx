import { notFound, redirect } from "next/navigation";
import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { DashboardRenderer, DashboardEmptyState, RangePicker } from "@/modules/dashboards";
import { DocsView } from "@/modules/docs";
import { CanvasView } from "@/modules/canvas";
import { ConnectPanel } from "@/modules/connect";
import { WorkLogView } from "@/modules/worklog";
import { SessionsView } from "@/modules/sessions";
import { IntakePanel } from "@/modules/intake";
import { getDashboard } from "@companyos/api";
import { AskOSButton } from "@/modules/agent";
import { addMemberToScope, changeMemberRole, revokeMember } from "../../_components/actions";
// Consume spec contract (never fork schema); derive type from service surface for compile
type DashboardSpec = NonNullable<Awaited<ReturnType<typeof getDashboard>>>["spec"] & {
  version: 1;
  title: string;
  range: { default: "7d" | "30d" | "90d" };
  widgets: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
};

interface ScopePageProps {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<{ tab?: string; range?: string; doc?: string; canvas?: string; wizard?: string }>;
}

export default async function ScopePage({ params, searchParams }: ScopePageProps) {
  const { path: segments } = await params;
  const scopePath = segments?.join("/") || "root";
  const sp = await searchParams;
  const tabParam = sp.tab;
  const rangeParam = sp.range;
  const docParam = sp.doc;
  const canvasParam = sp.canvas;
  const wizardParam = sp.wizard;

  const actor = await getCurrentActorPrincipalId();
  if (!actor) {
    return null;
  }

  // For root: if no root grant, redirect to first visible project (grant-filtered nav)
  if (scopePath === "root") {
    const rootAccess = await api.resolveAccess(actor, "root");
    if (!rootAccess) {
      const visible = await api.getVisibleTree(actor);
      const first = visible.find((s: { type: string; path: string }) => s.type === "project");
      if (first) {
        redirect(`/s/${first.path}`);
      } else {
        notFound();
      }
    }
  }

  const scope = await api.getScope(scopePath);
  if (!scope) {
    notFound();
  }

  const access = await api.resolveAccess(actor, scopePath);
  if (!access) {
    notFound();
  }

  // Fetch dashboard early to decide default tab
  const dash = await api.getDashboard({ scopePath }, actor);
  const hasDashboard = !!dash;
  const currentTab = wizardParam ? "intake" : (tabParam || (hasDashboard ? "dashboard" : "overview"));
  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
  const currentRange = rangeParam || (dash && (dash.spec as any)?.range?.default) || "7d";

  // Shared data for overview (keep existing behavior)
  const records = await api.listRecords({ scopePath, limit: 8 }, actor);
  const tasks = await api.listTasks({ scopePath, state: "open", limit: 8 }, actor);
  const events = await api.listEvents({ scopePath, limit: 12 });

  // Build tab links preserving range when on dashboard; doc param for docs tab; canvas param
  const makeTabHref = (t: string) => {
    if (t === "dashboard") {
      return `/s/${scopePath}?tab=dashboard${currentRange ? `&range=${currentRange}` : ""}`;
    }
    if (t === "docs") {
      return `/s/${scopePath}?tab=docs${docParam ? `&doc=${encodeURIComponent(docParam)}` : ""}`;
    }
    if (t === "canvas") {
      return `/s/${scopePath}?tab=canvas${canvasParam ? `&canvas=${encodeURIComponent(canvasParam)}` : ""}`;
    }
    if (t === "members") {
      return `/s/${scopePath}?tab=members`;
    }
    if (t === "connect") {
      return `/s/${scopePath}?tab=connect`;
    }
    if (t === "intake") {
      return `/s/${scopePath}?tab=intake`;
    }
    return `/s/${scopePath}?tab=${t}`;
  };

  const isDashboard = currentTab === "dashboard";
  const isOverview = currentTab === "overview";
  const isActivity = currentTab === "activity";
  const isWorkLog = currentTab === "work-log";
  const isSessions = currentTab === "sessions";
  const isDocs = currentTab === "docs";
  const isCanvas = currentTab === "canvas";
  const isMembers = currentTab === "members";
  const isConnect = currentTab === "connect";
  const isIntake = currentTab === "intake";
  const canManageMembers = scope.type === "project" && ["owner", "admin"].includes(access);
  const workLogSince = new Date();
  workLogSince.setDate(workLogSince.getDate() - 30);
  const initialWorkLogRecords = isWorkLog
    ? await api.listRecords({ scopePath, includeDescendants: true, since: workLogSince, limit: 100 }, actor)
    : [];
  const initialSessions = isSessions
    ? await api.listSessions({ scopePath, includeDescendants: true }, actor)
    : [];
  const initialIntakes = isIntake
    ? await api.listIntakePackets({ scopePath, limit: 20 }, actor)
    : [];

  return (
    <div className="space-y-[var(--space-6)]">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-[var(--space-2)]">
            <h1 className="text-[var(--font-size-2xl)] font-semibold tracking-[-0.01em]">{scope.name}</h1>
            <span className="inline-block rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
              {scope.type === "project" ? "Project / Client" : scope.type === "subproject" ? "Sub-project" : scope.type}
            </span>
            <span className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">· {scope.status}</span>
          </div>
          <div className="mt-[var(--space-1)] flex items-center gap-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)] font-mono">
            {scope.path.split("/").map((seg: string, i: number, arr: string[]) => (
              <span key={i}>
                {seg}
                {i < arr.length - 1 ? <span className="mx-[var(--space-1)] text-[var(--border)]">/</span> : null}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-[var(--space-2)]">
          <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Role: {access}</div>
          <AskOSButton scopePath={scopePath} />
        </div>
      </div>

      {/* Tabs: Dashboard first when present */}
      <div className="border-b border-[var(--border)]">
        <div className="-mb-px flex gap-[var(--space-6)] text-[var(--font-size-sm)]">
          <a
            href={makeTabHref("dashboard")}
            className={`${isDashboard ? "border-b-2 border-[var(--primary)] font-medium text-[var(--primary)]" : "text-[var(--muted-foreground)]"} pb-[var(--space-2)]`}
          >
            Dashboard
          </a>
          <a
            href={makeTabHref("overview")}
            className={`${isOverview ? "border-b-2 border-[var(--primary)] font-medium text-[var(--primary)]" : "text-[var(--muted-foreground)]"} pb-[var(--space-2)]`}
          >
            Overview
          </a>
          <a
            href={makeTabHref("activity")}
            className={`${isActivity ? "border-b-2 border-[var(--primary)] font-medium text-[var(--primary)]" : "text-[var(--muted-foreground)]"} pb-[var(--space-2)]`}
          >
            Activity
          </a>
          <a
            href={makeTabHref("work-log")}
            className={`${isWorkLog ? "border-b-2 border-[var(--primary)] font-medium text-[var(--primary)]" : "text-[var(--muted-foreground)]"} pb-[var(--space-2)]`}
          >
            Work Log
          </a>
          <a
            href={makeTabHref("sessions")}
            className={`${isSessions ? "border-b-2 border-[var(--primary)] font-medium text-[var(--primary)]" : "text-[var(--muted-foreground)]"} pb-[var(--space-2)]`}
          >
            Sessions
          </a>
          <a
            href={makeTabHref("docs")}
            className={`${isDocs ? "border-b-2 border-[var(--primary)] font-medium text-[var(--primary)]" : "text-[var(--muted-foreground)]"} pb-[var(--space-2)]`}
          >
            Docs
          </a>
          <a
            href={makeTabHref("canvas")}
            className={`${isCanvas ? "border-b-2 border-[var(--primary)] font-medium text-[var(--primary)]" : "text-[var(--muted-foreground)]"} pb-[var(--space-2)]`}
          >
            Canvas
          </a>
          <a
            href={makeTabHref("connect")}
            className={`${isConnect ? "border-b-2 border-[var(--primary)] font-medium text-[var(--primary)]" : "text-[var(--muted-foreground)]"} pb-[var(--space-2)]`}
          >
            Connect
          </a>
          <a
            href={makeTabHref("intake")}
            className={`${isIntake ? "border-b-2 border-[var(--primary)] font-medium text-[var(--primary)]" : "text-[var(--muted-foreground)]"} pb-[var(--space-2)]`}
          >
            Intake
          </a>
          {canManageMembers && (
            <a
              href={makeTabHref("members")}
              className={`${isMembers ? "border-b-2 border-[var(--primary)] font-medium text-[var(--primary)]" : "text-[var(--muted-foreground)]"} pb-[var(--space-2)]`}
            >
              Members
            </a>
          )}
        </div>
      </div>

      {/* Dashboard tab */}
      {isDashboard && (
        <div className="space-y-[var(--space-4)]">
          <div className="flex items-center justify-between">
            <div className="text-[var(--font-size-sm)] font-medium text-[var(--muted-foreground)]">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {dash ? (dash.spec as any)?.title || "Dashboard" : "Dashboard"}
            </div>
            <RangePicker scopePath={scopePath} currentRange={currentRange} />
          </div>

          {!hasDashboard ? (
            <DashboardEmptyState scopePath={scopePath} />
          ) : (
            <DashboardRenderer
              spec={dash!.spec as DashboardSpec}
              scopePath={scopePath}
              actor={actor}
              rangeKey={currentRange}
            />
          )}
        </div>
      )}

      {/* Overview (existing cards) */}
      {isOverview && (
        <div className="grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-2">
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
            <div className="mb-[var(--space-3)] flex items-center justify-between">
              <div className="text-[var(--font-size-sm)] font-medium">Recent records</div>
              <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">read-only</div>
            </div>
            {records.length === 0 ? (
              <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No records yet.</div>
            ) : (
              <ul className="space-y-[var(--space-2)]">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {records.map((r: any) => (
                  <li key={r.id} className="flex items-center justify-between rounded border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]">
                    <div>
                      <span className="mr-2 inline text-[var(--font-size-xs)] rounded bg-[var(--muted)] px-[var(--space-1)] py-px text-[var(--muted-foreground)]">{r.kind}</span>
                      <span className="font-medium">{r.title}</span>
                    </div>
                    <span className="text-[var(--font-size-xs)] text-[var(--muted-foreground)] tabular-nums">
                      {new Date(String(r.createdAt)).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
            <div className="mb-[var(--space-3)] flex items-center justify-between">
              <div className="text-[var(--font-size-sm)] font-medium">Open tasks</div>
              <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">via Plane</div>
            </div>
            {tasks.length === 0 ? (
              <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
                {process.env.PLANE_API_TOKEN ? "No open tasks." : "Plane not configured — tasks hidden."}
              </div>
            ) : (
              <ul className="space-y-[var(--space-2)]">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {tasks.map((t: any, idx: number) => (
                  <li key={t.id || idx} className="rounded border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]">
                    <div className="font-medium">{t.title || t.name}</div>
                    {t.url && <a href={t.url} target="_blank" className="text-[var(--font-size-xs)] text-[var(--primary)]">open ↗</a>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Activity */}
      {isActivity && (
        <div>
          <div className="mb-[var(--space-2)] text-[var(--font-size-sm)] font-medium">Activity</div>
          {events.length === 0 ? (
            <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No events.</div>
          ) : (
            <ol className="space-y-[var(--space-3)] border-l border-[var(--border)] pl-[var(--space-4)] text-[var(--font-size-sm)]">
              { }
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {events.map((ev: any) => (
                <li key={ev.id} className="relative">
                  <div className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-[var(--muted-foreground)]" />
                  <div className="text-[var(--muted-foreground)] tabular-nums">
                    {new Date(ev.createdAt).toISOString().slice(0, 16).replace("T", " ")}
                  </div>
                  <div>
                    <span className="font-mono text-[var(--font-size-xs)]">{ev.type}</span>
                    {ev.payload && Object.keys(ev.payload).length > 0 && (
                      <span className="ml-2 text-[var(--muted-foreground)]">{JSON.stringify(ev.payload)}</span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* Work Log tab (M6-08) */}
      {isWorkLog && (
        <WorkLogView scopePath={scopePath} initialRecords={initialWorkLogRecords} />
      )}

      {/* Sessions tab (M6-07) */}
      {isSessions && (
        <SessionsView scopePath={scopePath} initialSessions={initialSessions} />
      )}

      {/* Docs tab (M3-02) */}
      {isDocs && (
        <DocsView scopePath={scopePath} initialDocSlug={docParam} initialAccess={access} />
      )}

      {/* Canvas tab (M3-03) */}
      {isCanvas && (
        <CanvasView scopePath={scopePath} initialCanvasSlug={canvasParam} initialAccess={access} />
      )}

      {/* Connect to MCP tab (M6-02) */}
      {isConnect && (
        <ConnectPanel
          scopePath={scopePath}
          initialAccess={access}
        />
      )}

      {isIntake && (
        <IntakePanel
          scopePath={scopePath}
          initialIntakes={initialIntakes}
          initialOpenId={wizardParam}
          access={access}
        />
      )}

      {/* Members tab (M4-01) - only for top-level projects to root/project admins */}
      {isMembers && canManageMembers && (
        <MembersTab scopePath={scopePath} actor={actor} />
      )}

      {/* Overview + Activity legacy combined when not dashboard (keep full original layout for overview+activity non-tabbed fallback if any) */}
      {!isDashboard && !isOverview && !isActivity && !isWorkLog && !isSessions && !isDocs && !isCanvas && !isConnect && !isIntake && (
        <div className="space-y-[var(--space-4)]">
          <div className="grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-2">
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
              <div className="mb-[var(--space-3)] flex items-center justify-between">
                <div className="text-[var(--font-size-sm)] font-medium">Recent records</div>
                <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">read-only</div>
              </div>
              {records.length === 0 ? (
                <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No records yet.</div>
              ) : (
                <ul className="space-y-[var(--space-2)]">
                  { }
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {records.map((r: any) => (
                    <li key={r.id} className="flex items-center justify-between rounded border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]">
                      <div>
                        <span className="mr-2 inline text-[var(--font-size-xs)] rounded bg-[var(--muted)] px-[var(--space-1)] py-px text-[var(--muted-foreground)]">{r.kind}</span>
                        <span className="font-medium">{r.title}</span>
                      </div>
                      <span className="text-[var(--font-size-xs)] text-[var(--muted-foreground)] tabular-nums">
                        {new Date(String(r.createdAt)).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
              <div className="mb-[var(--space-3)] flex items-center justify-between">
                <div className="text-[var(--font-size-sm)] font-medium">Open tasks</div>
                <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">via Plane</div>
              </div>
              {tasks.length === 0 ? (
                <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
                  {process.env.PLANE_API_TOKEN ? "No open tasks." : "Plane not configured — tasks hidden."}
                </div>
              ) : (
                <ul className="space-y-[var(--space-2)]">
                  { }
                  { }
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {tasks.map((t: any, idx: number) => (
                    <li key={t.id || idx} className="rounded border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]">
                      <div className="font-medium">{t.title || t.name}</div>
                      {t.url && <a href={t.url} target="_blank" className="text-[var(--font-size-xs)] text-[var(--primary)]">open ↗</a>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div>
            <div className="mb-[var(--space-2)] text-[var(--font-size-sm)] font-medium">Activity</div>
            {events.length === 0 ? (
              <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No events.</div>
            ) : (
              <ol className="space-y-[var(--space-3)] border-l border-[var(--border)] pl-[var(--space-4)] text-[var(--font-size-sm)]">
                { }
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {events.map((ev: any) => (
                  <li key={ev.id} className="relative">
                    <div className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-[var(--muted-foreground)]" />
                    <div className="text-[var(--muted-foreground)] tabular-nums">
                      {new Date(ev.createdAt).toISOString().slice(0, 16).replace("T", " ")}
                    </div>
                    <div>
                      <span className="font-mono text-[var(--font-size-xs)]">{ev.type}</span>
                      {ev.payload && Object.keys(ev.payload).length > 0 && (
                        <span className="ml-2 text-[var(--muted-foreground)]">{JSON.stringify(ev.payload)}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Members management UI for project admins/root admins */
async function MembersTab({ scopePath, actor }: { scopePath: string; actor: string }) {
  const grants = await api.listGrants(scopePath, actor);

  return (
    <div className="space-y-[var(--space-4)]">
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Project members (grants on this scope)</div>

        {grants.length === 0 ? (
          <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No direct grants on this scope.</div>
        ) : (
          <table className="w-full text-[var(--font-size-sm)]">
            <thead>
              <tr className="text-left text-[var(--muted-foreground)]">
                <th className="pb-2">Name</th>
                <th className="pb-2">Email</th>
                <th className="pb-2">Role</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g: { grantId: string; principalId: string; principalName: string; principalEmail: string | null; role: string }) => (
                <tr key={g.grantId} className="border-t border-[var(--border)]">
                  <td className="py-[var(--space-2)]">{g.principalName}</td>
                  <td className="py-[var(--space-2)] text-[var(--muted-foreground)]">{g.principalEmail || "—"}</td>
                  <td className="py-[var(--space-2)]">
                    <form action={changeMemberRole} className="inline-flex gap-1">
                      <input type="hidden" name="scopePath" value={scopePath} />
                      <input type="hidden" name="principalId" value={g.principalId} />
                      <select name="role" defaultValue={g.role} className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-xs">
                        <option value="owner">owner</option>
                        <option value="admin">admin</option>
                        <option value="editor">editor</option>
                        <option value="viewer">viewer</option>
                        <option value="agent">agent</option>
                      </select>
                      <button type="submit" className="rounded border border-[var(--border)] px-2 py-0.5 text-xs hover:bg-[var(--muted)]">Save</button>
                    </form>
                  </td>
                  <td className="py-[var(--space-2)]">
                    <form action={revokeMember} className="inline">
                      <input type="hidden" name="scopePath" value={scopePath} />
                      <input type="hidden" name="principalId" value={g.principalId} />
                      <button type="submit" className="rounded border border-[var(--destructive)] px-2 py-0.5 text-xs text-[var(--destructive)] hover:bg-[var(--muted)]">Revoke</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Add member (existing user by email; default editor)</div>
        <form action={addMemberToScope} className="flex flex-wrap gap-[var(--space-2)] items-end">
          <input type="hidden" name="scopePath" value={scopePath} />
          <div>
            <label className="block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Email</label>
            <input name="email" type="email" required className="w-64 rounded border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] py-1 text-sm" placeholder="user@example.com" />
          </div>
          <div>
            <label className="block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Role</label>
            <select name="role" defaultValue="editor" className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm">
              <option value="owner">owner</option>
              <option value="admin">admin</option>
              <option value="editor">editor (default)</option>
              <option value="viewer">viewer</option>
              <option value="agent">agent</option>
            </select>
          </div>
          <button type="submit" className="rounded bg-[var(--primary)] px-3 py-1 text-sm text-[var(--primary-foreground)]">Add member</button>
        </form>
        <p className="mt-2 text-[var(--font-size-xs)] text-[var(--muted-foreground)]">User must already have signed up (auth principal exists).</p>
      </div>
    </div>
  );
}
