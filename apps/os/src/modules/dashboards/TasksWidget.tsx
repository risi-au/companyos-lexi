import React from "react";

interface TaskItem {
  id: string;
  title: string;
  url?: string | null;
}

interface TasksWidgetProps {
  title?: string;
  tasks: TaskItem[];
  empty?: string;
}

export function TasksWidget({ title = "Open tasks", tasks, empty = "No open tasks." }: TasksWidgetProps) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] h-full flex flex-col">
      <div className="mb-[var(--space-2)] flex items-center justify-between text-[var(--font-size-sm)] font-medium">
        <span>{title}</span>
        <span className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">via Plane</span>
      </div>
      {tasks.length === 0 ? (
        <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)] mt-auto">{empty}</div>
      ) : (
        <ul className="space-y-[var(--space-2)] text-[var(--font-size-sm)] overflow-auto">
          {tasks.map((t, idx) => (
            <li key={t.id || idx} className="rounded border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]">
              <div className="font-medium truncate">{t.title || "Untitled"}</div>
              {t.url && (
                <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-[var(--font-size-xs)] text-[var(--primary)] hover:underline">
                  open ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
