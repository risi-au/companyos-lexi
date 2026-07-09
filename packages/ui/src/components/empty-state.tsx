import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon: ReactNode;
  title: ReactNode;
  body: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, body, className = "" }: EmptyStateProps) {
  return (
    <div className={`flex items-start gap-[var(--space-3)] rounded-[var(--radius-4)] bg-[var(--raised)] px-[var(--space-4)] py-[var(--space-4)] ${className}`.trim()}>
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-3)] bg-[var(--muted)] text-[var(--primary)]">
        {icon}
      </div>
      <div>
        <div className="text-[var(--font-size-sm)] font-medium text-[var(--fg)]">{title}</div>
        <div className="mt-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--mutedfg)]">{body}</div>
      </div>
    </div>
  );
}
