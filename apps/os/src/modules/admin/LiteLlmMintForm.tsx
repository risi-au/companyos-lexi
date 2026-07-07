"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { mintLiteLlmKeyStateAction, type MintLiteLlmKeyActionState } from "./actions";

export function LiteLlmMintForm({ defaultBudgetUsd, configured }: { defaultBudgetUsd: number; configured: boolean }) {
  const [state, action, pending] = useActionState<MintLiteLlmKeyActionState, FormData>(mintLiteLlmKeyStateAction, {});

  return (
    <form action={action} className="space-y-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
      <div>
        <div className="text-[var(--font-size-sm)] font-medium">Mint virtual key</div>
        <div className="mt-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Default budget is ${defaultBudgetUsd}/month.</div>
      </div>
      <input name="alias" required placeholder="key alias" className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]" />
      <input name="budgetUsd" type="number" min="0" step="0.01" defaultValue={defaultBudgetUsd} className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]" />
      <input name="models" placeholder="optional, comma separated models" className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]" />
      {state.error ? <div className="text-[var(--font-size-sm)] text-[var(--destructive)]">{state.error}</div> : null}
      {state.key ? (
        <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] p-[var(--space-3)]">
          <div className="flex items-center gap-[var(--space-2)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
            <KeyRound size={14} />
            One-time virtual key
          </div>
          <div className="mt-[var(--space-1)] select-all break-all font-mono text-[var(--font-size-sm)]">{state.key}</div>
        </div>
      ) : null}
      {state.message ? <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{state.message}</div> : null}
      <button disabled={!configured || pending} className="rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--primary-foreground)] disabled:opacity-60">
        {pending ? "Minting..." : "Mint key"}
      </button>
    </form>
  );
}
