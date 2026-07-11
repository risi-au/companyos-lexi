"use client";

import { useMemo, useState, useTransition } from "react";
import { RefreshCw, Save } from "lucide-react";
import { queryUsageAction, setContextProfileAction, type QueryUsageActionInput } from "./actions";

type GroupBy = NonNullable<QueryUsageActionInput["groupBy"]>;

interface UsageSummaryRow {
  key: string;
  calls: number;
  successCount: number;
  errorCount: number;
  inputTokensEst: number;
  outputTokensEst: number;
  totalTokensEst: number;
  byteIn: number;
  byteOut: number;
  latencyMs: number;
}

interface UsageEventRow {
  id: string;
  scopePath?: string | null;
  principalId: string | null;
  tokenId: string | null;
  sessionId: string | null;
  connectionId: string | null;
  operation: string;
  source: string;
  totalTokensEst: number | null;
  byteIn: number;
  byteOut: number;
  latencyMs: number;
  success: boolean;
  errorCode: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | Date;
}

interface UsagePayload {
  usage: {
    estimated: true;
    groupBy: string;
    rows: UsageSummaryRow[];
    events: UsageEventRow[];
  };
  recommendations: string[];
  profile: {
    profile: { id: string; name: string; isDefault: boolean } | null;
    config: Record<string, unknown>;
    impact: { estimatedTokens: number; comparedToStandard: number };
  };
}

const PRESET_IMPACT: Record<"lean" | "standard" | "deep", string> = {
  lean: "Lowest estimate: fewer records, wiki rows, and optional sections.",
  standard: "Baseline estimate: conservative default.",
  deep: "Highest estimate: larger record, wiki, and search budgets.",
};

const GROUP_BY_LABELS: Record<GroupBy, string> = {
  operation: "Operation",
  scope: "Project",
  principal: "Person or agent",
  token: "Token",
  connection: "Connected app",
  session: "Session",
  source: "Source",
  model: "Model",
  success: "Status",
};

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function fmt(value: number | null | undefined): string {
  return new Intl.NumberFormat().format(value || 0);
}

function fmtDate(value: string | Date): string {
  return new Date(value).toLocaleString();
}

function metadataSummary(metadata: Record<string, unknown>): string {
  if (Array.isArray(metadata.sections)) {
    return metadata.sections
      .map((section) => {
        const row = section as { name?: string; tokensEst?: number };
        return `${row.name || "section"}:${row.tokensEst || 0}`;
      })
      .join(" ");
  }
  const resultCount = metadata.resultCount;
  if (typeof resultCount === "number") return `results:${resultCount}`;
  const keys = metadata.argumentKeys;
  if (Array.isArray(keys)) return `args:${keys.join(",")}`;
  return "";
}

