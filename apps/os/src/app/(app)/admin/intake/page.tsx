import { api, getCurrentActorPrincipalId } from "@/lib/api";
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
    if (!path || !body.trim()) throw new Error("Template path and markdown body are required");
    await saveWizardTemplateAction({ path, body });
  }

  return (
    <div className="space-y-[var(--space-6)]">
      <div>
        <h1 className="text-[var(--font-size-2xl)] font-semibold">Intake queue</h1>
        <div className="mt-1 text-[var(--font-size-sm)] text-[var(--muted-foreground)]">Global creation wizard review and template administration.</div>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Packets awaiting action</div>
        {packets.length === 0 ? (
          <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No packets awaiting review.</div>
        ) : (
          <table className="w-full text-left text-[var(--font-size-sm)]">
            <thead className="text-[var(--muted-foreground)]">
              <tr>
                <th className="pb-2">Scope</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Template</th>
                <th className="pb-2">Updated</th>
                <th className="pb-2">Open</th>
              </tr>
            </thead>
            <tbody>
              {packets.map((packet) => (
                <tr key={packet.id} className="border-t border-[var(--border)]">
                  <td className="py-2 font-mono text-xs">{packet.scopePath}</td>
                  <td className="py-2">{packet.status}</td>
                  <td className="py-2">{packet.templateSlug}</td>
                  <td className="py-2 text-[var(--muted-foreground)]">{new Date(packet.updatedAt).toLocaleString()}</td>
                  <td className="py-2">
                    <a className="text-[var(--primary)]" href={`/s/${packet.scopePath}?wizard=${packet.id}`}>Review</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-[360px_1fr]">
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
          <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Wizard templates</div>
          <div className="space-y-2">
            {templates.map((template) => (
              <div key={template.path} className="rounded border border-[var(--border)] p-2 text-[var(--font-size-sm)]">
                <div className="font-medium">{template.title}</div>
                <div className="mt-1 font-mono text-xs text-[var(--muted-foreground)]">{template.path}</div>
                {template.errors.length > 0 && <div className="mt-1 text-xs text-[var(--destructive)]">{template.errors.join("; ")}</div>}
              </div>
            ))}
          </div>
        </div>

        <form action={saveTemplate} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
          <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Commit template update</div>
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--muted-foreground)]">Path</span>
            <input name="path" className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-sm" placeholder="scope-intake/templates/new-project.md" />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-[var(--muted-foreground)]">Markdown</span>
            <textarea name="body" className="min-h-80 w-full rounded border border-[var(--border)] bg-[var(--background)] p-3 font-mono text-xs" />
          </label>
          <button type="submit" className="mt-3 rounded bg-[var(--primary)] px-3 py-2 text-[var(--font-size-sm)] text-[var(--primary-foreground)]">Save and sync</button>
        </form>
      </div>
    </div>
  );
}
