"use client";

import { useMemo, useState, useTransition } from "react";
import { useConfirm } from "@companyos/ui";
import { labelForConnectionStatus, labelForMemoryAccess, labelForRole } from "@/lib/labels";
import { RefreshCw, ShieldAlert, UserX } from "lucide-react";
import {
  listMcpConnectionsAction,
  revokePrincipalAccessAction,
  revokeScopeAccessAction,
} from "./actions";

interface AdminConnectionRow {
  tokenId: string;
  name: string;
  principalId: string;
  principalName: string;
  mintedBy: string;
  mintedByName: string;
  role: "agent" | "viewer";
  memoryAccess: "on";
  createdAt: string | Date;
  expiresAt: string | Date | null;
  lastUsedAt: string | Date | null;
  revoked: boolean;
  scopePath: string;
}

type DaysPreset = "all" | "7" | "30" | "90";
type ExpiryPreset = "all" | "7" | "30" | "90";

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function branchMatches(rowScopePath: string, filter: string): boolean {
  const scopePath = filter.trim();
  if (!scopePath || scopePath === "root") return true;
  return rowScopePath === scopePath || rowScopePath.startsWith(`${scopePath}/`);
}

function scopeSummary(paths: string[]): string {
  if (paths.length <= 4) return paths.join(", ");
  return `${paths.slice(0, 4).join(", ")} and ${paths.length - 4} more`;
}

