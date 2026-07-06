"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Record as DbRecord } from "@companyos/db";
import { listWorkLogRecordsAction } from "./actions";

type WorkLogRecord = DbRecord & { scopePath?: string };
type KindFilter = DbRecord["kind"] | "all";
type SincePreset = "all" | "7d" | "30d" | "90d";

const sinceOptions: { value: SincePreset; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

const kindOptions: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All kinds" },
  { value: "changelog", label: "Changelog" },
  { value: "decision", label: "Decision" },
  { value: "report", label: "Report" },
  { value: "note", label: "Note" },
];

function presetToSince(preset: SincePreset) {
  if (preset === "all") return undefined;
  const days = Number(preset.replace("d", ""));
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

export function WorkLogView({
  scopePath,
  initialRecords,
}: {
  scopePath: string;
  initialRecords: WorkLogRecord[];
}) {
  const [records, setRecords] = useState<WorkLogRecord[]>(initialRecords);
  const [kind, setKind] = useState<KindFilter>("all");
  const [sincePreset, setSincePreset] = useState<SincePreset>("30d");
  const [scopeFilter, setScopeFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      try {
        setError(null);
        const next = await listWorkLogRecordsAction({
          scopePath,
          kind,
          since: presetToSince(sincePreset),
          limit: 100,
        });
        setRecords(next as WorkLogRecord[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load work log");
      }
    });
  }, [scopePath, kind, sincePreset]);

  const visibleRecords = useMemo(() => {
    const needle = scopeFilter.trim().toLowerCase();
    if (!needle) return records;
    return records.filter((record) => (record.scopePath || "").toLowerCase().includes(needle));
  }, [records, scopeFilter]);

  return (
    <div className="space-y-[var(--space-4)]">
      <div className="flex flex-wrap items-end gap-[var(--space-3)]">
        <div>
          <label className="block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Kind</label>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as KindFilter)}
            className="h-10 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] text-[var(--font-size-sm)]"
          >
            {kindOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Since</label>
          <select
            value={sincePreset}
            onChange={(event) => setSincePreset(event.target.value as SincePreset)}
            className="h-10 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] text-[var(--font-size-sm)]"
          >
            {sinceOptions.map((option) => (
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
          {isPending ? "Loading..." : `${visibleRecords.length} records`}
        </div>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-sm)] border border-[var(--destructive)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--destructive)]">
          {error}
        </div>
      ) : null}

      {visibleRecords.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
          No records match these filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-left text-[var(--font-size-sm)]">
            <thead className="border-b border-[var(--border)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
              <tr>
                <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Scope</th>
                <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Kind</th>
                <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Title</th>
                <th className="px-[var(--space-3)] py-[var(--space-2)] text-right font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map((record) => (
                <tr key={record.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="max-w-xs px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                    {record.scopePath || scopePath}
                  </td>
                  <td className="px-[var(--space-3)] py-[var(--space-2)]">
                    <span className="inline-flex rounded-[var(--radius-sm)] bg-[var(--muted)] px-[var(--space-2)] py-px text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                      {record.kind}
                    </span>
                  </td>
                  <td className="px-[var(--space-3)] py-[var(--space-2)] font-medium">{record.title}</td>
                  <td className="px-[var(--space-3)] py-[var(--space-2)] text-right text-[var(--font-size-xs)] text-[var(--muted-foreground)] tabular-nums">
                    {new Date(String(record.createdAt)).toLocaleDateString()}
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
