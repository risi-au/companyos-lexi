import React from "react";
import type { Record as DbRecord } from "@companyos/db";

interface RecordsWidgetProps {
  title?: string;
  records: DbRecord[];
  empty?: string;
}

export function RecordsWidget({ title = "Recent records", records, empty = "No records in range." }: RecordsWidgetProps) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] h-full flex flex-col">
      <div className="mb-[var(--space-2)] text-[var(--font-size-sm)] font-medium">{title}</div>
      {records.length === 0 ? (
        <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)] mt-auto">{empty}</div>
      ) : (
        <ul className="space-y-[var(--space-2)] text-[var(--font-size-sm)] overflow-auto">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {records.map((r: any) => (
            <li key={r.id} className="flex items-start justify-between rounded border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]">
              <div className="min-w-0">
                <span className="mr-2 inline text-[var(--font-size-xs)] rounded bg-[var(--muted)] px-[var(--space-1)] py-px text-[var(--muted-foreground)]">{r.kind}</span>
                <span className="font-medium truncate">{r.title}</span>
              </div>
              <span className="ml-2 shrink-0 text-[var(--font-size-xs)] text-[var(--muted-foreground)] tabular-nums">
                {new Date(String(r.createdAt)).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
