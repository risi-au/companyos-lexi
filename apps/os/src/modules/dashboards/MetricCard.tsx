"use client";

import { useEffect, useRef } from "react";
import { countUp } from "@companyos/ui";
import { computeDelta, formatValue } from "./utils";

interface MetricCardProps {
  title: string;
  value: number;
  prevValue?: number | null;
  metricName?: string;
  loading?: boolean;
}

export function MetricCard({ title, value, prevValue, metricName, loading }: MetricCardProps) {
  const valueRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = valueRef.current;
    if (!el || loading) return;
    void countUp(el, value, {
      format: (n) => formatValue(n, metricName),
    });
  }, [value, metricName, loading]);

  if (loading) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] h-full">
        <div className="mb-2 text-[var(--font-size-sm)] font-medium text-[var(--muted-foreground)]">{title}</div>
        <div className="h-9 w-24 animate-pulse rounded bg-[var(--muted)]" />
      </div>
    );
  }

  const delta = computeDelta(value, prevValue ?? null);

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] h-full flex flex-col">
      <div className="text-[var(--font-size-sm)] font-medium text-[var(--muted-foreground)]">{title}</div>
      <div className="mt-auto flex items-baseline gap-2">
        <span
          ref={valueRef}
          data-count={value}
          className="text-[var(--font-size-3xl)] font-semibold tabular-nums tracking-[-0.02em] font-[var(--font-mono)]"
        >
          {formatValue(value, metricName)}
        </span>
        {delta.pct != null && (
          <span className={`inline-flex items-center gap-0.5 text-[var(--font-size-sm)] tabular-nums ${delta.colorClass}`}>
            {delta.arrow} {Math.abs(delta.pct)}%
          </span>
        )}
      </div>
      {prevValue == null && <div className="mt-1 text-[var(--font-size-xs)] text-[var(--muted-foreground)]">no previous period</div>}
    </div>
  );
}