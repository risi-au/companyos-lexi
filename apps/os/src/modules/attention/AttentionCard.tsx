import Link from "next/link";
import type { AttentionItemView } from "@companyos/api";
import { resolveAttentionFormAction } from "./actions";
import { OpenQuestionResolveForm } from "./OpenQuestionResolveForm";
import { WikiQuestionSubmitButton } from "./WikiQuestionSubmitButton";
import { WikiQuestionForm } from "./WikiQuestionForm";
import { pagePreviewBody, parseWikiQuestionView, plainAttentionKindLabel, plainAttentionTitle } from "./wiki-question";

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

function wikiProposalSummary(item: AttentionItemView): string | null {
  if (item.kind !== "wiki_proposal" || !isRecord(item.payload)) return null;
  const title = String(item.payload.title ?? item.title).trim();
  const proposedMd = pagePreviewBody(String(item.payload.proposedMd ?? "")).replace(/\s+/g, " ").trim();
  const preview = proposedMd.length > 200 ? `${proposedMd.slice(0, 200).trimEnd()}...` : proposedMd;
  return `${title}${preview ? ` - ${preview}` : ""}`;
}

function pageUpdatePayload(item: AttentionItemView) {
  const payload = isRecord(item.payload) ? item.payload : {};
  const scopePath = String(payload.scopePath ?? item.scopePath);
  const slug = String(payload.slug ?? "");
  const title = String(payload.title ?? item.title).trim() || item.title;
  const eventType = String(payload.lastEventType ?? "doc.saved");
  const actorName = String(payload.lastActorName ?? "").trim();
  const changeCount = Math.max(1, Number(payload.changeCount ?? 1));
  return { scopePath, slug, title, eventType, actorName, changeCount };
}

function pageUpdateEventLabel(eventType: string, actorName: string): string {
  const by = actorName ? ` by ${actorName}` : "";
  if (eventType === "doc.verified") return `verified${by}`;
  if (eventType === "doc.archived") return "archived";
  if (eventType === "doc.renamed") return "renamed";
  if (eventType === "doc.reverted") return `reverted${by}`;
  return `edited${by}`;
}

function ResolveButtons({ item, scopePath }: { item: AttentionItemView; scopePath: string }) {
  const approve = item.kind === "wiki_proposal" ? "Apply update" : "Approve";
  const reject = item.kind === "wiki_proposal" ? "Keep current page" : "Reject";
  return (
    <div className="flex shrink-0 items-center gap-[var(--space-2)]">
      <form action={resolveAttentionFormAction}>
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="scopePath" value={scopePath} />
        <input type="hidden" name="resolution" value="approved" />
        <button type="submit" className="rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] font-medium text-[var(--primary-foreground)] hover:opacity-90">
          {approve}
        </button>
      </form>
      <form action={resolveAttentionFormAction}>
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="scopePath" value={scopePath} />
        <input type="hidden" name="resolution" value="rejected" />
        <button type="submit" className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] font-medium hover:bg-[var(--muted)]">
          {reject}
        </button>
      </form>
    </div>
  );
}

function docHref(scopePath: string, slug: string): string {
  return `/s/${scopePath}?tab=docs&doc=${encodeURIComponent(slug)}`;
}

function PreviewBlock({ label, body }: { label: string; body: string }) {
  const readableBody = pagePreviewBody(body);
  const preview = readableBody.length > 600 ? `${readableBody.slice(0, 600).trimEnd()}...` : readableBody;
  return (
    <div className="min-w-0 rounded border border-[var(--border)] bg-[var(--bg)] p-[var(--space-2)]">
      <div className="mb-1 text-[var(--font-size-xs)] font-medium text-[var(--muted-foreground)]">{label}</div>
      <div className="max-h-[180px] overflow-auto whitespace-pre-wrap break-words text-[var(--font-size-sm)] leading-5 text-[var(--foreground)]">{preview || "(empty page)"}</div>
    </div>
  );
}

