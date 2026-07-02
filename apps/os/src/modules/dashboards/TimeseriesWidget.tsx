"use client";

import React from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import { formatDateShort, formatValue } from "./utils";

interface TimeseriesWidgetProps {
  title?: string;
  series: Array<{ metric: string; points: Array<[string, number]>; dim?: string | null }>;
  loading?: boolean;
  error?: string | null;
}

export function TimeseriesWidget({ title, series, loading, error }: TimeseriesWidgetProps) {
  if (loading) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] h-full">
        <div className="mb-2 text-[var(--font-size-sm)] font-medium">{title || "Timeseries"}</div>
        <div className="h-[220px] w-full animate-pulse rounded bg-[var(--muted)]" />
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
        <div className="mb-2 text-[var(--font-size-sm)] font-medium">{title || "Timeseries"}</div>
        <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)] mt-auto">No data in range.</div>
      </div>
    );
  }

  // Build recharts data rows by date
  const dateSet = new Set<string>();
  const metricKeys: string[] = [];
  const displayNames: Record<string, string> = {};
  series.forEach((s) => {
    const key = s.dim ? `${s.metric} (${s.dim})` : s.metric;
    metricKeys.push(key);
    displayNames[key] = key;
    s.points.forEach(([d]) => dateSet.add(d));
  });
  const sortedDates = Array.from(dateSet).sort();
  const data = sortedDates.map((date) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = { date: formatDateShort(date) };
    series.forEach((s) => {
      const key = s.dim ? `${s.metric} (${s.dim})` : s.metric;
      const pt = s.points.find((p) => p[0] === date);
      row[key] = pt ? pt[1] : null;
    });
    return row;
  });

  const chartColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] h-full flex flex-col">
      {title && <div className="mb-[var(--space-2)] text-[var(--font-size-sm)] font-medium">{title}</div>}
      <div className="flex-1 min-h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <Tooltip
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: 12 }}
              labelStyle={{ color: "var(--muted-foreground)" }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(val: any, name: any) => [formatValue(Number(val), String(name || "")), String(name || "")]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {metricKeys.map((k, i) => (  
              <Line
                key={k}
                type="linear"
                dataKey={k}
                stroke={chartColors[i % chartColors.length]}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
