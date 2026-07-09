"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { anim, df, rm } from "../motion";

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "destructive" | "default";
}

type ResolveConfirm = (value: boolean) => void;

interface PendingConfirm {
  opts: Required<ConfirmOptions>;
  resolve: ResolveConfirm;
  trigger: HTMLElement | null;
}

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function normalizeOptions(opts: ConfirmOptions): Required<ConfirmOptions> {
  return {
    title: opts.title,
    body: opts.body,
    confirmLabel: opts.confirmLabel ?? "Confirm",
    cancelLabel: opts.cancelLabel ?? "Cancel",
    tone: opts.tone ?? "destructive",
  };
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const close = useCallback((value: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(value);
    window.setTimeout(() => current.trigger?.focus(), 0);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    const trigger = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    const current = pendingRef.current;
    if (current) current.resolve(false);

    return new Promise<boolean>((resolve) => {
      const next = { opts: normalizeOptions(opts), resolve, trigger };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? <ConfirmDialog pending={pending} onClose={close} /> : null}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  pending,
  onClose,
}: {
  pending: PendingConfirm;
  onClose: (value: boolean) => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    if (rm() || !panelRef.current) return;
    void anim((gsap) => {
      if (!panelRef.current) return;
      gsap.from(panelRef.current, {
        opacity: 0,
        scale: 0.97,
        y: 6,
        duration: df(0.22),
        ease: "power3.out",
        clearProps: "transform,opacity",
      });
    });
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(false);
      return;
    }

    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(focusableSelector)).filter(
      (element) => element.offsetParent !== null
    );
    if (focusable.length === 0) return;

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const confirmClass =
    pending.opts.tone === "destructive"
      ? "bg-[var(--err)] text-[var(--primaryfg)] hover:bg-[var(--errbg)] hover:text-[var(--err)]"
      : "bg-[var(--primary)] text-[var(--primaryfg)] hover:bg-[var(--primaryhover)]";

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--overlay)] px-[var(--space-4)] transition-opacity duration-200 ease-out"
      onMouseDown={() => onClose(false)}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        data-confirmcard
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="w-full max-w-[420px] rounded-[var(--radius-4)] border border-[var(--border)] bg-[var(--raised)] p-[var(--space-5)] text-[var(--fg)] shadow-[var(--shadow)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="text-[var(--font-size-lg)] font-semibold leading-6 text-[var(--fg)]">
          {pending.opts.title}
        </h2>
        <p id={bodyId} className="mt-[var(--space-2)] text-[var(--font-size-sm)] leading-5 text-[var(--mutedfg)]">
          {pending.opts.body}
        </p>
        <div className="mt-[var(--space-5)] flex justify-end gap-[var(--space-2)]">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onClose(false)}
            className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-4)] py-[var(--space-2)] text-[var(--font-size-sm)] font-medium text-[var(--fg)] hover:bg-[var(--hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            {pending.opts.cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onClose(true)}
            className={`inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-[var(--radius-3)] px-[var(--space-4)] py-[var(--space-2)] text-[var(--font-size-sm)] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] ${confirmClass}`}
          >
            {pending.opts.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return context;
}
