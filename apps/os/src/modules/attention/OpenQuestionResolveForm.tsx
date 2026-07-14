"use client";

import { useState } from "react";
import { resolveAttentionFormAction } from "./actions";

export function OpenQuestionResolveForm({ itemId, scopePath }: { itemId: string; scopePath: string }) {
  const [note, setNote] = useState("");

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-[var(--space-2)]">
      <form action={resolveAttentionFormAction} className="flex items-center gap-[var(--space-2)]">
        <input type="hidden" name="id" value={itemId} />
        <input type="hidden" name="scopePath" value={scopePath} />
        <input type="hidden" name="resolution" value="approved" />
        <input
          name="note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          required
          placeholder="Answer..."
          aria-label="Answer open question"
          className="min-h-[32px] w-[180px] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        />
        <button
          type="submit"
          disabled={!note.trim()}
          className="rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Answer
        </button>
      </form>
      <form action={resolveAttentionFormAction}>
        <input type="hidden" name="id" value={itemId} />
        <input type="hidden" name="scopePath" value={scopePath} />
        <input type="hidden" name="resolution" value="rejected" />
        <button type="submit" className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] font-medium hover:bg-[var(--muted)]">
          Reject
        </button>
      </form>
    </div>
  );
}
