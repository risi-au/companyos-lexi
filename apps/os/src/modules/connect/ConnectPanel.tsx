"use client";

import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "@companyos/ui";
import { labelForConnectionStatus, labelForMemoryAccess, labelForRole } from "@/lib/labels";
import { CalendarClock, Check, Link2, PlugZap, RefreshCw, Shield, Trash2, X } from "lucide-react";
import {
  getConnectConfigAction,
  listConnectionTokensAction,
  listOAuthConnectionsAction,
  revokeConnectionTokenAction,
  updateConnectionTokenExpiryAction,
} from "./actions";
import { ConnectWizard } from "./ConnectWizard";

type AccessRole = "owner" | "admin" | "editor" | "agent" | "viewer" | string;

interface ConnectionRow {
  tokenId: string;
  name: string;
  principalName: string;
  mintedByName: string;
  role: "agent" | "viewer";
  memoryAccess: "on";
  createdAt: string | Date;
  expiresAt: string | Date | null;
  lastUsedAt: string | Date | null;
  revoked: boolean;
  status: "active" | "expired" | "revoked" | "never_used";
  canRevoke: boolean;
}

interface OAuthConnectionRow {
  oauthClientId: string;
  clientName: string | null;
  principalId: string;
  firstUsedAt: string | Date;
  lastUsedAt: string | Date;
}

function canMint(access: AccessRole | null): boolean {
  return access === "owner" || access === "admin" || access === "editor" || access === "agent";
}

function canRevoke(access: AccessRole | null, row: ConnectionRow): boolean {
  if (access === "owner" || access === "admin") return true;
  if (access === "editor" || access === "agent") return row.canRevoke;
  return false;
}

// Editing a token's expiry can extend its life, so it is admin-only (stricter than revoke).
function canEditExpiry(access: AccessRole | null): boolean {
  return access === "owner" || access === "admin";
}

function formatDate(value: string | Date | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "-";
}

