"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clipboard, ExternalLink, LoaderCircle } from "lucide-react";
import { Stepper } from "@companyos/ui";
import {
  getOAuthConnectionStatusAction,
  listConnectionTokensAction,
  mintConnectionTokenAction,
} from "./actions";
import { platforms, type Platform, type PlatformId } from "./platforms";

interface MintResult {
  token: string;
  tokenId: string;
  expiresAt: string | Date | null;
}

const expiryOptions = [
  { label: "24h", value: "24h", days: 1 },
  { label: "7d", value: "7d", days: 7 },
  { label: "90d", value: "90d", days: 90 },
  { label: "None", value: "none", days: null },
] as const;

function expiryIso(preset: string): string | null {
  const option = expiryOptions.find((item) => item.value === preset);
  return !option || option.days === null ? null : new Date(Date.now() + option.days * 86400000).toISOString();
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={"Copy " + label}
      title={"Copy " + label}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
    >
      {copied ? <Check size={15} /> : <Clipboard size={15} />}
    </button>
  );
}

function CodeBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]">
        <span className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{label}</span>
        <CopyButton value={value} label={label} />
      </div>
      <pre className="overflow-auto p-[var(--space-3)] text-[var(--font-size-xs)] leading-5"><code>{value}</code></pre>
    </div>
  );
}

