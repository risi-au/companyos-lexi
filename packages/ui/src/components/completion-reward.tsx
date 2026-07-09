"use client";

import { rm } from "../motion";
import "../motion.css";

export interface CompletionRewardProps {
  active: boolean;
  checked: boolean;
}

export function CompletionReward({ active, checked }: CompletionRewardProps) {
  return (
    <span className="relative inline-grid h-5 w-5 shrink-0 place-items-center">
      <span
        className={`grid h-5 w-5 place-items-center rounded-full border border-[var(--borderstrong)] ${checked ? "bg-[var(--ok)] text-[var(--primaryfg)]" : "bg-[var(--surface)] text-transparent"} ${active && !rm() ? "completion-pop" : ""}`}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    </span>
  );
}