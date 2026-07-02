import React from "react";
import { formatValue, formatDateShort } from "./utils";

interface TableWidgetProps {
  title?: string;
  series: Array<{ metric: string; points: Array<[string, number]>; dim?: string | null }>;
  loading?: boolean;
  error?: string | null;
}

export function TableWidget({ title, series, loading, error }: TableWidgetProps) {
  if (loading) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] h-full">
        <div className="mb-2 text-[var(--font-size-sm)] font-medium">{title || "Table"}</div>
        <div className="h-20 w-full animate-pulse rounded bg-[var(--muted)]" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] h-full text-[var(--font-size-sm)] text-[var(--status-error)]">
        {title}: {error}
      </div>
    );
  }
  if (!series || series.length === 0 || series.every((s) => s.points.length === 0)) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] h-full flex flex-col">
        <div className="mb-2 text-[var(--font-size-sm)] font-medium">{title || "Table"}</div>
        <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)] mt-auto">No data in range.</div>
      </div>
    );
  }

  // Build rows: prefer by date or by dim
  const allDates = new Set<string>();
  series.forEach((s) => s.points.forEach(([d]) => allDates.add(d)));
  const dates = Array.from(allDates).sort().slice(0, 12); // cap rows

  // Columns: metrics or dim labels
  const cols = series.map((s) => ({
    key: s.dim || s.metric,
    label: s.dim || s.metric,
    s,
  }));

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] h-full flex flex-col overflow-hidden">
      {title && <div className="mb-[var(--space-2)] text-[var(--font-size-sm)] font-medium">{title}</div>}
      <div className="overflow-auto text-[var(--font-size-sm)]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="text-left py-1 pr-2 font-medium text-[var(--muted-foreground)]">Date/Dim</th>
              {cols.map((c, idx) => (
                <th key={idx} className="text-right py-1 px-2 font-medium text-[var(--muted-foreground)] tabular-nums">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.length > 0 ? (
              dates.map((d, ri) => (
                <tr key={ri} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]">
                  <td className="py-1 pr-2 text-[var(--muted-foreground)] tabular-nums">{formatDateShort(d)}</td>
                  {cols.map((c, ci) => {
                    const pt = c.s.points.find((p) => p[0] === d);
                    const v = pt ? pt[1] : null;
                    const m = c.s.metric || "";
                    return (
                      <td key={ci} className="py-1 px-2 text-right tabular-nums font-[var(--font-mono)]">
                        {v != null ? formatValue(v, m) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              series.slice(0, 5).map((s, si) => {
                const last = s.points.length ? s.points[s.points.length - 1] : undefined;
                const v = last ? last[1] : 0;
                const m = s.metric || "";
                const d = s.dim || m;
                return (
                  <tr key={si} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-1 pr-2 text-[var(--muted-foreground)]">{d}</td>
                    <td className="py-1 px-2 text-right tabular-nums font-[var(--font-mono)]">{formatValue(Number(v), m)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
