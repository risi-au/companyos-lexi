"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import { resolveWikiQuestionFormAction, type WikiQuestionActionState } from "./actions";

const initialState: WikiQuestionActionState = {};

export function WikiQuestionForm({ children, className }: { children: ReactNode; className?: string }) {
  const [state, action] = useActionState(resolveWikiQuestionFormAction, initialState);

  return (
    <form action={action} className={className}>
      {children}
      <span role="alert" aria-live="assertive" className="basis-full text-[var(--font-size-xs)] text-[var(--destructive)]">
        {state.error ?? ""}
      </span>
    </form>
  );
}
