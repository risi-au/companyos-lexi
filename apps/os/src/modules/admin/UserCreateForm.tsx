"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { createAdminUserAction, type CreateAdminUserActionState } from "./actions";

const initialState: CreateAdminUserActionState = {};

export function UserCreateForm() {
  const [state, formAction, pending] = useActionState(createAdminUserAction, initialState);

  return (
    <form action={formAction} className="space-y-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
      <div>
        <div className="text-[var(--font-size-sm)] font-medium">Create account</div>
        <div className="mt-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
          Account starts with a temporary password and must change it on first login.
        </div>
      </div>
      <label className="block">
        <span className="mb-[var(--space-1)] block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Name</span>
        <input name="name" required className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]" />
      </label>
      <label className="block">
        <span className="mb-[var(--space-1)] block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Email</span>
        <input name="email" type="email" required className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]" />
      </label>
      <label className="block">
        <span className="mb-[var(--space-1)] block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Temporary password</span>
        <input name="tempPassword" minLength={8} className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]" placeholder="Generated if blank" />
      </label>
      <div className="grid grid-cols-2 gap-[var(--space-2)]">
        <label className="block">
          <span className="mb-[var(--space-1)] block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Initial scope</span>
          <input name="scopePath" defaultValue="root" className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-sm)]" />
        </label>
        <label className="block">
          <span className="mb-[var(--space-1)] block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Role</span>
          <select name="role" defaultValue="viewer" className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]">
            <option value="viewer">viewer</option>
            <option value="editor">editor</option>
            <option value="admin">admin</option>
            <option value="owner">owner</option>
          </select>
        </label>
      </div>
      {state.error ? <div className="text-[var(--font-size-sm)] text-[var(--destructive)]">{state.error}</div> : null}
      {state.tempPassword ? (
        <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] p-[var(--space-3)]">
          <div className="flex items-center gap-[var(--space-2)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
            <KeyRound size={14} />
            One-time temporary password
          </div>
          <div className="mt-[var(--space-1)] select-all font-mono text-[var(--font-size-sm)]">{state.tempPassword}</div>
        </div>
      ) : null}
      {state.message ? <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{state.message}</div> : null}
      <button type="submit" disabled={pending} className="inline-flex min-h-10 items-center rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--primary-foreground)] disabled:opacity-60">
        {pending ? "Creating..." : "Create user"}
      </button>
    </form>
  );
}