export function UsageDashboardView({ initial }: { initial: UsagePayload }) {
  const [payload, setPayload] = useState<UsagePayload>(initial);
  const [scope, setScope] = useState("root");
  const [range, setRange] = useState("7");
  const [groupBy, setGroupBy] = useState<GroupBy>("operation");
  const [operation, setOperation] = useState("");
  const [principalId, setPrincipalId] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [preset, setPreset] = useState<"lean" | "standard" | "deep">("standard");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const totals = useMemo(() => {
    return payload.usage.rows.reduce(
      (acc, row) => ({
        calls: acc.calls + row.calls,
        totalTokensEst: acc.totalTokensEst + row.totalTokensEst,
        errors: acc.errors + row.errorCount,
      }),
      { calls: 0, totalTokensEst: 0, errors: 0 }
    );
  }, [payload.usage.rows]);

  function refresh(extra?: Partial<QueryUsageActionInput>) {
    startTransition(async () => {
      try {
        setError(null);
        setMessage(null);
        const next = await queryUsageAction({
          scope,
          since: range === "all" ? undefined : isoDaysAgo(Number(range)),
          groupBy,
          operation,
          principalId,
          tokenId,
          connectionId,
          sessionId,
          ...extra,
        });
        setPayload(next as UsagePayload);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't query usage. Check the filters and retry.");
      }
    });
  }

  function saveProfile() {
    startTransition(async () => {
      try {
        setError(null);
        const result = await setContextProfileAction({ scope, name: preset, preset });
        setMessage(`Saved ${preset} profile. Estimated impact: ${result.impact.comparedToStandard} tokens vs standard.`);
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save the profile. Check your access and retry.");
      }
    });
  }

  return (
    <div className="space-y-[var(--space-4)]">
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <div className="mb-[var(--space-3)] flex flex-wrap items-end gap-[var(--space-3)]">
          <label className="block min-w-56 flex-1">
            <span className="block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Project subtree</span>
            <input value={scope} onChange={(event) => setScope(event.target.value)} className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] text-[var(--font-size-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]" />
          </label>
          <label className="block">
            <span className="block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Date range</span>
            <select value={range} onChange={(event) => setRange(event.target.value)} className="h-10 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] text-[var(--font-size-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]">
              <option value="1">24 hours</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="all">All time</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Group by</span>
            <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as GroupBy)} className="h-10 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] text-[var(--font-size-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]">
              {(Object.keys(GROUP_BY_LABELS) as GroupBy[]).map((item) => <option key={item} value={item}>{GROUP_BY_LABELS[item]}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => refresh()} disabled={isPending} className="inline-flex h-10 items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] text-[var(--font-size-sm)] hover:bg-[var(--muted)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]">
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>

        <div className="grid gap-[var(--space-3)] md:grid-cols-5">
          {[
            ["Operation", operation, setOperation],
            ["Person or agent", principalId, setPrincipalId],
            ["Token", tokenId, setTokenId],
            ["Connected app", connectionId, setConnectionId],
            ["Session", sessionId, setSessionId],
          ].map(([label, value, setter]) => (
            <label key={label as string} className="block">
              <span className="block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{label as string}</span>
              <input value={value as string} onChange={(event) => (setter as (value: string) => void)(event.target.value)} className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] font-mono text-[var(--font-size-xs)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]" />
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-[var(--space-3)] md:grid-cols-3">
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
          <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Estimated context tokens</div>
          <div className="font-mono text-[var(--font-size-2xl)] font-semibold">{fmt(totals.totalTokensEst)}</div>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
          <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">MCP/context events</div>
          <div className="font-mono text-[var(--font-size-2xl)] font-semibold">{fmt(totals.calls)}</div>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
          <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Errors</div>
          <div className="font-mono text-[var(--font-size-2xl)] font-semibold">{fmt(totals.errors)}</div>
        </div>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <div className="mb-[var(--space-3)] flex flex-wrap items-end justify-between gap-[var(--space-3)]">
          <div>
            <div className="text-[var(--font-size-sm)] font-medium">Context profile</div>
            <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
              Effective: {payload.profile.profile?.name || "Standard fallback"}, {fmt(payload.profile.impact.estimatedTokens)} estimated tokens
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-[var(--space-2)]">
            <label>
              <span className="block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Preset</span>
              <select value={preset} onChange={(event) => setPreset(event.target.value as "lean" | "standard" | "deep")} className="h-10 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] text-[var(--font-size-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]">
                <option value="lean">Lean</option>
                <option value="standard">Standard</option>
                <option value="deep">Deep</option>
              </select>
            </label>
            <button type="button" onClick={saveProfile} disabled={isPending} className="inline-flex h-10 items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] text-[var(--font-size-sm)] hover:bg-[var(--muted)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]">
              <Save size={15} />
              Save profile
            </button>
          </div>
        </div>
        <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{PRESET_IMPACT[preset]}</div>
      </div>

      {payload.recommendations.length ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
          <div className="mb-[var(--space-2)] text-[var(--font-size-sm)] font-medium">Suggested savings</div>
          <ul className="space-y-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            {payload.recommendations.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ) : null}

      {error ? <div className="rounded-[var(--radius-sm)] border border-[var(--destructive)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--destructive)]">{error}</div> : null}
      {message ? <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">{message}</div> : null}

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[920px] text-left text-[var(--font-size-sm)]">
          <thead className="border-b border-[var(--border)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
            <tr>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Group</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Calls</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Estimated tokens</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">In / out bytes</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Errors</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Latency ms</th>
            </tr>
          </thead>
          <tbody>
            {payload.usage.rows.map((row) => (
              <tr key={row.key} className="border-b border-[var(--border)] last:border-b-0">
                <td className="px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">{row.key}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)] tabular-nums">{fmt(row.calls)}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)] tabular-nums">{fmt(row.totalTokensEst)}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)] tabular-nums">{fmt(row.byteIn)} / {fmt(row.byteOut)}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)] tabular-nums">{fmt(row.errorCount)}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)] tabular-nums">{fmt(row.latencyMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[1100px] text-left text-[var(--font-size-sm)]">
          <thead className="border-b border-[var(--border)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
            <tr>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Time</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Operation</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Project path</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Session</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Token</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Estimate</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Status</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {payload.usage.events.map((event) => (
              <tr key={event.id} className="border-b border-[var(--border)] last:border-b-0">
                <td className="px-[var(--space-3)] py-[var(--space-2)] tabular-nums">{fmtDate(event.createdAt)}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">{event.operation}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">{event.scopePath || "-"}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">{event.sessionId || "-"}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">{event.tokenId || "-"}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)] tabular-nums">{fmt(event.totalTokensEst)}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)]">{event.success ? "Success" : event.errorCode || "Error"}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{metadataSummary(event.metadata || {})}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