function WikiQuestionPanel({ item, scopePath }: { item: AttentionItemView; scopePath: string }) {
  const question = parseWikiQuestionView(item);
  if (question.state === "v2-contradiction") {
    return (
      <div className="mt-[var(--space-3)] space-y-[var(--space-3)]">
        <div className="grid gap-[var(--space-2)] md:grid-cols-2">
          {question.claims.map((claim) => (
            <div key={claim.slug} className="rounded border border-[var(--border)] bg-[var(--bg)] p-[var(--space-3)]">
              <Link href={docHref(scopePath, claim.slug)} className="font-medium text-[var(--primary)] hover:underline">
                {claim.title}
              </Link>
              <blockquote className="mt-[var(--space-2)] border-l-2 border-[var(--border)] pl-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--foreground)]">
                {claim.quote}
              </blockquote>
            </div>
          ))}
        </div>
        <div className="text-[var(--font-size-sm)]">
          <span className="font-medium">Why this matters: </span>
          <span className="text-[var(--muted-foreground)]">{question.explanation}</span>
        </div>
        <WikiQuestionForm className="space-y-[var(--space-3)]">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="scopePath" value={scopePath} />
          <input type="hidden" name="wikiAction" value="choose" />
          <fieldset className="space-y-[var(--space-3)]">
            <legend className="mb-[var(--space-2)] text-[var(--font-size-sm)] font-medium">Choose what the wiki should say</legend>
            {question.choices.map((choice) => (
              <label key={choice.id} className="block cursor-pointer rounded border border-[var(--border)] p-[var(--space-3)] focus-within:border-[var(--primary)] focus-within:ring-2 focus-within:ring-[var(--ring)]">
                <span className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)] font-medium">
                  <input type="radio" name="choiceId" value={choice.id} defaultChecked={choice.id === "first"} required />
                  <span>{choice.label}</span>
                </span>
                <div className="grid gap-[var(--space-2)] md:grid-cols-2">
                  <PreviewBlock label="Current page" body={choice.repair.currentMd} />
                  <PreviewBlock label="After correction" body={choice.repair.proposedMd} />
                </div>
              </label>
            ))}
          </fieldset>
          <WikiQuestionSubmitButton pendingLabel="Applying correction..." className="rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:cursor-wait disabled:opacity-60">
            Apply this correction
          </WikiQuestionSubmitButton>
        </WikiQuestionForm>
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <span className="text-[var(--font-size-xs)] font-medium text-[var(--muted-foreground)]">Open pages to compare:</span>
          {question.claims.map((claim) => (
            <Link key={claim.slug} href={docHref(scopePath, claim.slug)} className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] font-medium hover:bg-[var(--muted)]">
              Open {claim.title}
            </Link>
          ))}
          <WikiQuestionForm className="flex flex-wrap items-end gap-[var(--space-2)]">
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="scopePath" value={scopePath} />
            <input type="hidden" name="wikiAction" value="not-a-conflict" />
            <label className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
              Why these statements can both be correct
              <input name="note" type="text" required minLength={3} maxLength={500} className="mt-1 block min-h-[32px] min-w-[240px] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--foreground)]" />
            </label>
            <WikiQuestionSubmitButton pendingLabel="Saving explanation..." className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] font-medium hover:bg-[var(--muted)] disabled:cursor-wait disabled:opacity-60">
              Not a conflict
            </WikiQuestionSubmitButton>
          </WikiQuestionForm>
        </div>
      </div>
    );
  }

  if (question.state === "v2-stale") {
    return (
      <div className="mt-[var(--space-3)] flex flex-wrap items-end gap-[var(--space-2)]">
        <Link href={docHref(scopePath, question.slug)} className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] font-medium hover:bg-[var(--muted)]">
          Open page
        </Link>
        <WikiQuestionForm className="flex flex-wrap items-end gap-[var(--space-2)]">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="scopePath" value={scopePath} />
          <input type="hidden" name="wikiAction" value="mark-current" />
          <label className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
            Next review date
            <input name="nextReviewAt" type="date" required className="mt-1 block min-h-[32px] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--foreground)]" />
          </label>
          <WikiQuestionSubmitButton pendingLabel="Updating page..." className="rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:cursor-wait disabled:opacity-60">
            Mark as current
          </WikiQuestionSubmitButton>
        </WikiQuestionForm>
        <span className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Review was due {new Date(question.reviewDueAt).toLocaleDateString()}</span>
      </div>
    );
  }

  return (
    <div className="mt-[var(--space-3)] flex flex-wrap items-center gap-[var(--space-2)]">
      {question.pages.map((page) => (
        <Link key={page.slug} href={docHref(scopePath, page.slug)} className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] font-medium hover:bg-[var(--muted)]">
          {page.title}
        </Link>
      ))}
      <WikiQuestionForm>
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="scopePath" value={scopePath} />
        <input type="hidden" name="wikiAction" value="close-unclear" />
        <WikiQuestionSubmitButton pendingLabel="Closing question..." className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] font-medium hover:bg-[var(--muted)] disabled:cursor-wait disabled:opacity-60">
          Close as unclear
        </WikiQuestionSubmitButton>
      </WikiQuestionForm>
    </div>
  );
}

