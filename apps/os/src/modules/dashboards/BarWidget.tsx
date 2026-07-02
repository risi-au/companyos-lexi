"use client";

import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import { formatValue } from "./utils";

interface BarWidgetProps {
  title?: string;
  series: Array<{ metric: string; points: Array<[string, number]>; dim?: string | null }>;
  groupBy?: string;
  loading?: boolean;
  error?: string | null;
}

export function BarWidget({ title, series, loading, error }: BarWidgetProps) {
  if (loading) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] h-full">
        <div className="mb-2 text-[var(--font-size-sm)] font-medium">{title || "Bar"}</div>
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
        <div className="mb-2 text-[var(--font-size-sm)] font-medium">{title || "Bar"}</div>
        <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)] mt-auto">No data in range.</div>
      </div>
    );
  }

  // For bar, use the group (first value of dim or metric) as category; aggregate if needed.
  // Assume series have single point or last value, or use group label from dim.
  const categories = new Map<string, Record<string, number>>();
  series.forEach((s) => {
    const cat = s.dim ? s.dim.split("=")[1] || s.dim : s.metric;
    s.points.forEach(([, v]) => {
      if (!categories.has(cat)) categories.set(cat, {});
      const row = categories.get(cat)!;
      const mkey = s.metric;
      row[mkey] = (row[mkey] || 0) + v;
    });
  });
   
  const data = Array.from(categories.entries()).map(([cat, vals]) => ({ name: cat, ...vals }));

  const chartColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
  const metricNames = Array.from(new Set(series.map((s) => s.metric)));  

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] h-full flex flex-col">
      {title && <div className="mb-[var(--space-2)] text-[var(--font-size-sm)] font-medium">{title}</div>}
      <div className="flex-1 min-h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <Tooltip
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: 12 }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(val: any, name: any) => [formatValue(Number(val), String(name || "")), String(name || "")]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {metricNames.map((m, i) => (
              <Bar key={m} dataKey={m} fill={chartColors[i % chartColors.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
