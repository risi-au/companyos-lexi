"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Activity, BrainCircuit, Menu, Shield } from "lucide-react";
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
  clampSidebarWidth,
  parseStoredSidebarWidth,
} from "./sidebar-state";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const MOBILE_QUERY = "(max-width: 820px)";
const FONT_SCALE_KEY = "fontScale";
const THEME_KEY = "theme";
const BASE_FONT_SIZE = 14;
const THEME_CHOICES = [
  { id: "auto", title: "Auto (Circadian)", swatch: "theme-swatch-auto" },
  { id: "light", title: "Light - Terrazzo Quiet", swatch: "theme-swatch-light" },
  { id: "green", title: "Dark - Green Hall", swatch: "theme-swatch-green" },
  { id: "charcoal", title: "Dark - Charcoal", swatch: "theme-swatch-charcoal" },
] as const;

type ThemeChoice = (typeof THEME_CHOICES)[number]["id"];
type ConcreteTheme = Exclude<ThemeChoice, "auto">;

interface SidebarDrawerContextValue {
  closeDrawer: () => void;
}

const SidebarDrawerContext = createContext<SidebarDrawerContextValue>({ closeDrawer: () => {} });

export function useSidebarDrawer() {
  return useContext(SidebarDrawerContext);
}

interface AppShellChromeProps {
  instanceName: string;
  sidebar: React.ReactNode;
  userMenu: React.ReactNode;
  alertCount?: number;
  children: React.ReactNode;
}