function DismissButton({ item, scopePath }: { item: AttentionItemView; scopePath: string }) {
  return (
    <form action={resolveAttentionFormAction}>
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="scopePath" value={scopePath} />
      <input type="hidden" name="resolution" value="dismissed" />
      <button type="submit" className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] font-medium hover:bg-[var(--muted)]">
        Dismiss
      </button>
    </form>
  );
}

export function AttentionCard({ items, scopePath }: { items: AttentionItemView[]; scopePath: string }) {
  const decisionItems = items.filter((item) => item.kind !== "page_update");
  const followingItems = items.filter((item) => item.kind === "page_update");

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] lg:col-span-2">
      <div className="mb-[var(--space-3)] flex items-center justify-between">
        <div className="text-[var(--font-size-sm)] font-medium">Things to resolve</div>
        <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{items.length} open</div>
      </div>
      {items.length === 0 ? (
        <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">Nothing needs you.</div>
      ) : (
        <div className="space-y-[var(--space-4)]">
          {decisionItems.length > 0 && (
            <ul className="space-y-[var(--space-2)]">
              {decisionItems.map((item) => {
                const summary = item.kind === "lint_finding" ? null : wikiProposalSummary(item) ?? item.summary;
                const title = plainAttentionTitle(item);
                return (
                  <li key={item.id} className="rounded border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]">
                    <div className="flex flex-wrap items-start justify-between gap-[var(--space-2)]">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                          <span className="rounded-[var(--radius-sm)] bg-[var(--muted)] px-[var(--space-1)] py-px text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                            {plainAttentionKindLabel(item)}
                          </span>
                          <span className="font-medium">{title}</span>
                          <span className="font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{ageLabel(item.createdAt)}</span>
                        </div>
                        {summary && (
                          <div className="mt-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                            {summary}
                          </div>
                        )}
                      </div>
                      {item.status === "open" ? item.kind === "lint_finding" ? null : item.kind === "open_question" ? (
                        <OpenQuestionResolveForm itemId={item.id} scopePath={scopePath} />
                      ) : item.kind === "connection_expiry" ? (
                        <DismissButton item={item} scopePath={scopePath} />
                      ) : (
                        <ResolveButtons item={item} scopePath={scopePath} />
                      ) : null}
                    </div>
                    {item.status === "open" && item.kind === "lint_finding" ? (
                      <WikiQuestionPanel item={item} scopePath={scopePath} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {followingItems.length > 0 && (
            <section className="space-y-[var(--space-2)]">
              <div className="border-t border-[var(--border)] pt-[var(--space-3)] text-[var(--font-size-xs)] font-medium uppercase text-[var(--muted-foreground)]">
                Notifications on
              </div>
              <ul className="space-y-[var(--space-2)]">
                {followingItems.map((item) => {
                  const payload = pageUpdatePayload(item);
                  const href = `/s/${payload.scopePath}?tab=docs${payload.slug ? `&doc=${encodeURIComponent(payload.slug)}` : ""}`;
                  return (
                    <li key={item.id} className="rounded border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]">
                      <div className="flex flex-wrap items-start justify-between gap-[var(--space-2)]">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                            <Link href={href} className="font-medium text-[var(--primary)] hover:underline">
                              {payload.title}
                            </Link>
                            <span className="font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{ageLabel(item.updatedAt)}</span>
                          </div>
                          <div className="mt-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                            {pageUpdateEventLabel(payload.eventType, payload.actorName)}
                            {payload.changeCount > 1 ? ` - ${payload.changeCount} changes since you last looked` : ""}
                          </div>
                        </div>
                        {item.status === "open" && <DismissButton item={item} scopePath={scopePath} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
