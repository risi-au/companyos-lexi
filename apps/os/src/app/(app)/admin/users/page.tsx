import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { UserCreateForm } from "@/modules/admin/UserCreateForm";
import { disableAdminUserAction, resetAdminUserTempPasswordAction } from "@/modules/admin/actions";

export default async function AdminUsersPage() {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;
  const users = await api.listAdminUsers(actor);

  return (
    <div className="grid grid-cols-1 gap-[var(--space-4)] xl:grid-cols-[360px_1fr]">
      <UserCreateForm />
      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[900px] text-left text-[var(--font-size-sm)]">
          <thead className="border-b border-[var(--border)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
            <tr>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">User</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Status</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Password</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Grants</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.authUserId} className="border-b border-[var(--border)] last:border-b-0">
                <td className="px-[var(--space-3)] py-[var(--space-2)]">
                  <div className="font-medium">{user.name}</div>
                  <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{user.email}</div>
                </td>
                <td className="px-[var(--space-3)] py-[var(--space-2)]">{user.principalStatus ?? "unlinked"}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)]">{user.forcePasswordChange ? "change required" : "normal"}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)]">
                  <div className="space-y-1">
                    {user.grants.map((grant) => (
                      <div key={`${grant.scopePath}:${grant.role}`} className="font-mono text-[var(--font-size-xs)]">{grant.scopePath}:{grant.role}</div>
                    ))}
                    {user.grants.length === 0 ? <span className="text-[var(--muted-foreground)]">none</span> : null}
                  </div>
                </td>
                <td className="px-[var(--space-3)] py-[var(--space-2)]">
                  <div className="flex flex-wrap gap-[var(--space-2)]">
                    <form action={resetAdminUserTempPasswordAction}>
                      <input type="hidden" name="authUserId" value={user.authUserId} />
                      <button className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] hover:bg-[var(--muted)]">Reset temp</button>
                    </form>
                    <form action={disableAdminUserAction}>
                      <input type="hidden" name="authUserId" value={user.authUserId} />
                      <button className="rounded-[var(--radius-sm)] border border-[var(--destructive)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--destructive)] hover:bg-[var(--muted)]">Disable</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 ? (
              <tr><td colSpan={5} className="px-[var(--space-3)] py-[var(--space-4)] text-[var(--muted-foreground)]">No users.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
