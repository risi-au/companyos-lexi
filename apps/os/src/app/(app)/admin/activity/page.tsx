import { api, getCurrentActorPrincipalId } from "@/lib/api";

export default async function AdminActivityPage() {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;
  const events = await api.listAdminActivity({ limit: 100 }, actor);
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
      <table className="w-full min-w-[860px] text-left text-[var(--font-size-sm)]">
        <thead className="border-b border-[var(--border)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
          <tr>
            <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Time</th>
            <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Type</th>
            <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Principal</th>
            <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Payload</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={String(event.id)} className="border-b border-[var(--border)] last:border-b-0">
              <td className="px-[var(--space-3)] py-[var(--space-2)] tabular-nums">{new Date(event.createdAt).toLocaleString()}</td>
              <td className="px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">{event.type}</td>
              <td className="px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">{event.principalId ?? "-"}</td>
              <td className="px-[var(--space-3)] py-[var(--space-2)]"><pre className="max-w-xl overflow-auto whitespace-pre-wrap text-[var(--font-size-xs)]">{JSON.stringify(event.payload, null, 2)}</pre></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
