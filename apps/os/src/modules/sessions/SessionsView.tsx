"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { listSessionsAction } from "./actions";

type SessionStatus = "running" | "waiting" | "idle" | "completed" | "error";
type StatusFilter = SessionStatus | "all";

interface SessionRow {
  id: string;
  scopePath: string;
  title: string;
  engine: string;
  model: string | null;
  status: SessionStatus;
  stale: boolean;
  worktreeRef: string | null;
  lastHeartbeat: Date | string;
}

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "running", label: "Running" },
  { value: "waiting", label: "Waiting" },
  { value: "idle", label: "Idle" },
  { value: "completed", label: "Completed" },
  { value: "error", label: "Error" },
];

function ageLabel(value: Date | string): string {
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function statusClass(status: SessionStatus): string {
  if (status === "running") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (status === "waiting") return "border-amber-300 bg-amber-50 text-amber-700";
  if (status === "error") return "border-red-300 bg-red-50 text-red-700";
  if (status === "completed") return "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]";
  return "border-sky-300 bg-sky-50 text-sky-700";
}

export function SessionsView({
  scopePath,
  initialSessions,
}: {
  scopePath: string;
  initialSessions: SessionRow[];
}) {
  const [sessions, setSessions] = useState<SessionRow[]>(initialSessions);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [scopeFilter, setScopeFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      try {
        setError(null);
        const next = await listSessionsAction({
          scopePath,
          status,
          includeDescendants: true,
        });
        setSessions(next as SessionRow[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load sessions");
      }
    });
  }, [scopePath, status]);

  const visibleSessions = useMemo(() => {
    const needle = scopeFilter.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((session) => session.scopePath.toLowerCase().includes(needle));
  }, [sessions, scopeFilter]);

  return (
    <div className="space-y-[var(--space-4)]">
      <div className="flex flex-wrap items-end gap-[var(--space-3)]">
        <div>
          <label className="block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Status</label>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            className="h-10 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] text-[var(--font-size-sm)]"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-64 flex-1">
          <label className="block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Scope path</label>
          <input
            value={scopeFilter}
            onChange={(event) => setScopeFilter(event.target.value)}
            className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] text-[var(--font-size-sm)]"
            placeholder="Filter by client/sub-scope"
          />
        </div>

        <div className="pb-[var(--space-2)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
          {isPending ? "Loading..." : `${visibleSessions.length} sessions`}
        </div>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-sm)] border border-[var(--destructive)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--destructive)]">
          {error}
        </div>
      ) : null}

      {visibleSessions.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
          No sessions match these filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-left text-[var(--font-size-sm)]">
            <thead className="border-b border-[var(--border)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
              <tr>
                <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Scope</th>
                <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Title</th>
                <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Engine</th>
                <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Status</th>
                <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Age</th>
                <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Worktree</th>
              </tr>
            </thead>
            <tbody>
              {visibleSessions.map((session) => (
                <tr key={session.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="max-w-xs px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                    {session.scopePath}
                  </td>
                  <td className="px-[var(--space-3)] py-[var(--space-2)] font-medium">{session.title}</td>
                  <td className="px-[var(--space-3)] py-[var(--space-2)]">
                    <div>{session.engine}</div>
                    {session.model ? (
                      <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{session.model}</div>
                    ) : null}
                  </td>
                  <td className="px-[var(--space-3)] py-[var(--space-2)]">
                    <div className="flex flex-wrap gap-[var(--space-1)]">
                      <span className={`inline-flex rounded-[var(--radius-sm)] border px-[var(--space-2)] py-px text-[var(--font-size-xs)] ${statusClass(session.status)}`}>
                        {session.status}
                      </span>
                      {session.stale ? (
                        <span className="inline-flex rounded-[var(--radius-sm)] border border-red-300 bg-red-50 px-[var(--space-2)] py-px text-[var(--font-size-xs)] text-red-700">
                          stale
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-xs)] text-[var(--muted-foreground)] tabular-nums">
                    {ageLabel(session.lastHeartbeat)}
                  </td>
                  <td className="max-w-sm px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                    {session.worktreeRef || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
