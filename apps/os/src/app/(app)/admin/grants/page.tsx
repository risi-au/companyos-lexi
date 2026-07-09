import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { labelForRole } from "@/lib/labels";
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
        <select name="principalId" required aria-label="Person or agent" className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]">
          <option value="">Person or agent</option>
          {principals.map((principal) => <option key={principal.id} value={principal.id}>{principal.name} {principal.email ? `(${principal.email})` : ""}</option>)}
        </select>
        <input name="scopePath" defaultValue="root" aria-label="Project path" className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-sm)]" />
        <select name="role" defaultValue="viewer" aria-label="Role" className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]">
          <option value="viewer">{labelForRole("viewer")}</option>
          <option value="editor">{labelForRole("editor")}</option>
          <option value="admin">{labelForRole("admin")}</option>
          <option value="owner">{labelForRole("owner")}</option>
          <option value="agent">{labelForRole("agent")}</option>
        </select>
        <button className="rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--primary-foreground)]">Grant access</button>
      </form>
      <Table
        rows={grants}
        minWidth="860px"
        getRowKey={(grant) => grant.grantId}
        empty={<EmptyState icon={<Shield size={16} />} title="No access yet" body="Give a person or agent access to a project from the form above." />}
        columns={[
          {
            key: "principal",
            header: "Who",
            cell: (grant) => (
              <>
                <div>{grant.principalName}</div>
                <div className="text-[var(--font-size-xs)] text-[var(--mutedfg)]">{grant.principalEmail ?? grant.principalId}</div>
              </>
            ),
          },
          { key: "scope", header: "Project path", className: "font-mono text-[var(--font-size-xs)]", cell: (grant) => grant.scopePath },
          { key: "role", header: "Role", cell: (grant) => labelForRole(grant.role) },
          { key: "created", header: "Created", cell: (grant) => new Date(grant.createdAt).toLocaleString() },
          {
            key: "action",
            header: "Action",
            cell: (grant) => (
              <form action={revokeAdminGrantAction}>
                <input type="hidden" name="principalId" value={grant.principalId} />
                <input type="hidden" name="scopePath" value={grant.scopePath} />
                <ConfirmSubmitButton
                  title="Remove access"
                  body={`This removes ${grant.principalName}'s access to ${grant.scopePath} and everything under it.`}
                  confirmLabel="Remove access"
                  className="rounded-[var(--radius-3)] border border-[var(--err)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--err)] hover:bg-[var(--hover)]"
                >
                  Remove access
                </ConfirmSubmitButton>
              </form>
            ),
          },
        ]}
      />
    </div>
  );
}
