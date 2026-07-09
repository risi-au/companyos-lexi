"use client";

import { useEffect, useRef } from "react";
import { anim, df, rm } from "../motion";
import "../motion.css";

export interface StepperStep {
  id: string;
  label: string;
}

export interface StepperProps {
  steps: StepperStep[];
  current: number;
  maxReached: number;
  onStepClick: (step: number) => void;
  className?: string;
}

export function Stepper({ steps, current, maxReached, onStepClick, className = "" }: StepperProps) {
  const fillRef = useRef<HTMLDivElement | null>(null);
  const progress = steps.length <= 1 ? 0 : ((current - 1) / (steps.length - 1)) * 100;

  useEffect(() => {
    const el = fillRef.current;
    if (!el) return;
    const setFinal = () => {
      el.style.height = `${progress}%`;
    };
    if (rm()) {
      setFinal();
      return;
    }
    void anim(
      (gsap) => {
        gsap.to(el, {
          height: `${progress}%`,
          duration: df(0.35),
          ease: "power2.out",
        });
      },
      setFinal,
    );
  }, [progress]);

  return (
    <nav aria-label="Wizard progress" className={`wiz-rail relative ${className}`.trim()}>
      <div className="wiz-spine absolute bottom-[var(--space-5)] left-[18px] top-[var(--space-5)] w-px bg-[var(--border)]">
        <div ref={fillRef} className="w-px bg-[var(--primary)]" style={{ height: `${progress}%` }} />
      </div>
      <ol className="wiz-ol relative z-[1] flex flex-col gap-[var(--space-3)]">
        {steps.map((step, index) => {
          const stepNumber = index + 1;
          const active = stepNumber === current;
          const done = stepNumber < current;
          const locked = stepNumber > maxReached;
          return (
            <li key={step.id}>
              <button
                type="button"
                disabled={locked}
                data-stepmark={stepNumber}
                aria-current={active ? "step" : undefined}
                onClick={() => onStepClick(stepNumber)}
                className={`wiz-step flex w-full cursor-pointer items-center gap-[var(--space-3)] rounded-[var(--radius-3)] px-[var(--space-2)] py-[var(--space-2)] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50 ${active ? "bg-[var(--selected)]" : "hover:bg-[var(--hover)]"}`}
              >
                <span className={`wiz-num grid h-5 w-5 shrink-0 place-items-center rounded-[var(--radius-2)] bg-[var(--surface)] font-mono text-[var(--font-size-xs)] tabular-nums ${active ? "text-[var(--primary)]" : done ? "text-[var(--ok)]" : "text-[var(--mutedfg)]"}`}>
                  {String(stepNumber).padStart(2, "0")}
                </span>
                <span className={`wiz-lbl border-b-2 pb-px text-[var(--font-size-sm)] ${active ? "border-[var(--primary)] font-semibold text-[var(--fg)]" : done ? "border-transparent text-[var(--fg)]" : "border-transparent text-[var(--mutedfg)]"}`}>
                  {step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}