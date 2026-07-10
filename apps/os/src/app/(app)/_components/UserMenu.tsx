"use client";

import { authClient } from "@/lib/auth-client";
import { LogOut } from "lucide-react";

export function UserMenu({ name }: { name: string; email?: string }) {
  async function signOut() {
    await authClient.signOut();
    window.location.href = "/sign-in";
  }

  return (
    <div className="flex min-h-[30px] items-center gap-[var(--space-2)] text-[var(--font-size-sm)]">
      <div className="min-w-0 flex-1 truncate font-medium text-[var(--fg)]">{name}</div>
      <button
        onClick={signOut}
        className="grid h-[28px] w-[28px] shrink-0 cursor-pointer place-items-center rounded-[var(--radius-3)] text-[var(--mutedfg)] hover:bg-[var(--hover)] hover:text-[var(--fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut size={15} />
      </button>
    </div>
  );
}
