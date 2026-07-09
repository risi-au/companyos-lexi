import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { EmptyState, Table } from "@companyos/ui";
import { Shield } from "lucide-react";
import { ConfirmSubmitButton } from "@/modules/admin/ConfirmSubmitButton";
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
      <Table
        rows={grants}
        minWidth="860px"
        getRowKey={(grant) => grant.grantId}
        empty={<EmptyState icon={<Shield size={16} />} title="No grants yet" body="Grant a user or agent access to a scope from the form above." />}
        columns={[
          {
            key: "principal",
            header: "Principal",
            cell: (grant) => (
              <>
                <div>{grant.principalName}</div>
                <div className="text-[var(--font-size-xs)] text-[var(--mutedfg)]">{grant.principalEmail ?? grant.principalId}</div>
              </>
            ),
          },
          { key: "scope", header: "Scope", className: "font-mono text-[var(--font-size-xs)]", cell: (grant) => grant.scopePath },
          { key: "role", header: "Role", cell: (grant) => grant.role },
          { key: "created", header: "Created", cell: (grant) => new Date(grant.createdAt).toLocaleString() },
          {
            key: "action",
            header: "Action",
            cell: (grant) => (
              <form action={revokeAdminGrantAction}>
                <input type="hidden" name="principalId" value={grant.principalId} />
                <input type="hidden" name="scopePath" value={grant.scopePath} />
                <ConfirmSubmitButton
                  title={`Revoke ${grant.principalName}'s grant?`}
                  body={`This removes access to ${grant.scopePath} for this principal and its subtree.`}
                  confirmLabel="Revoke grant"
                  className="rounded-[var(--radius-3)] border border-[var(--err)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--err)] hover:bg-[var(--hover)]"
                >
                  Revoke
                </ConfirmSubmitButton>
              </form>
            ),
          },
        ]}
      />
    </div>
  );
}
