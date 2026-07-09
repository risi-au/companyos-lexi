"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { useConfirm } from "@companyos/ui";
import type React from "react";

export function ConfirmSubmitButton({
  title,
  body,
  confirmLabel,
  children,
  className = "",
}: {
  title: string;
  body: string;
  confirmLabel: string;
  children: React.ReactNode;
  className?: string;
}) {
  const confirm = useConfirm();
  const { pending } = useFormStatus();
  const ref = useRef<HTMLButtonElement | null>(null);

  async function onClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const ok = await confirm({ title, body, confirmLabel });
    if (ok) ref.current?.form?.requestSubmit(ref.current);
  }

  return (
    <button
      ref={ref}
      type="submit"
      disabled={pending}
      onClick={onClick}
      className={className}
    >
      {pending ? "Working…" : children}
    </button>
  );
}
