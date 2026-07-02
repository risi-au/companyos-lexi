"use client";

import React, { useState } from "react";
import { AgentChatPanel } from "./AgentChatPanel";

export function AskOSButton({ scopePath }: { scopePath: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] hover:bg-[var(--muted)]"
        title="Open resident agent chat"
      >
        Ask OS
      </button>
      <AgentChatPanel scopePath={scopePath} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