// Format a stored expiry into a <input type="datetime-local"> value (local time).
function toDatetimeLocal(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusClassName(status: ConnectionRow["status"]): string {
  if (status === "expired" || status === "revoked") return "text-[var(--destructive)]";
  if (status === "never_used") return "text-[var(--muted-foreground)]";
  return "";
}

export function ConnectPanel({ scopePath, initialAccess }: { scopePath: string; initialAccess: AccessRole | null }) {
  const requestConfirm = useConfirm();
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [oauthConnections, setOauthConnections] = useState<OAuthConnectionRow[]>([]);
  const [mcpUrl, setMcpUrl] = useState("<MCP_PUBLIC_URL>");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingExpiryTokenId, setEditingExpiryTokenId] = useState<string | null>(null);
  const [expiryDraft, setExpiryDraft] = useState("");
  const [savingExpiry, setSavingExpiry] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [config, rows, oauthRows] = await Promise.all([getConnectConfigAction(), listConnectionTokensAction(scopePath), listOAuthConnectionsAction()]);
      setMcpUrl(config.mcpPublicUrl || "<MCP_PUBLIC_URL>");
      setConnections(rows as ConnectionRow[]);
      setOauthConnections(oauthRows as OAuthConnectionRow[]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load worker tokens. Refresh and try again.");
      setConnections([]);
      setOauthConnections([]);
    } finally {
      setLoading(false);
    }
  }, [scopePath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onRevoke(tokenId: string) {
    const confirmed = await requestConfirm({
      title: "Revoke token",
      body: "This worker token stops working immediately. Existing records stay in the audit log.",
      confirmLabel: "Revoke token",
    });
    if (!confirmed) return;
    setError(null);
    try {
      await revokeConnectionTokenAction(scopePath, tokenId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't revoke the token. Refresh and try again.");
    }
  }

  function startEditExpiry(row: ConnectionRow) {
    setError(null);
    setEditingExpiryTokenId(row.tokenId);
    setExpiryDraft(toDatetimeLocal(row.expiresAt));
  }

  function cancelEditExpiry() {
    setEditingExpiryTokenId(null);
    setExpiryDraft("");
  }

  async function onSaveExpiry(tokenId: string, expiresAt: string | null) {
    setSavingExpiry(true);
    setError(null);
    try {
      await updateConnectionTokenExpiryAction(scopePath, tokenId, expiresAt);
      cancelEditExpiry();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't update the token expiry. Refresh and try again.");
    } finally {
      setSavingExpiry(false);
    }
  }

  return (
    <div className="space-y-[var(--space-4)]">
      <ConnectWizard scopePath={scopePath} mcpUrl={mcpUrl} canMint={canMint(initialAccess)} onTokensChanged={refresh} />

      {!loading && (oauthConnections.length === 0 ? (
        <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No apps connected via OAuth yet.</div>
      ) : (
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
          <div className="mb-[var(--space-3)] flex items-center gap-[var(--space-2)]">
            <Link2 size={18} />
            <div>
              <div className="text-[var(--font-size-sm)] font-medium">Connected apps</div>
              <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Apps connected to your account via OAuth</div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-[var(--font-size-sm)]">
              <thead className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                <tr><th className="pb-[var(--space-2)] font-medium">App</th><th className="pb-[var(--space-2)] font-medium">First used</th><th className="pb-[var(--space-2)] font-medium">Last seen</th></tr>
              </thead>
              <tbody>
                {oauthConnections.map((row) => (
                  <tr key={row.oauthClientId} className="border-t border-[var(--border)]">
                    <td className="py-[var(--space-2)]">{row.clientName !== null ? <span className="font-medium">{row.clientName}</span> : <span className="font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{row.oauthClientId}</span>}</td>
                    <td className="py-[var(--space-2)] tabular-nums">{formatDate(row.firstUsedAt)}</td>
                    <td className="py-[var(--space-2)] tabular-nums">{formatDate(row.lastUsedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <div className="mb-[var(--space-3)] flex flex-wrap items-center justify-between gap-[var(--space-3)]">
          <div className="flex items-center gap-[var(--space-2)]">
            <PlugZap size={18} />
            <div>
              <div className="text-[var(--font-size-sm)] font-medium">Worker tokens in this project</div>
              <div className="font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Fallback tokens for headless workers - {mcpUrl}</div>
            </div>
          </div>
          <button type="button" aria-label="Refresh worker tokens" title="Refresh worker tokens" onClick={() => void refresh()} className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]">
            <RefreshCw size={15} />
          </button>
        </div>

        {error && <div className="mb-[var(--space-3)] rounded-[var(--radius-sm)] border border-[var(--destructive)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--destructive)]">{error}</div>}
        {!canMint(initialAccess) && <div className="mb-[var(--space-3)] flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]"><Shield size={15} />Viewers can see worker tokens but can't create tokens.</div>}

        {loading ? (
          <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">Loading worker tokens...</div>
        ) : connections.length === 0 ? (
          <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No worker tokens created for this project.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-[var(--font-size-sm)]">
              <thead className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                <tr><th className="pb-[var(--space-2)] font-medium">Name</th><th className="pb-[var(--space-2)] font-medium">Created by</th><th className="pb-[var(--space-2)] font-medium">Role</th><th className="pb-[var(--space-2)] font-medium">Memory access</th><th className="pb-[var(--space-2)] font-medium">Created</th><th className="pb-[var(--space-2)] font-medium">Expiry</th><th className="pb-[var(--space-2)] font-medium">Last used</th><th className="pb-[var(--space-2)] font-medium">Status</th><th className="pb-[var(--space-2)] font-medium">Actions</th></tr>
              </thead>
              <tbody>
                {connections.map((row) => (
                  <tr key={row.tokenId} className="border-t border-[var(--border)]">
                    <td className="py-[var(--space-2)]"><div className="font-medium">{row.name}</div><div className="font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{row.principalName}</div></td>
                    <td className="py-[var(--space-2)]">{row.mintedByName}</td>
                    <td className="py-[var(--space-2)]">{labelForRole(row.role)}</td>
                    <td className="py-[var(--space-2)]">{labelForMemoryAccess(row.memoryAccess)}</td>
                    <td className="py-[var(--space-2)] tabular-nums">{formatDate(row.createdAt)}</td>
                    <td className="py-[var(--space-2)] tabular-nums">{editingExpiryTokenId === row.tokenId ? <input type="datetime-local" value={expiryDraft} onChange={(e) => setExpiryDraft(e.target.value)} disabled={savingExpiry} aria-label={"New expiry for " + row.name} className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)]" /> : formatDate(row.expiresAt)}</td>
                    <td className="py-[var(--space-2)] tabular-nums">{formatDate(row.lastUsedAt)}</td>
                    <td className={`py-[var(--space-2)] ${statusClassName(row.status)}`}>{labelForConnectionStatus(row.status)}</td>
                    <td className="py-[var(--space-2)]">{editingExpiryTokenId === row.tokenId ? (
                      <div className="flex items-center gap-[var(--space-1)]">
                        <button type="button" aria-label="Save expiry" title="Save expiry" onClick={() => void onSaveExpiry(row.tokenId, expiryDraft || null)} disabled={savingExpiry} className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-50"><Check size={15} /></button>
                        <button type="button" title="Never expires" onClick={() => void onSaveExpiry(row.tokenId, null)} disabled={savingExpiry} className="inline-flex h-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] text-[var(--font-size-xs)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-50">Never</button>
                        <button type="button" aria-label="Cancel expiry edit" title="Cancel" onClick={cancelEditExpiry} disabled={savingExpiry} className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-50"><X size={15} /></button>
                      </div>
                    ) : (canEditExpiry(initialAccess) || canRevoke(initialAccess, row)) && !row.revoked ? (
                      <div className="flex items-center gap-[var(--space-1)]">
                        {canEditExpiry(initialAccess) ? <button type="button" aria-label={"Edit expiry for " + row.name} title={"Edit expiry for " + row.name} onClick={() => startEditExpiry(row)} className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"><CalendarClock size={15} /></button> : null}
                        {canRevoke(initialAccess, row) ? <button type="button" aria-label={"Revoke " + row.name} title={"Revoke " + row.name} onClick={() => void onRevoke(row.tokenId)} className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--destructive)] text-[var(--destructive)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"><Trash2 size={15} /></button> : null}
                      </div>
                    ) : <span className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">-</span>}</td>
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
