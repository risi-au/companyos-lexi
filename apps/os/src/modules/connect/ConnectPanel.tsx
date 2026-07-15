"use client";

import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "@companyos/ui";
import { labelForConnectionStatus, labelForMemoryAccess, labelForRole } from "@/lib/labels";
import { PlugZap, RefreshCw, Shield, Trash2 } from "lucide-react";
import {
  getConnectConfigAction,
  listConnectionTokensAction,
  revokeConnectionTokenAction,
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
  canRevoke: boolean;
}

function canMint(access: AccessRole | null): boolean {
  return access === "owner" || access === "admin" || access === "editor" || access === "agent";
}

function canRevoke(access: AccessRole | null, row: ConnectionRow): boolean {
  if (access === "owner" || access === "admin") return true;
  if (access === "editor" || access === "agent") return row.canRevoke;
  return false;
}

function formatDate(value: string | Date | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "-";
}

export function ConnectPanel({ scopePath, initialAccess }: { scopePath: string; initialAccess: AccessRole | null }) {
  const requestConfirm = useConfirm();
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [mcpUrl, setMcpUrl] = useState("<MCP_PUBLIC_URL>");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [config, rows] = await Promise.all([getConnectConfigAction(), listConnectionTokensAction(scopePath)]);
      setMcpUrl(config.mcpPublicUrl || "<MCP_PUBLIC_URL>");
      setConnections(rows as ConnectionRow[]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load worker tokens. Refresh and try again.");
      setConnections([]);
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

  return (
    <div className="space-y-[var(--space-4)]">
      <ConnectWizard scopePath={scopePath} mcpUrl={mcpUrl} canMint={canMint(initialAccess)} onTokensChanged={refresh} />

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
                    <td className="py-[var(--space-2)] tabular-nums">{formatDate(row.expiresAt)}</td>
                    <td className="py-[var(--space-2)] tabular-nums">{formatDate(row.lastUsedAt)}</td>
                    <td className="py-[var(--space-2)]">{labelForConnectionStatus(row.revoked)}</td>
                    <td className="py-[var(--space-2)]">{canRevoke(initialAccess, row) && !row.revoked ? <button type="button" aria-label={"Revoke " + row.name} title={"Revoke " + row.name} onClick={() => void onRevoke(row.tokenId)} className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--destructive)] text-[var(--destructive)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"><Trash2 size={15} /></button> : <span className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">-</span>}</td>
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
