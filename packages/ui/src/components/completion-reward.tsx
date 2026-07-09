"use client";

import { useEffect, useState } from "react";
import { rm } from "../motion";

export interface CompletionRewardProps {
  active: boolean;
  checked: boolean;
  cheer: string;
  onConsumed?: () => void;
}

export function CompletionReward({ active, checked, cheer, onConsumed }: CompletionRewardProps) {
  const [showCheer, setShowCheer] = useState(active);

  useEffect(() => {
    if (!active) return;
    setShowCheer(true);
    const timeout = window.setTimeout(() => {
      setShowCheer(false);
      onConsumed?.();
    }, rm() ? 80 : 900);
    return () => window.clearTimeout(timeout);
  }, [active, onConsumed]);

  return (
    <span className="relative inline-grid h-5 w-5 shrink-0 place-items-center">
      <span
        className={`grid h-5 w-5 place-items-center rounded-full border border-[var(--borderstrong)] ${checked ? "bg-[var(--ok)] text-[var(--primaryfg)]" : "bg-[var(--surface)] text-transparent"} ${active && !rm() ? "animate-[popIn_160ms_ease-out,ringOut_620ms_ease-out_120ms]" : ""}`}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      {showCheer && !rm() ? (
        <span className="pointer-events-none absolute left-6 top-[-2px] whitespace-nowrap font-mono text-[var(--font-size-xs)] text-[var(--ok)] animate-[riseFade_820ms_ease-out_forwards]">
          {cheer}
        </span>
      ) : null}
    </span>
  );
}
