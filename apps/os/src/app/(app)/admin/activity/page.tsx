import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { EmptyState, Table } from "@companyos/ui";
import { Activity } from "lucide-react";

export default async function AdminActivityPage() {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;
  const events = await api.listAdminActivity({ limit: 100 }, actor);
  return (
    <Table
      rows={events}
      minWidth="860px"
      getRowKey={(event) => String(event.id)}
      empty={<EmptyState icon={<Activity size={16} />} title="No activity recorded" body="Audit events will appear here after users or agents make changes." />}
      columns={[
        { key: "time", header: "Time", className: "tabular-nums", cell: (event) => new Date(event.createdAt).toLocaleString() },
        { key: "type", header: "Type", className: "font-mono text-[var(--font-size-xs)]", cell: (event) => event.type },
        { key: "principal", header: "Who", className: "font-mono text-[var(--font-size-xs)]", cell: (event) => event.principalId ?? "-" },
        { key: "payload", header: "Details", cell: (event) => <pre className="max-w-xl overflow-auto whitespace-pre-wrap text-[var(--font-size-xs)]">{JSON.stringify(event.payload, null, 2)}</pre> },
      ]}
    />
  );
}