export function AppShellChrome({ instanceName, sidebar, userMenu, alertCount = 0, children }: AppShellChromeProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null);
  const section = getHeaderSection(pathname, instanceName);

  const close = useCallback(() => setOpen(false), []);
  const setClampedSidebarWidth = useCallback((value: number) => {
    const clamped = clampSidebarWidth(value);
    sidebarWidthRef.current = clamped;
    setSidebarWidth(clamped);
    return clamped;
  }, []);

  const persistSidebarWidth = useCallback((value: number) => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(value)));
    } catch {
      /* ignore storage errors */
    }
  }, []);

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

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const syncViewport = () => setIsMobileViewport(media.matches);
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    try {
      setClampedSidebarWidth(parseStoredSidebarWidth(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)));
    } catch {
      setClampedSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
    }
  }, [setClampedSidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onPointerMove = (event: PointerEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      setClampedSidebarWidth(start.width + event.clientX - start.x);
    };

    const onPointerUp = () => {
      persistSidebarWidth(sidebarWidthRef.current);
      setIsResizing(false);
      resizeStartRef.current = null;
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing, persistSidebarWidth, setClampedSidebarWidth]);

  function handleAsideClick(event: React.MouseEvent<HTMLElement>) {
    if (!open) return;
    const target = event.target as HTMLElement;
    if (target.closest("a") || target.closest("button[type='submit']")) {
      close();
    }
  }

  function startSidebarResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    resizeStartRef.current = { x: event.clientX, width: sidebarWidthRef.current };
    setIsResizing(true);
  }

  function resetSidebarWidth() {
    setClampedSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
    persistSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
  }

  function handleResizeKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -12 : 12;
      persistSidebarWidth(setClampedSidebarWidth(sidebarWidthRef.current + delta));
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      persistSidebarWidth(setClampedSidebarWidth(event.key === "Home" ? SIDEBAR_MIN_WIDTH : SIDEBAR_MAX_WIDTH));
    }
  }

  return (
    <SidebarDrawerContext.Provider value={{ closeDrawer: close }}>
      <div
        className="grid h-[100vh] grid-cols-[264px_minmax(0,1fr)] overflow-hidden bg-[var(--bg)] text-[var(--fg)] max-[820px]:grid-cols-1"
        style={isMobileViewport === false ? { gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` } : undefined}
      >
        {open && (
          <div
            aria-hidden="true"
            onClick={close}
            className="fixed inset-0 z-[75] hidden bg-[var(--overlay)] max-[820px]:block"
          />
        )}

        <aside
          ref={asideRef}
          onClick={handleAsideClick}
          id="app-sidebar"
          style={isMobileViewport === false ? { width: `${sidebarWidth}px` } : undefined}
          className={`relative flex min-h-0 w-[264px] flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--sidebar)] max-[820px]:fixed max-[820px]:inset-y-0 max-[820px]:left-0 max-[820px]:z-[80] max-[820px]:h-[100vh] max-[820px]:w-[264px] max-[820px]:shadow-[var(--shadow)] max-[820px]:transition-transform max-[820px]:duration-[280ms] max-[820px]:ease-out motion-reduce:max-[820px]:transition-none ${
            open ? "max-[820px]:translate-x-0" : "max-[820px]:-translate-x-full"
          }`}
        >
          {sidebar}

          <div className="mt-auto p-[12px]">{userMenu}</div>
          {/* UX-08 overrides the older fixed 264px desktop handoff geometry; the mobile drawer stays fixed. */}
          <div
            role="separator"
            aria-label="Resize navigation"
            aria-orientation="vertical"
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            onPointerDown={startSidebarResize}
            onDoubleClick={resetSidebarWidth}
            onKeyDown={handleResizeKeyDown}
            className={`group absolute right-0 top-0 h-full w-[8px] cursor-col-resize outline-none max-[820px]:hidden ${
              isResizing ? "bg-[var(--hover)]" : "bg-transparent hover:bg-[var(--hover)]"
            } focus-visible:bg-[var(--hover)]`}
            title="Drag to resize navigation; double-click to reset"
          >
            <span className="mx-auto block h-full w-[2px] bg-transparent group-hover:bg-[var(--borderstrong)] group-focus-visible:bg-[var(--borderstrong)]" />
          </div>
        </aside>

        <div className="flex h-[100vh] min-w-0 flex-col overflow-hidden">
          <header className="flex h-[48px] shrink-0 items-center gap-[var(--space-2)] border-b border-[var(--border)] bg-[var(--surface)] px-[20px] text-[var(--font-size-sm)] text-[var(--mutedfg)]">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
              aria-expanded={open}
              aria-controls="app-sidebar"
              className="hidden cursor-pointer items-center justify-center rounded-[var(--radius-3)] p-[var(--space-1)] text-[var(--fg)] hover:bg-[var(--hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] max-[820px]:inline-flex"
            >
              <Menu size={18} />
            </button>
            <div className="flex min-w-0 items-center gap-[10px]">
              <section.Icon size={14} className="shrink-0 text-[var(--fg)]" />
              <div className="truncate text-[13px] font-semibold text-[var(--fg)]">{section.title}</div>
              {section.chip ? (
                <span className="inline-flex max-w-[220px] items-center truncate rounded-full bg-[var(--muted)] px-[9px] py-[4px] text-[12px] font-medium text-[var(--mutedfg)]">
                  {section.chip}
                </span>
              ) : null}
              {section.admin && alertCount > 0 ? (
                <span className="inline-flex items-center gap-[6px] rounded-full bg-[var(--warnbg)] px-[9px] py-[4px] text-[12px] font-medium text-[var(--warn)]">
                  <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-current" />
                  {alertCount === 1 ? "1 component degraded" : `${alertCount} components degraded`}
                </span>
              ) : null}
            </div>
            <div className="ml-auto flex items-center gap-[var(--space-3)]">
              <FontScaleControl />
              <ThemeControl />
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-auto">
            <div className="flex min-w-0 flex-col gap-[20px] p-[22px]">{children}</div>
          </main>
        </div>
      </div>
    </SidebarDrawerContext.Provider>
  );
}

function getHeaderSection(pathname: string | null, instanceName: string) {
  if (pathname?.startsWith("/admin")) {
    return { title: "Admin", chip: instanceName, admin: true, Icon: Shield };
  }
  if (pathname?.startsWith("/brain")) {
    return { title: "Brain", chip: null, admin: false, Icon: BrainCircuit };
  }
  return { title: "Scope", chip: null, admin: false, Icon: Activity };
}

function clampScale(value: number) {
  return Math.min(1.4, Math.max(0.85, value));
}

function readFontScale() {
  if (typeof window === "undefined") return 1;
  const raw = window.localStorage.getItem(FONT_SCALE_KEY);
  const parsed = raw ? Number(raw) : 1;
  return Number.isFinite(parsed) ? clampScale(parsed) : 1;
}

function applyFontScale(next: number) {
  const clamped = clampScale(next);
  document.documentElement.style.setProperty("--os-root-font-size", `${(BASE_FONT_SIZE * clamped).toFixed(2)}px`);
  document.documentElement.dataset.fontScale = String(clamped);
  try {
    window.localStorage.setItem(FONT_SCALE_KEY, String(clamped));
  } catch {
    /* ignore storage errors */
  }
  return clamped;
}

function FontScaleControl() {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    setScale(applyFontScale(readFontScale()));
  }, []);

  function step(delta: number) {
    setScale((current) => {
      const next = current <= 0.85 && delta > 0 ? 0.95 : current + delta;
      return applyFontScale(next);
    });
  }

  return (
    <div className="flex h-[30px] items-center overflow-hidden rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--bg)] text-[var(--font-size-xs)] text-[var(--fg)]">
      <button
        type="button"
        onClick={() => step(-0.1)}
        disabled={scale <= 0.85}
        className="h-full cursor-pointer px-[var(--space-2)] font-medium hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--primary)]"
        aria-label="Decrease workspace text size"
      >
        A-
      </button>
      <span className="min-w-[44px] border-x border-[var(--border)] px-[var(--space-2)] text-center text-[var(--mutedfg)]">
        {Math.round(scale * 100)}%
      </span>
      <button
        type="button"
        onClick={() => step(0.1)}
        disabled={scale >= 1.4}
        className="h-full cursor-pointer px-[var(--space-2)] font-medium hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--primary)]"
        aria-label="Increase workspace text size"
      >
        A+
      </button>
    </div>
  );
}

function normalizeTheme(value: string | null): ThemeChoice {
  return value === "light" || value === "green" || value === "charcoal" || value === "auto" ? value : "auto";
}

function resolveTheme(choice: ThemeChoice): { theme: ConcreteTheme; bg?: string } {
  if (choice !== "auto") return { theme: choice };
  const h = new Date().getHours();
  if (h >= 21 || h < 5) return { theme: "charcoal" };
  if (h < 8) return { theme: "light", bg: "var(--bg-dawn)" };
  if (h >= 17) return { theme: "light", bg: "var(--bg-dusk)" };
  return { theme: "light" };
}

function applyThemeChoice(choice: ThemeChoice) {
  const resolved = resolveTheme(choice);
  document.documentElement.dataset.theme = resolved.theme;
  document.body.dataset.theme = resolved.theme;
  document.documentElement.classList.toggle("dark", resolved.theme === "green" || resolved.theme === "charcoal");
  if (resolved.bg) {
    document.documentElement.style.setProperty("--bg", resolved.bg);
    document.body.style.setProperty("--bg", resolved.bg);
  } else {
    document.documentElement.style.removeProperty("--bg");
    document.body.style.removeProperty("--bg");
  }
}

function ThemeControl() {
  const [theme, setTheme] = useState<ThemeChoice>("auto");

  useEffect(() => {
    let stored: ThemeChoice = "auto";
    try {
      stored = normalizeTheme(window.localStorage.getItem(THEME_KEY));
    } catch {
      /* ignore storage errors */
    }
    setTheme(stored);
    applyThemeChoice(stored);
  }, []);

  useEffect(() => {
    if (theme !== "auto") return undefined;
    const timer = window.setInterval(() => applyThemeChoice("auto"), 60_000);
    return () => window.clearInterval(timer);
  }, [theme]);

  function choose(next: ThemeChoice) {
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore storage errors */
    }
    setTheme(next);
    applyThemeChoice(next);
  }

  return (
    <div className="flex items-center gap-[var(--space-1)]" aria-label="Theme">
      {THEME_CHOICES.map((choice) => (
        <button
          key={choice.id}
          type="button"
          onClick={() => choose(choice.id)}
          className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[var(--radius-3)] hover:bg-[var(--hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          title={choice.title}
          aria-label={choice.title}
          aria-pressed={theme === choice.id}
        >
          <span
            aria-hidden="true"
            className={`${choice.swatch} h-[14px] w-[14px] rounded-[var(--radius-2)] border border-[var(--borderstrong)] ${
              theme === choice.id ? "ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--surface)]" : ""
            }`}
          />
        </button>
      ))}
    </div>
  );
}
