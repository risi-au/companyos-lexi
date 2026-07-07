import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { grantAdminRoleAction, revokeAdminGrantAction } from "@/modules/admin/actions";

export default async function AdminGrantsPage() {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;
  const [grants, principals] = await Promise.all([
    api.listAdminGrants(actor),
    api.listGrantablePrincipals(actor),
  ]);

  return (
    <div className="space-y-[var(--space-4)]">
      <form action={grantAdminRoleAction} className="grid grid-cols-1 gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] lg:grid-cols-[1fr_220px_160px_auto]">
        <select name="principalId" required className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]">
          <option value="">Principal</option>
          {principals.map((principal) => <option key={principal.id} value={principal.id}>{principal.name} {principal.email ? `(${principal.email})` : ""}</option>)}
        </select>
        <input name="scopePath" defaultValue="root" className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-sm)]" />
        <select name="role" defaultValue="viewer" className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]">
          <option value="viewer">viewer</option>
          <option value="editor">editor</option>
          <option value="admin">admin</option>
          <option value="owner">owner</option>
          <option value="agent">agent</option>
        </select>
        <button className="rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--primary-foreground)]">Grant</button>
      </form>
      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[860px] text-left text-[var(--font-size-sm)]">
          <thead className="border-b border-[var(--border)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
            <tr>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Principal</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Scope</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Role</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Created</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {grants.map((grant) => (
              <tr key={grant.grantId} className="border-b border-[var(--border)] last:border-b-0">
                <td className="px-[var(--space-3)] py-[var(--space-2)]">
                  <div>{grant.principalName}</div>
                  <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{grant.principalEmail ?? grant.principalId}</div>
                </td>
                <td className="px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">{grant.scopePath}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)]">{grant.role}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)]">{new Date(grant.createdAt).toLocaleString()}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)]">
                  <form action={revokeAdminGrantAction}>
                    <input type="hidden" name="principalId" value={grant.principalId} />
                    <input type="hidden" name="scopePath" value={grant.scopePath} />
                    <button className="rounded-[var(--radius-sm)] border border-[var(--destructive)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--destructive)] hover:bg-[var(--muted)]">Revoke</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
