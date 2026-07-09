import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { labelForPasswordState, labelForPrincipalStatus, labelForRole } from "@/lib/labels";
import { EmptyState, Table } from "@companyos/ui";
import { Users } from "lucide-react";
import { ConfirmSubmitButton } from "@/modules/admin/ConfirmSubmitButton";
import { UserCreateForm } from "@/modules/admin/UserCreateForm";
import { disableAdminUserAction, resetAdminUserTempPasswordAction } from "@/modules/admin/actions";

export default async function AdminUsersPage() {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;
  const users = await api.listAdminUsers(actor);

  return (
    <div className="grid grid-cols-1 gap-[var(--space-4)] xl:grid-cols-[360px_1fr]">
      <UserCreateForm />
      <Table
        rows={users}
        minWidth="900px"
        getRowKey={(user) => user.authUserId}
        empty={<EmptyState icon={<Users size={16} />} title="No users yet" body="Create the first user from the form beside this table." />}
        columns={[
          {
            key: "user",
            header: "User",
            cell: (user) => (
              <>
                <div className="font-medium">{user.name}</div>
                <div className="text-[var(--font-size-xs)] text-[var(--mutedfg)]">{user.email}</div>
              </>
            ),
          },
          { key: "status", header: "Status", cell: (user) => labelForPrincipalStatus(user.principalStatus) },
          { key: "password", header: "Password", cell: (user) => labelForPasswordState(user.forcePasswordChange) },
          {
            key: "grants",
            header: "Grants",
            cell: (user) => (
              <div className="space-y-1">
                {user.grants.map((grant) => (
                  <div key={`${grant.scopePath}:${grant.role}`} className="text-[var(--font-size-xs)]">{grant.scopePath}: {labelForRole(grant.role)}</div>
                ))}
                {user.grants.length === 0 ? <span className="text-[var(--mutedfg)]">none</span> : null}
              </div>
            ),
          },
          {
            key: "actions",
            header: "Actions",
            cell: (user) => (
              <div className="flex flex-wrap gap-[var(--space-2)]">
                <form action={resetAdminUserTempPasswordAction}>
                  <input type="hidden" name="authUserId" value={user.authUserId} />
                  <ConfirmSubmitButton
                    title="New temporary password"
                    body="This creates a new temporary password and forces a password change on next sign-in."
                    confirmLabel="Issue password"
                    className="rounded-[var(--radius-3)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] hover:bg-[var(--hover)]"
                  >
                    Issue new temporary password
                  </ConfirmSubmitButton>
                </form>
                <form action={disableAdminUserAction}>
                  <input type="hidden" name="authUserId" value={user.authUserId} />
                  <ConfirmSubmitButton
                    title={`Disable ${user.name}?`}
                    body="They lose access immediately. Existing grants stay recorded for audit and later review."
                    confirmLabel="Disable user"
                    className="rounded-[var(--radius-3)] border border-[var(--err)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--err)] hover:bg-[var(--hover)]"
                  >
                    Disable
                  </ConfirmSubmitButton>
                </form>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
