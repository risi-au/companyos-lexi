"use client";

import React from "react";
import { authClient } from "@/lib/auth-client";
import { LogOut, Sun, Moon } from "lucide-react";

export function UserMenu({ name, email }: { name: string; email?: string }) {
  const [theme, setTheme] = React.useState<"light" | "dark">(
    typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light"
  );

  function toggleTheme() {
    const html = document.documentElement;
    const next = html.classList.contains("dark") ? "light" : "dark";
    html.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  }

  async function signOut() {
    await authClient.signOut();
    window.location.href = "/sign-in";
  }

  // On mount sync theme from storage if present
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem("theme") as "light" | "dark" | null;
      if (saved) {
        document.documentElement.classList.toggle("dark", saved === "dark");
        setTheme(saved);
      }
    } catch {
      /* ignore storage errors */
    }
  }, []);

  return (
    <div className="flex items-center gap-[var(--space-2)] text-[var(--font-size-sm)]">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{name}</div>
        {email && <div className="truncate text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{email}</div>}
      </div>

      <button
        onClick={toggleTheme}
        className="rounded p-[var(--space-1)] hover:bg-[var(--muted)]"
        title="Toggle theme"
        aria-label="Toggle light/dark theme"
      >
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <button
        onClick={signOut}
        className="rounded p-[var(--space-1)] hover:bg-[var(--muted)] text-[var(--muted-foreground)]"
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut size={16} />
      </button>
    </div>
  );
}