export function ConnectWizard({
  scopePath,
  mcpUrl,
  canMint,
  onTokensChanged,
}: {
  scopePath: string;
  mcpUrl: string;
  canMint: boolean;
  onTokensChanged: () => Promise<void>;
}) {
  const [current, setCurrent] = useState(1);
  const [maxReached, setMaxReached] = useState(1);
  const [platformId, setPlatformId] = useState<PlatformId | null>(null);
  const [useToken, setUseToken] = useState(false);
  const [name, setName] = useState(scopePath + " MCP");
  const [role, setRole] = useState<"agent" | "viewer">("agent");
  const [expiry, setExpiry] = useState("7d");
  const [minted, setMinted] = useState<MintResult | null>(null);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<{ clientName: string } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [pollDeadline, setPollDeadline] = useState(() => Date.now() + 120000);
  const [wizardStartedAt] = useState(() => new Date().toISOString());

  const platform = useMemo<Platform | null>(
    () => platforms.find((item) => item.id === platformId) || null,
    [platformId]
  );

  useEffect(() => {
    if (current !== 3 || connection || waiting) return;
    let active = true;
    const poll = async () => {
      try {
        if (useToken) {
          if (!minted) return;
          const rows = await listConnectionTokensAction(scopePath);
          const row = (rows as Array<{ tokenId: string; lastUsedAt: string | Date | null }>).find((item) => item.tokenId === minted.tokenId);
          if (active && row?.lastUsedAt) setConnection({ clientName: "Worker token" });
        } else {
          const rows = await getOAuthConnectionStatusAction({ since: wizardStartedAt });
          if (active && rows[0]) setConnection({ clientName: rows[0].clientName || "CompanyOS client" });
        }
      } catch {
        // A temporary polling error should not end the setup flow.
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 4000);
    const timeout = window.setTimeout(() => {
      if (active) setWaiting(true);
    }, Math.max(0, pollDeadline - Date.now()));
    return () => {
      active = false;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [connection, current, minted, pollDeadline, scopePath, useToken, waiting, wizardStartedAt]);

  function advance(step: number) {
    setCurrent(step);
    setMaxReached((value) => Math.max(value, step));
  }

  async function mint() {
    setMinting(true);
    setError(null);
    try {
      const result = await mintConnectionTokenAction({
        scopePath,
        name: name.trim(),
        role,
        expiresAt: expiryIso(expiry),
      });
      setMinted(result as MintResult);
      await onTokensChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't create the worker token. Check the fields and retry.");
    } finally {
      setMinting(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="grid md:grid-cols-[190px,1fr]">
        <Stepper
          steps={[{ id: "platform", label: "Platform" }, { id: "setup", label: "Set up" }, { id: "verify", label: "Verify" }]}
          current={current}
          maxReached={maxReached}
          onStepClick={setCurrent}
          className="border-b border-[var(--border)] md:border-b-0 md:border-r"
        />
        <div className="min-w-0 p-[var(--space-4)]">
          {current === 1 && (
            <>
              <h2 className="text-[var(--font-size-lg)] font-medium">Connect CompanyOS</h2>
              <p className="mb-[var(--space-4)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">Choose the client you want to connect. OAuth is the default and does not show a worker token.</p>
              <div className="grid gap-[var(--space-2)] sm:grid-cols-2 xl:grid-cols-3">
                {platforms.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setPlatformId(item.id);
                      setUseToken(!item.oauth);
                      advance(2);
                    }}
                    className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] p-[var(--space-3)] text-left text-[var(--font-size-sm)] font-medium hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {current === 2 && platform && (
            <>
              <div className="mb-[var(--space-3)] flex items-center justify-between gap-[var(--space-3)]">
                <div>
                  <h2 className="text-[var(--font-size-lg)] font-medium">{platform.label}</h2>
                  <p className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">{useToken ? "Worker token setup" : "OAuth setup"}</p>
                </div>
                <button type="button" onClick={() => setCurrent(1)} className="text-[var(--font-size-sm)] text-[var(--primary)]">Change platform</button>
              </div>

              {!useToken && platform.oauth ? (
                <div className="space-y-[var(--space-3)]">
                  <CodeBlock label="MCP URL" value={mcpUrl} />
                  {platform.oauth.deeplink && (
                    <a href={platform.oauth.deeplink(mcpUrl)} className="inline-flex h-10 items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--primary-foreground)]">
                      Install in {platform.label}<ExternalLink size={15} />
                    </a>
                  )}
                  {platform.oauth.command && <CodeBlock label="Command" value={platform.oauth.command(mcpUrl)} />}
                  <ol className="list-decimal space-y-[var(--space-2)] pl-[var(--space-5)] text-[var(--font-size-sm)]">
                    {platform.oauth.steps.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                  {platform.oauth.note && <p className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] p-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">{platform.oauth.note}</p>}
                  <div className="flex flex-wrap items-center gap-[var(--space-3)]">
                    <button type="button" onClick={() => advance(3)} className="h-10 rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--primary-foreground)]">I have connected</button>
                    <button type="button" onClick={() => setUseToken(true)} className="text-[var(--font-size-sm)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]">Use a worker token instead</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-[var(--space-3)]">
                  {!canMint ? <p className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">Your current access can view worker tokens but cannot create one.</p> : !minted ? (
                    <>
                      <div className="grid gap-[var(--space-3)] lg:grid-cols-3">
                        <label className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] text-[var(--font-size-sm)]" /></label>
                        <label className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Role<select value={role} onChange={(event) => setRole(event.target.value as "agent" | "viewer")} className="mt-1 h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] text-[var(--font-size-sm)]"><option value="agent">Agent</option><option value="viewer">Viewer</option></select></label>
                        <label className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Expiry<select value={expiry} onChange={(event) => setExpiry(event.target.value)} className="mt-1 h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] text-[var(--font-size-sm)]">{expiryOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                      </div>
                      {error && <p className="text-[var(--font-size-sm)] text-[var(--destructive)]">{error}</p>}
                      <button type="button" disabled={minting || !name.trim()} onClick={() => void mint()} className="h-10 rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--primary-foreground)] disabled:opacity-60">{minting ? "Creating..." : "Create worker token"}</button>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-[var(--font-size-sm)]">Token shown once</p>
                      <p className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">You will not see this token again.</p>
                      <CodeBlock label="Worker token" value={minted.token} />
                      <CodeBlock label={platform.label + " configuration"} value={platform.token.snippet(mcpUrl, minted.token)} />
                      <button type="button" onClick={() => advance(3)} className="h-10 rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--primary-foreground)]">I have connected</button>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {current === 3 && (
            <div className="space-y-[var(--space-3)]">
              <h2 className="text-[var(--font-size-lg)] font-medium">Verify connection</h2>
              {connection ? (
                <div className="rounded-[var(--radius-sm)] border border-[var(--ok)] bg-[var(--background)] p-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--ok)]"><Check className="mr-[var(--space-2)] inline" size={16} />Connected to {connection.clientName}</div>
              ) : waiting ? (
                <>
                  <p className="text-[var(--font-size-sm)]">Still waiting for the first authenticated MCP call.</p>
                  <ul className="list-disc space-y-[var(--space-2)] pl-[var(--space-5)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]"><li>Check that the URL was pasted exactly.</li><li>Restart the client and connect again.</li><li>Claude web and ChatGPT require the consent screen to be approved.</li></ul>
                  <button type="button" onClick={() => { setWaiting(false); setPollDeadline(Date.now() + 120000); }} className="h-10 rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] text-[var(--font-size-sm)]">Keep waiting</button>
                </>
              ) : (
                <p className="flex items-center gap-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]"><LoaderCircle className="animate-spin" size={16} />Waiting for the first authenticated MCP call...</p>
              )}
              <button type="button" onClick={() => setCurrent(2)} className="text-[var(--font-size-sm)] text-[var(--primary)]">Back to setup</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
