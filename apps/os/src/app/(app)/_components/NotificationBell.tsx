"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { refreshNotificationsAction, type NotificationItem } from "./notification-actions";

const KIND_LABELS: Record<string, string> = {
  open_question: "Open question",
  wiki_proposal: "Wiki proposal",
  graduation: "Graduation",
  lint_finding: "Lint finding",
  page_update: "Page update",
  external_gate: "External gate",
};

function ageLabel(value: string): string {
  const created = new Date(value).getTime();
  if (!Number.isFinite(created)) return "recently";
  const minutes = Math.max(0, Math.floor((Date.now() - created) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replaceAll("_", " ");
}

export function NotificationBell({ initialItems, initialTotal }: { initialItems: NotificationItem[]; initialTotal: number }) {
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const firstItemRef = useRef<HTMLAnchorElement | null>(null);

  // Server actions (e.g. resolving an attention item) revalidate the layout and
  // re-render this component with fresh props; without this sync the badge would
  // stay stale until the next poll or window refocus.
  const [prevInitialItems, setPrevInitialItems] = useState(initialItems);
  const [prevInitialTotal, setPrevInitialTotal] = useState(initialTotal);
  if (initialItems !== prevInitialItems || initialTotal !== prevInitialTotal) {
    setPrevInitialItems(initialItems);
    setPrevInitialTotal(initialTotal);
    setItems(initialItems);
    setTotal(initialTotal);
  }

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    const refresh = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const next = await refreshNotificationsAction();
        if (!active) return;
        setItems(next.items);
        setTotal(next.total);
      } catch {
        /* Keep the last successful notification snapshot. */
      }
    };
    const onFocus = () => void refresh();
    const startTimer = () => {
      if (timer === null && document.visibilityState !== "hidden") {
        timer = window.setInterval(() => void refresh(), 60_000);
      }
    };
    const stopTimer = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") stopTimer();
      else startTimer();
    };
    startTimer();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      stopTimer();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    window.setTimeout(() => firstItemRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const badge = total > 9 ? "9+" : String(total);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Things to resolve"
        aria-expanded={open}
        aria-controls="notifications-panel"
        className="relative inline-flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-[var(--radius-3)] text-[var(--mutedfg)] hover:bg-[var(--hover)] hover:text-[var(--fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
      >
        <Bell size={16} />
        {total > 0 ? (
          <span aria-hidden="true" className="absolute -right-[3px] -top-[3px] min-w-[15px] rounded-full bg-[var(--primary)] px-1 text-center text-[10px] font-semibold leading-[15px] text-[var(--primaryfg)]">
            {badge}
          </span>
        ) : null}
      </button>
      {open ? (
        <div id="notifications-panel" role="dialog" aria-label="Things to resolve" className="absolute right-0 top-[38px] z-[90] w-[min(360px,calc(100vw-32px))] rounded-[var(--radius-4)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-2)] shadow-[var(--shadow)]">
          <div className="flex items-center justify-between gap-2 px-[var(--space-2)] py-[var(--space-1)]">
            <span className="text-[var(--font-size-sm)] font-medium">Things to resolve</span>
            <span className="font-mono text-[var(--font-size-xs)] text-[var(--mutedfg)]">{total} open</span>
          </div>
          {items.length > 0 ? (
            <div className="mt-1 max-h-[min(420px,70vh)] overflow-auto">
              {items.map((item, index) => (
                <Link
                  key={item.id}
                  ref={index === 0 ? firstItemRef : undefined}
                  href={`/s/${item.scopePath}?tab=overview`}
                  onClick={() => setOpen(false)}
                  className="block rounded-[var(--radius-3)] px-[var(--space-2)] py-[var(--space-2)] hover:bg-[var(--hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--primary)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate text-[var(--font-size-sm)] font-medium text-[var(--fg)]">{item.title}</span>
                    <span className="shrink-0 font-mono text-[var(--font-size-xs)] text-[var(--mutedfg)]">{ageLabel(item.createdAt)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[var(--font-size-xs)] text-[var(--mutedfg)]">
                    <span>{kindLabel(item.kind)}</span>
                    <span className="max-w-[170px] truncate rounded-full bg-[var(--muted)] px-2 py-px">{item.scopePath}</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="px-[var(--space-2)] py-[var(--space-4)] text-[var(--font-size-sm)] text-[var(--mutedfg)]">Nothing needs you.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
