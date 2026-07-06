"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clipboard, PlugZap, RefreshCw, RotateCcw, Shield, Trash2 } from "lucide-react";
import {
  getConnectConfigAction,
  listConnectionTokensAction,
  mintConnectionTokenAction,
  revokeConnectionTokenAction,
} from "./actions";

type AccessRole = "owner" | "admin" | "editor" | "agent" | "viewer" | string;

interface ConnectionRow {
  tokenId: string;
  name: string;
  principalName: string;
  mintedByName: string;
  role: "agent" | "viewer";
  createdAt: string | Date;
  expiresAt: string | Date | null;
  lastUsedAt: string | Date | null;
  revoked: boolean;
  canRevoke: boolean;
}

interface MintResult {
  token: string;
  storeNow: true;
  tokenId: string;
  principalId: string;
  expiresAt: string | Date | null;
}

const EXPIRY_OPTIONS = [
  { label: "24h", value: "24h", days: 1 },
  { label: "7d", value: "7d", days: 7 },
  { label: "90d", value: "90d", days: 90 },
  { label: "None", value: "none", days: null },
] as const;

function canMint(access: AccessRole | null): boolean {
  return access === "owner" || access === "admin" || access === "editor" || access === "agent";
}

function canRevoke(access: AccessRole | null, row: ConnectionRow): boolean {
  if (access === "owner" || access === "admin") return true;
  if (access === "editor" || access === "agent") return row.canRevoke;
  return false;
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function expiryIso(preset: string): string | null {
  const option = EXPIRY_OPTIONS.find((item) => item.value === preset);
  if (!option || option.days === null) return null;
  return new Date(Date.now() + option.days * 24 * 60 * 60 * 1000).toISOString();
}

function SnippetCopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
    >
      {copied ? <Check size={15} /> : <Clipboard size={15} />}
    </button>
  );
}

function SnippetBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]">
        <div className="text-[var(--font-size-xs)] font-medium text-[var(--muted-foreground)]">{title}</div>
        <SnippetCopyButton text={text} label={title} />
      </div>
      <pre className="max-h-[180px] overflow-auto p-[var(--space-3)] text-[var(--font-size-xs)] leading-5">
        <code>{text}</code>
      </pre>
    </div>
  );
}

