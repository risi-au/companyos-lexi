"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { anim, df, rm } from "../motion";

export type ToastStatus = "ok" | "warn" | "err" | "info";

export interface ToastOptions {
  id?: string;
  status?: ToastStatus;
  title?: string;
  message: string;
  duration?: number;
}

export interface Toast extends Required<Pick<ToastOptions, "id" | "status" | "message">> {
  title?: string;
  duration: number;
}

type ToastInput = string | ToastOptions;

interface ToastApi {
  (opts: ToastInput): string;
  success(message: string, opts?: Omit<ToastOptions, "message" | "status">): string;
  error(message: string, opts?: Omit<ToastOptions, "message" | "status">): string;
  info(message: string, opts?: Omit<ToastOptions, "message" | "status">): string;
  warn(message: string, opts?: Omit<ToastOptions, "message" | "status">): string;
}

interface ToastContextValue {
  toast: ToastApi;
}

const DEFAULT_DURATION = 4200;
const ToastContext = createContext<ToastContextValue | null>(null);

function makeId() {
  return `toast-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function normalizeToast(input: ToastInput): Toast {
  const opts = typeof input === "string" ? { message: input } : input;
  return {
    id: opts.id ?? makeId(),
    status: opts.status ?? "info",
    title: opts.title,
    message: opts.message,
    duration: opts.duration ?? DEFAULT_DURATION,
  };
}

function edgeClass(status: ToastStatus) {
  switch (status) {
    case "ok":
      return "border-l-[var(--ok)]";
    case "warn":
      return "border-l-[var(--warn)]";
    case "err":
      return "border-l-[var(--err)]";
    case "info":
      return "border-l-[var(--info)]";
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, number>());

  const removeToast = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }

    const done = () => setToasts((current) => current.filter((item) => item.id !== id));
    const element = document.querySelector<HTMLElement>(`[data-toast="${id}"]`);
    if (!element || rm()) {
      done();
      return;
    }

    void anim((gsap) => {
      gsap.to(element, {
        x: 90,
        opacity: 0,
        duration: df(0.2),
        ease: "power2.in",
        onComplete: done,
      });
    });
  }, []);

  const enqueue = useCallback(
    (input: ToastInput) => {
      const next = normalizeToast(input);
      setToasts((current) => [next, ...current]);

      if (next.duration > 0) {
        timers.current.set(
          next.id,
          window.setTimeout(() => removeToast(next.id), next.duration)
        );
      }

      return next.id;
    },
    [removeToast]
  );

  const toast = useMemo(() => {
    const api = ((input: ToastInput) => enqueue(input)) as ToastApi;
    api.success = (message, opts) => enqueue({ ...opts, message, status: "ok" });
    api.error = (message, opts) => enqueue({ ...opts, message, status: "err" });
    api.info = (message, opts) => enqueue({ ...opts, message, status: "info" });
    api.warn = (message, opts) => enqueue({ ...opts, message, status: "warn" });
    return api;
  }, [enqueue]);

  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live={toasts.some((item) => item.status === "err") ? "assertive" : "polite"}
        aria-relevant="additions removals"
        className="fixed right-[var(--space-4)] top-[var(--space-4)] z-[100] flex w-[min(360px,calc(100vw-var(--space-8)))] flex-col gap-[var(--space-2)]"
      >
        {toasts.map((item) => (
          <ToastItem key={item.id} toast={item} onDismiss={() => removeToast(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (rm() || !ref.current) return;
    void anim((gsap) => {
      if (!ref.current) return;
      gsap.from(ref.current, {
        x: 90,
        opacity: 0,
        duration: df(0.26),
        ease: "power3.out",
        clearProps: "transform,opacity",
      });
    });
  }, []);

  return (
    <div
      ref={ref}
      data-toast={toast.id}
      role="status"
      className={`flex min-h-[64px] overflow-hidden rounded-[var(--radius-3)] border border-[var(--border)] border-l-4 bg-[var(--raised)] text-[var(--fg)] shadow-[var(--shadow)] ${edgeClass(toast.status)}`}
    >
      <div className="min-w-0 flex-1 px-[var(--space-3)] py-[var(--space-2)]">
        {toast.title ? (
          <div className="mb-1 text-[var(--font-size-xs)] font-medium text-[var(--mutedfg)]">
            {toast.title}
          </div>
        ) : null}
        <div className="text-[var(--font-size-sm)] leading-5">{toast.message}</div>
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
        className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center text-[var(--mutedfg)] hover:bg-[var(--hover)] hover:text-[var(--fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--primary)]"
      >
        <span aria-hidden="true">x</span>
      </button>
    </div>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
