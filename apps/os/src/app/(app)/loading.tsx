export default function AppLoading() {
  return (
    <div className="min-h-[320px] rounded-[var(--radius-4)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-6)] text-[var(--fg)] shadow-[var(--shadow)]">
      <div className="h-[var(--space-3)] w-32 rounded-[var(--radius-2)] bg-[var(--muted)]" />
      <div className="mt-[var(--space-4)] h-[var(--space-6)] w-64 rounded-[var(--radius-2)] bg-[var(--hover)]" />
      <div className="mt-[var(--space-6)] grid gap-[var(--space-3)]">
        <div className="h-[var(--space-4)] rounded-[var(--radius-2)] bg-[var(--muted)]" />
        <div className="h-[var(--space-4)] w-5/6 rounded-[var(--radius-2)] bg-[var(--muted)]" />
        <div className="h-[var(--space-4)] w-2/3 rounded-[var(--radius-2)] bg-[var(--muted)]" />
      </div>
    </div>
  );
}