export function ConnectPanel({ scopePath, initialAccess }: { scopePath: string; initialAccess: AccessRole | null }) {
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [mcpUrl, setMcpUrl] = useState("<MCP_PUBLIC_URL>");
  const [name, setName] = useState(`${scopePath} MCP`);
  const [role, setRole] = useState<"agent" | "viewer">("agent");
  const [expiryPreset, setExpiryPreset] = useState("7d");
  const [minted, setMinted] = useState<MintResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readOnly = !canMint(initialAccess);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [config, rows] = await Promise.all([
        getConnectConfigAction(),
        listConnectionTokensAction(scopePath),
      ]);
      setMcpUrl(config.mcpPublicUrl || "<MCP_PUBLIC_URL>");
      setConnections(rows as ConnectionRow[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load connections");
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, [scopePath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const snippets = useMemo(() => {
    if (!minted) return null;
    const authHeader = `Authorization: Bearer ${minted.token}`;
    return {
      claude: `claude mcp add companyos ${mcpUrl} --transport http --header "${authHeader}"`,
      mcpJson: JSON.stringify({
        mcpServers: {
          companyos: {
            url: mcpUrl,
            transport: "http",
            headers: { Authorization: `Bearer ${minted.token}` },
          },
        },
      }, null, 2),
      codex: `[mcp_servers.companyos]
url = "${mcpUrl}"
transport = "http"

[mcp_servers.companyos.headers]
Authorization = "Bearer ${minted.token}"`,
      claudeDesktop: `Add a custom HTTP connector named companyos.
URL: ${mcpUrl}
Header: ${authHeader}`,
      chatgpt: `ChatGPT web: paste ${mcpUrl} and the Authorization bearer header into its connector UI.`,
    };
  }, [mcpUrl, minted]);

  async function onMint() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await mintConnectionTokenAction({
        scopePath,
        name: name.trim(),
        role,
        expiresAt: expiryIso(expiryPreset),
      });
      setMinted(result as MintResult);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mint connection token");
    } finally {
      setSubmitting(false);
    }
  }

  async function onRevoke(tokenId: string) {
    if (!confirm("Revoke this connection token?")) return;
    setError(null);
    try {
      await revokeConnectionTokenAction(scopePath, tokenId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke connection token");
    }
  }

  return (
    <div className="space-y-[var(--space-4)]">
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <div className="mb-[var(--space-4)] flex flex-wrap items-center justify-between gap-[var(--space-3)]">
          <div className="flex items-center gap-[var(--space-2)]">
            <PlugZap size={18} />
            <div>
              <div className="text-[var(--font-size-sm)] font-medium">Connect to MCP</div>
              <div className="font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{mcpUrl}</div>
            </div>
          </div>
          <button
            type="button"
            aria-label="Refresh connections"
            title="Refresh connections"
            onClick={refresh}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          >
            <RefreshCw size={15} />
          </button>
        </div>

        {error && (
          <div className="mb-[var(--space-3)] rounded-[var(--radius-sm)] border border-[var(--destructive)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--destructive)]">
            {error}
          </div>
        )}

        {!readOnly && (
          <div className="grid gap-[var(--space-3)] lg:grid-cols-[1fr,140px,220px,auto]">
            <div>
              <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Name</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] text-[var(--font-size-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Role</label>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as "agent" | "viewer")}
                className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] text-[var(--font-size-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              >
                <option value="agent">agent</option>
                <option value="viewer">viewer</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Expiry</label>
              <div className="grid grid-cols-4 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)]">
                {EXPIRY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setExpiryPreset(option.value)}
                    className={`h-10 text-[var(--font-size-xs)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] ${
                      expiryPreset === option.value ? "bg-[var(--muted)] font-medium text-[var(--primary)]" : ""
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                disabled={submitting || !name.trim()}
                onClick={onMint}
                className="inline-flex h-10 items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--primary-foreground)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              >
                <Shield size={15} />
                Mint
              </button>
            </div>
          </div>
        )}

        {readOnly && (
          <div className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            <Shield size={15} />
            Viewer access is read-only for MCP connections.
          </div>
        )}
      </div>

      {minted && snippets && (
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
          <div className="mb-[var(--space-3)] flex items-center justify-between gap-[var(--space-3)]">
            <div>
              <div className="text-[var(--font-size-sm)] font-medium">Token shown once</div>
              <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">You will not see this token again.</div>
            </div>
            <button
              type="button"
              onClick={() => setMinted(null)}
              aria-label="Hide token"
              title="Hide token"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            >
              <RotateCcw size={15} />
            </button>
          </div>
          <div className="mb-[var(--space-3)] flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)]">
            <code className="min-w-0 flex-1 overflow-auto whitespace-nowrap text-[var(--font-size-xs)]">{minted.token}</code>
            <SnippetCopyButton text={minted.token} label="token" />
          </div>
          <div className="grid gap-[var(--space-3)] lg:grid-cols-2">
            <SnippetBlock title="Claude CLI" text={snippets.claude} />
            <SnippetBlock title="VS Code / Cursor mcp.json" text={snippets.mcpJson} />
            <SnippetBlock title="Codex config.toml" text={snippets.codex} />
            <SnippetBlock title="Claude Desktop connector" text={snippets.claudeDesktop} />
            <SnippetBlock title="ChatGPT web" text={snippets.chatgpt} />
          </div>
        </div>
      )}

      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">This scope&apos;s connections</div>
        {loading ? (
          <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">Loading connections...</div>
        ) : connections.length === 0 ? (
          <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No connections minted for this scope.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[var(--font-size-sm)]">
              <thead className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                <tr>
                  <th className="pb-[var(--space-2)] font-medium">Name</th>
                  <th className="pb-[var(--space-2)] font-medium">Minted by</th>
                  <th className="pb-[var(--space-2)] font-medium">Role</th>
                  <th className="pb-[var(--space-2)] font-medium">Created</th>
                  <th className="pb-[var(--space-2)] font-medium">Expiry</th>
                  <th className="pb-[var(--space-2)] font-medium">Last used</th>
                  <th className="pb-[var(--space-2)] font-medium">Status</th>
                  <th className="pb-[var(--space-2)] font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((row) => (
                  <tr key={row.tokenId} className="border-t border-[var(--border)]">
                    <td className="py-[var(--space-2)]">
                      <div className="font-medium">{row.name}</div>
                      <div className="font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{row.principalName}</div>
                    </td>
                    <td className="py-[var(--space-2)]">{row.mintedByName}</td>
                    <td className="py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">{row.role}</td>
                    <td className="py-[var(--space-2)] tabular-nums">{formatDate(row.createdAt)}</td>
                    <td className="py-[var(--space-2)] tabular-nums">{formatDate(row.expiresAt)}</td>
                    <td className="py-[var(--space-2)] tabular-nums">{formatDate(row.lastUsedAt)}</td>
                    <td className="py-[var(--space-2)]">{row.revoked ? "revoked" : "active"}</td>
                    <td className="py-[var(--space-2)]">
                      {canRevoke(initialAccess, row) && !row.revoked ? (
                        <button
                          type="button"
                          aria-label={`Revoke ${row.name}`}
                          title={`Revoke ${row.name}`}
                          onClick={() => onRevoke(row.tokenId)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--destructive)] text-[var(--destructive)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                        >
                          <Trash2 size={15} />
                        </button>
                      ) : (
                        <span className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">-</span>
                      )}
                    </td>
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
