"use client";

import React from "react";
import { authClient } from "@/lib/auth-client";
import { LogOut } from "lucide-react";

type ThemeChoice = "auto" | "light" | "green" | "charcoal";
type ConcreteTheme = Exclude<ThemeChoice, "auto">;

const THEME_KEY = "theme";
const THEME_CHOICES: Array<{ id: ThemeChoice; title: string; swatch: string }> = [
  { id: "auto", title: "Auto (Circadian)", swatch: "theme-swatch-auto" },
  { id: "light", title: "Light — Terrazzo Quiet", swatch: "theme-swatch-light" },
  { id: "green", title: "Dark — Green Hall", swatch: "theme-swatch-green" },
  { id: "charcoal", title: "Dark — Charcoal", swatch: "theme-swatch-charcoal" },
];

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

function applyTheme(choice: ThemeChoice) {
  const resolved = resolveTheme(choice);
  document.body.dataset.theme = resolved.theme;
  document.documentElement.classList.toggle("dark", resolved.theme === "green" || resolved.theme === "charcoal");
  if (resolved.bg) document.body.style.setProperty("--bg", resolved.bg);
  else document.body.style.removeProperty("--bg");
}

export function UserMenu({ name, email }: { name: string; email?: string }) {
  const [theme, setTheme] = React.useState<ThemeChoice>("auto");

  React.useEffect(() => {
    let stored: ThemeChoice = "auto";
    try {
      stored = normalizeTheme(localStorage.getItem(THEME_KEY));
    } catch {
      /* ignore storage errors */
    }
    setTheme(stored);
    applyTheme(stored);
  }, []);

  React.useEffect(() => {
    if (theme !== "auto") return undefined;
    const timer = window.setInterval(() => applyTheme("auto"), 60_000);
    return () => window.clearInterval(timer);
  }, [theme]);

  function chooseTheme(next: ThemeChoice) {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore storage errors */
    }
    setTheme(next);
    applyTheme(next);
  }

  async function signOut() {
    await authClient.signOut();
    window.location.href = "/sign-in";
  }

  return (
    <div className="space-y-[var(--space-2)] text-[var(--font-size-sm)]">
      <div className="flex items-center gap-[var(--space-2)]">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{name}</div>
          {email && <div className="truncate text-[var(--font-size-xs)] text-[var(--mutedfg)]">{email}</div>}
        </div>

        <button
          onClick={signOut}
          className="cursor-pointer rounded-[var(--radius-3)] p-[var(--space-1)] text-[var(--mutedfg)] hover:bg-[var(--hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut size={16} />
        </button>
      </div>

      <div className="grid gap-[var(--space-1)]" aria-label="Theme">
        {THEME_CHOICES.map((choice) => {
          const selected = theme === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              onClick={() => chooseTheme(choice.id)}
              className="grid cursor-pointer grid-cols-[18px_1fr] items-center gap-[var(--space-2)] rounded-[var(--radius-3)] px-[var(--space-2)] py-[var(--space-1)] text-left text-[var(--font-size-xs)] text-[var(--fg)] hover:bg-[var(--hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              title={choice.title}
              aria-label={choice.title}
              aria-pressed={selected}
            >
              <span
                aria-hidden="true"
                className={`${choice.swatch} h-[14px] w-[14px] rounded-[var(--radius-2)] border border-[var(--borderstrong)] ${
                  selected ? "ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--sidebar)]" : ""
                }`}
              />
              <span className="truncate">{choice.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
