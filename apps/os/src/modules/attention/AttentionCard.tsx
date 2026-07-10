import type { AttentionItemView } from "@companyos/api";
import { resolveAttentionFormAction } from "./actions";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function ageLabel(value: Date | string): string {
  const created = value instanceof Date ? value : new Date(value);
  const diffMs = Date.now() - created.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function kindLabel(kind: AttentionItemView["kind"]): string {
  if (kind === "wiki_proposal") return "wiki proposal";
  if (kind === "lint_finding") return "lint finding";
  if (kind === "external_gate") return "external gate";
  return "graduation";
}

function wikiProposalSummary(item: AttentionItemView): string | null {
  if (item.kind !== "wiki_proposal" || !isRecord(item.payload)) return null;
  const slug = String(item.payload.slug ?? "").trim();
  const title = String(item.payload.title ?? item.title).trim();
  const proposedMd = String(item.payload.proposedMd ?? "").replace(/\s+/g, " ").trim();
  const preview = proposedMd.length > 200 ? `${proposedMd.slice(0, 200).trimEnd()}...` : proposedMd;
  return `${title}${slug ? ` / ${slug}` : ""}${preview ? ` - ${preview}` : ""}`;
}

export function AttentionCard({ items, scopePath }: { items: AttentionItemView[]; scopePath: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] lg:col-span-2">
      <div className="mb-[var(--space-3)] flex items-center justify-between">
        <div className="text-[var(--font-size-sm)] font-medium">Things to resolve</div>
        <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{items.length} open</div>
      </div>
      {items.length === 0 ? (
        <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">Nothing needs you.</div>
      ) : (
        <ul className="space-y-[var(--space-2)]">
          {items.map((item) => {
            const summary = wikiProposalSummary(item) ?? item.summary;
            return (
              <li key={item.id} className="rounded border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]">
                <div className="flex flex-wrap items-start justify-between gap-[var(--space-2)]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                      <span className="rounded-[var(--radius-sm)] bg-[var(--muted)] px-[var(--space-1)] py-px text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                        {kindLabel(item.kind)}
                      </span>
                      <span className="font-medium">{item.title}</span>
                      <span className="font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{ageLabel(item.createdAt)}</span>
                    </div>
                    {summary && (
                      <div className="mt-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                        {summary}
                      </div>
                    )}
                  </div>
                  {item.status === "open" && (
                    <div className="flex shrink-0 items-center gap-[var(--space-2)]">
                      <form action={resolveAttentionFormAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="scopePath" value={scopePath} />
                        <input type="hidden" name="resolution" value="approved" />
                        <button type="submit" className="rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] font-medium text-[var(--primary-foreground)] hover:opacity-90">
                          Approve
                        </button>
                      </form>
                      <form action={resolveAttentionFormAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="scopePath" value={scopePath} />
                        <input type="hidden" name="resolution" value="rejected" />
                        <button type="submit" className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] font-medium hover:bg-[var(--muted)]">
                          Reject
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