export function McpManagerView({ initialConnections }: { initialConnections: AdminConnectionRow[] }) {
  const requestConfirm = useConfirm();
  const [connections, setConnections] = useState<AdminConnectionRow[]>(initialConnections);
  const [scopePath, setScopePath] = useState("");
  const [principalId, setPrincipalId] = useState("");
  const [selectedPrincipalId, setSelectedPrincipalId] = useState(initialConnections[0]?.principalId || "");
  const [activeWithinDays, setActiveWithinDays] = useState<DaysPreset>("all");
  const [expiringWithinDays, setExpiringWithinDays] = useState<ExpiryPreset>("all");
  const [showRevoked, setShowRevoked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const principalOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of connections) {
      map.set(row.principalId, row.principalName);
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [connections]);

  const visibleConnections = useMemo(() => {
    return connections.filter((row) => {
      if (!showRevoked && row.revoked) return false;
      if (scopePath.trim() && !branchMatches(row.scopePath, scopePath)) return false;
      if (principalId && row.principalId !== principalId) return false;
      return true;
    });
  }, [connections, principalId, scopePath, showRevoked]);

  const selectedPrincipalRows = useMemo(() => {
    if (!selectedPrincipalId) return [];
    return connections.filter((row) => row.principalId === selectedPrincipalId);
  }, [connections, selectedPrincipalId]);

  async function refresh() {
    setError(null);
    setMessage(null);
    const rows = await listMcpConnectionsAction({
      scopePath: scopePath.trim() || undefined,
      principalId: principalId || undefined,
      activeWithinDays: activeWithinDays === "all" ? undefined : Number(activeWithinDays),
      expiringWithinDays: expiringWithinDays === "all" ? undefined : Number(expiringWithinDays),
    });
    setConnections(rows as AdminConnectionRow[]);
    if (!selectedPrincipalId && rows[0]) {
      setSelectedPrincipalId(rows[0].principalId);
    }
  }

  function runRefresh() {
    startTransition(async () => {
      try {
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load connected apps. Refresh and try again.");
      }
    });
  }

  async function onRevokeScope() {
    const target = scopePath.trim() || "root";
    const blastRows = connections.filter((row) => !row.revoked && branchMatches(row.scopePath, target));
    const blastScopes = Array.from(new Set(blastRows.map((row) => row.scopePath))).sort();
    const text = `Revoke ${blastRows.length} active tokens across ${target}${blastScopes.length ? ` (${scopeSummary(blastScopes)})` : ""}?`;
    if (!(await requestConfirm({ title: "Revoke project tokens", body: text, confirmLabel: "Revoke tokens" }))) return;

    startTransition(async () => {
      try {
        setError(null);
        const result = await revokeScopeAccessAction(target);
        setMessage(`Revoked ${result.revokedCount} tokens across ${scopeSummary(result.scopePaths)}.`);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't revoke project tokens. Refresh and try again.");
      }
    });
  }

  async function onOffboardPrincipal() {
    if (!selectedPrincipalId) return;
    const personRows = connections.filter((row) => row.principalId === selectedPrincipalId && !row.revoked);
    const personName = connections.find((row) => row.principalId === selectedPrincipalId)?.principalName || selectedPrincipalId;
    const scopes = Array.from(new Set(personRows.map((row) => row.scopePath))).sort();
    if (!(await requestConfirm({
      title: "Offboard person or agent",
      body: `${personName} loses ${personRows.length} active worker tokens across ${scopeSummary(scopes)}.`,
      confirmLabel: "Offboard access",
    }))) {
      return;
    }

    startTransition(async () => {
      try {
        setError(null);
        const result = await revokePrincipalAccessAction(selectedPrincipalId);
        setMessage(`Revoked ${result.revokedCount} tokens for ${personName}.`);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't offboard access. Refresh and try again.");
      }
    });
  }

  return (
    <div className="space-y-[var(--space-4)]">
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <div className="mb-[var(--space-3)] flex flex-wrap items-end gap-[var(--space-3)]">
          <div className="min-w-64 flex-1">
            <label className="block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Project subtree</label>
            <input
              value={scopePath}
              onChange={(event) => setScopePath(event.target.value)}
              className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] text-[var(--font-size-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              placeholder="root or project/sub-project"
            />
          </div>

          <div>
            <label className="block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Person or agent</label>
            <select
              value={principalId}
              onChange={(event) => setPrincipalId(event.target.value)}
              className="h-10 min-w-56 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] text-[var(--font-size-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            >
              <option value="">All people and agents</option>
              {principalOptions.map((principal) => (
                <option key={principal.id} value={principal.id}>
                  {principal.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Active in</label>
            <select
              value={activeWithinDays}
              onChange={(event) => setActiveWithinDays(event.target.value as DaysPreset)}
              className="h-10 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] text-[var(--font-size-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            >
              <option value="all">Any time</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </div>

          <div>
            <label className="block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Expiring within</label>
            <select
              value={expiringWithinDays}
              onChange={(event) => setExpiringWithinDays(event.target.value as ExpiryPreset)}
              className="h-10 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] text-[var(--font-size-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            >
              <option value="all">Any time</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </div>

          <label className="flex h-10 items-center gap-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={showRevoked}
              onChange={(event) => setShowRevoked(event.target.checked)}
              className="h-4 w-4"
            />
            Show revoked
          </label>

          <button
            type="button"
            onClick={runRefresh}
            disabled={isPending}
            className="inline-flex h-10 items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] text-[var(--font-size-sm)] hover:bg-[var(--muted)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          >
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
          <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
            {isPending ? "Working…" : `${visibleConnections.length} connected apps visible`}
          </div>
          <button
            type="button"
            onClick={onRevokeScope}
            disabled={isPending}
            className="inline-flex h-9 items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--destructive)] px-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--destructive)] hover:bg-[var(--muted)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          >
            <ShieldAlert size={15} />
            Revoke project tokens
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-sm)] border border-[var(--destructive)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--destructive)]">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
          {message}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[1040px] text-left text-[var(--font-size-sm)]">
          <thead className="border-b border-[var(--border)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
            <tr>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Connected app</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Project path</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Person or agent</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Created by</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Role</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Memory access</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Expiry</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Last used</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleConnections.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-[var(--space-3)] py-[var(--space-4)] text-[var(--muted-foreground)]">
                  No connected apps match these filters.
                </td>
              </tr>
            ) : (
              visibleConnections.map((row) => (
                <tr key={row.tokenId} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="px-[var(--space-3)] py-[var(--space-2)]">
                    <div className="font-medium">{row.name}</div>
                    <div className="font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                      {formatDate(row.createdAt)}
                    </div>
                  </td>
                  <td className="px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">
                    {row.scopePath}
                  </td>
                  <td className="px-[var(--space-3)] py-[var(--space-2)]">{row.principalName}</td>
                  <td className="px-[var(--space-3)] py-[var(--space-2)]">{row.mintedByName}</td>
                  <td className="px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">
                    {labelForRole(row.role)}
                  </td>
                  <td className="px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">
                    {labelForMemoryAccess(row.memoryAccess)}
                  </td>
                  <td className="px-[var(--space-3)] py-[var(--space-2)] tabular-nums">{formatDate(row.expiresAt)}</td>
                  <td className="px-[var(--space-3)] py-[var(--space-2)] tabular-nums">{formatDate(row.lastUsedAt)}</td>
                  <td className="px-[var(--space-3)] py-[var(--space-2)]">{labelForConnectionStatus(row.revoked)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <div className="mb-[var(--space-3)] flex flex-wrap items-center justify-between gap-[var(--space-3)]">
          <div>
            <div className="text-[var(--font-size-sm)] font-medium">Per-person access</div>
            <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
              Access is read-only here, manage it in Admin Access.
            </div>
          </div>
        </div>

        <div className="mb-[var(--space-3)] flex flex-wrap items-end gap-[var(--space-3)]">
          <div>
            <label className="block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Person or agent</label>
            <select
              value={selectedPrincipalId}
              onChange={(event) => setSelectedPrincipalId(event.target.value)}
              className="h-10 min-w-72 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] text-[var(--font-size-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            >
              <option value="">Select person or agent</option>
              {principalOptions.map((principal) => (
                <option key={principal.id} value={principal.id}>
                  {principal.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={onOffboardPrincipal}
            disabled={!selectedPrincipalId || isPending}
            className="inline-flex h-10 items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--destructive)] px-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--destructive)] hover:bg-[var(--muted)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          >
            <UserX size={15} />
            Offboard
          </button>
        </div>

        {selectedPrincipalRows.length === 0 ? (
          <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No connected app access for this person or agent.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[var(--font-size-sm)]">
              <thead className="border-b border-[var(--border)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Project path</th>
                  <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Role</th>
                  <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Token</th>
                  <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {selectedPrincipalRows.map((row) => (
                  <tr key={row.tokenId} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">
                      {row.scopePath}
                    </td>
                    <td className="px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">
                      {labelForRole(row.role)}
                    </td>
                    <td className="px-[var(--space-3)] py-[var(--space-2)]">{row.name}</td>
                    <td className="px-[var(--space-3)] py-[var(--space-2)]">{labelForConnectionStatus(row.revoked)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
