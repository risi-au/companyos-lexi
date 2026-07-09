"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { anim, df, rm } from "../motion";

export interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`rounded-[var(--radius-4)] bg-[var(--surface)] p-[var(--space-4)] shadow-[var(--shadow)] ${className}`.trim()}>
      {children}
    </div>
  );
}

export interface StatCardProps {
  label: ReactNode;
  value: number;
  href?: string;
  suffix?: string;
  className?: string;
}

export function StatCard({ label, value, href, suffix = "", className = "" }: StatCardProps) {
  const [display, setDisplay] = useState(rm() ? value : 0);
  const valueRef = useRef({ value: rm() ? value : 0 });

  useEffect(() => {
    if (rm()) {
      setDisplay(value);
      return;
    }
    valueRef.current.value = 0;
    void anim((gsap) => {
      gsap.to(valueRef.current, {
        value,
        duration: df(0.8),
        ease: "power2.out",
        onUpdate: () => setDisplay(Math.round(valueRef.current.value)),
      });
    });
  }, [value]);

  const body = (
    <Card className={className}>
      <div className="text-[var(--font-size-xs)] text-[var(--mutedfg)]">{label}</div>
      <div className="mt-[var(--space-1)] font-mono text-[var(--font-size-2xl)] leading-none text-[var(--fg)] tabular-nums">
        {display}
        {suffix}
      </div>
    </Card>
  );

  if (!href) return body;
  return (
    <a href={href} className="block outline-none transition-transform hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
      {body}
    </a>
  );
}
