"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const MOBILE_QUERY = "(max-width: 820px)";

interface AppShellChromeProps {
  instanceName: string;
  sidebar: React.ReactNode;
  userMenu: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Client shell chrome: owns the mobile-drawer open/close state and renders the
 * burger toggle + <aside> + scrim. The server layout keeps data fetching and
 * passes the rendered sidebar/user-menu/children through as props.
 *
 * Below 820px the <aside> is a slide-in drawer (plain CSS transform transition,
 * 280ms) with an --overlay scrim; at ≥820px the drawer classes are inert and the
 * aside is the normal fixed column.
 */
export function AppShellChrome({ instanceName, sidebar, userMenu, children }: AppShellChromeProps) {
  const [open, setOpen] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // Esc closes; move focus into the drawer on open; lock body scroll while open on mobile.
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);

    const first = asideRef.current?.querySelector<HTMLElement>(focusableSelector);
    first?.focus();

    const isMobile = typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;
    const previousOverflow = document.body.style.overflow;
    if (isMobile) document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  // Close the drawer whenever a nav item (link) or the project-switcher form is activated.
  function handleAsideClick(event: React.MouseEvent<HTMLElement>) {
    if (!open) return;
    const target = event.target as HTMLElement;
    if (target.closest("a") || target.closest("button[type='submit']")) {
      close();
    }
  }

  return (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      {open && (
        <div
          aria-hidden="true"
          onClick={close}
          className="fixed inset-0 z-40 hidden bg-[var(--overlay)] max-[820px]:block"
        />
      )}

      <aside
        ref={asideRef}
        onClick={handleAsideClick}
        id="app-sidebar"
        className={`flex w-64 flex-col border-r border-[var(--border)] bg-[var(--sidebar)] max-[820px]:fixed max-[820px]:inset-y-0 max-[820px]:left-0 max-[820px]:z-50 max-[820px]:w-[280px] max-[820px]:shadow-[var(--shadow)] max-[820px]:transition-transform max-[820px]:duration-[280ms] max-[820px]:ease-out ${
          open ? "max-[820px]:translate-x-0" : "max-[820px]:-translate-x-full"
        }`}
      >
        <div className="border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
          <div className="text-[var(--font-size-lg)] font-semibold tracking-[-0.01em]">{instanceName}</div>
          <div className="text-[var(--font-size-xs)] text-[var(--mutedfg)]">ops record</div>
        </div>

        {sidebar}

        <div className="mt-auto border-t border-[var(--border)] p-[var(--space-3)]">{userMenu}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[var(--space-12)] items-center gap-[var(--space-2)] border-b border-[var(--border)] px-[var(--space-4)] text-[var(--font-size-sm)] text-[var(--mutedfg)]">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            aria-expanded={open}
            aria-controls="app-sidebar"
            className="hidden items-center justify-center rounded-[var(--radius-3)] p-[var(--space-1)] text-[var(--fg)] hover:bg-[var(--hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] max-[820px]:inline-flex"
          >
            <Menu size={18} />
          </button>
          {/* Breadcrumb rendered by page for active scope; placeholder */}
          <div className="text-[var(--font-size-xs)]">Scope</div>
        </header>
        <main className="flex-1 overflow-auto p-[var(--space-4)]">{children}</main>
      </div>
    </div>
  );
}
