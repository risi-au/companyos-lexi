import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { labelForIntakeStatus } from "@/lib/labels";
import { Card, EmptyState, Table } from "@companyos/ui";
import { FileText } from "lucide-react";
import { saveWizardTemplateAction } from "@/modules/intake/actions";

export default async function AdminIntakePage() {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;

  const [packets, templates] = await Promise.all([
    api.listIntakePackets({ statuses: ["awaiting_external", "needs_review", "approved"], limit: 100 }, actor),
    api.listWizardTemplates(actor),
  ]);

  async function saveTemplate(formData: FormData) {
    "use server";
    const path = String(formData.get("path") || "").trim();
    const body = String(formData.get("body") || "");
    if (!path || !body.trim()) throw new Error("Add both a path and the template content.");
    await saveWizardTemplateAction({ path, body });
  }

  return (
    <div className="space-y-[var(--space-6)]">
      <div>
        <h1 className="text-[var(--font-size-2xl)] font-semibold">Setup queue</h1>
        <div className="mt-1 text-[var(--font-size-sm)] text-[var(--muted-foreground)]">Setups waiting on review, and the interview templates.</div>
      </div>

      <Card>
        <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Waiting on review</div>
        <Table
          rows={packets}
          getRowKey={(packet) => packet.id}
          empty={<EmptyState icon={<FileText size={16} />} title="Nothing waiting on review" body="Submitted setups appear here when they need review." />}
          columns={[
            { key: "scope", header: "Project path", className: "font-mono text-[var(--font-size-xs)]", cell: (packet) => packet.scopePath },
            { key: "status", header: "Status", cell: (packet) => labelForIntakeStatus(packet.status) },
            { key: "template", header: "Template", cell: (packet) => packet.templateSlug },
            { key: "updated", header: "Updated", cell: (packet) => new Date(packet.updatedAt).toLocaleString() },
            { key: "open", header: "Open", cell: (packet) => <a className="text-[var(--primary)]" href={`/s/${packet.scopePath}?wizard=${packet.id}`}>Review</a> },
          ]}
        />
      </Card>

      <div className="grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-[360px_1fr]">
        <Card>
          <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Setup templates</div>
          <div className="space-y-2">
            {templates.map((template) => (
              <div key={template.path} className="rounded border border-[var(--border)] p-2 text-[var(--font-size-sm)]">
                <div className="font-medium">{template.title}</div>
                <div className="mt-1 font-mono text-xs text-[var(--muted-foreground)]">{template.path}</div>
                {template.errors.length > 0 && <div className="mt-1 text-xs text-[var(--destructive)]">{template.errors.join("; ")}</div>}
              </div>
            ))}
            {templates.length === 0 ? <EmptyState icon={<FileText size={16} />} title="No setup templates" body="Templates synced from the skills repo appear here." /> : null}
          </div>
        </Card>

        <form action={saveTemplate} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
          <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Edit template</div>
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--muted-foreground)]">Path</span>
            <input name="path" className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-sm" placeholder="scope-intake/templates/new-project.md" />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-[var(--muted-foreground)]">Markdown</span>
            <textarea name="body" className="min-h-80 w-full rounded border border-[var(--border)] bg-[var(--background)] p-3 font-mono text-xs" />
          </label>
          <div className="mt-2 text-xs text-[var(--muted-foreground)]">Syncs to the skills repo on save.</div>
          <button type="submit" className="mt-3 rounded bg-[var(--primary)] px-3 py-2 text-[var(--font-size-sm)] text-[var(--primary-foreground)]">Save template</button>
        </form>
      </div>
    </div>
  );
}
