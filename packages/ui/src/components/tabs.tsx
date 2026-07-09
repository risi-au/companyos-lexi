"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { anim, df, rm } from "../motion";

export interface TabItem {
  id: string;
  label: ReactNode;
  href?: string;
  disabled?: boolean;
  panel?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange?: (id: string) => void;
  ariaLabel?: string;
  className?: string;
  tabClassName?: string;
  panelClassName?: string;
}

export function Tabs({
  items,
  activeId,
  onChange,
  ariaLabel = "Tabs",
  className = "",
  tabClassName = "",
  panelClassName = "",
}: TabsProps) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);
  const underlineRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLElement>());
  const [underline, setUnderline] = useState({ left: 0, width: 0 });
  const activeIndex = Math.max(0, items.findIndex((item) => item.id === activeId));
  const active = items[activeIndex];

  useLayoutEffect(() => {
    const node = tabRefs.current.get(activeId);
    const list = listRef.current;
    if (!node || !list) return;
    const listRect = list.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    setUnderline({
      left: nodeRect.left - listRect.left + list.scrollLeft,
      width: nodeRect.width,
    });
  }, [activeId, items]);

  useEffect(() => {
    const el = underlineRef.current;
    if (!el) return;
    if (rm()) {
      el.style.transform = `translateX(${underline.left}px)`;
      el.style.width = `${underline.width}px`;
      return;
    }
    void anim((gsap) => {
      gsap.to(el, {
        x: underline.left,
        width: underline.width,
        duration: df(0.2),
        ease: "power3.out",
      });
    });
  }, [underline]);

  function focusTab(nextIndex: number) {
    const enabled = items.filter((item) => !item.disabled);
    if (enabled.length === 0) return;
    const currentEnabledIndex = enabled.findIndex((item) => item.id === activeId);
    const next = enabled[(currentEnabledIndex + nextIndex + enabled.length) % enabled.length];
    if (!next) return;
    tabRefs.current.get(next.id)?.focus();
    if (!next.href) onChange?.(next.id);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusTab(1);
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusTab(-1);
    }
    if (event.key === "Home") {
      event.preventDefault();
      const first = items.find((item) => !item.disabled);
      if (first) {
        tabRefs.current.get(first.id)?.focus();
        if (!first.href) onChange?.(first.id);
      }
    }
    if (event.key === "End") {
      event.preventDefault();
      const last = [...items].reverse().find((item) => !item.disabled);
      if (last) {
        tabRefs.current.get(last.id)?.focus();
        if (!last.href) onChange?.(last.id);
      }
    }
  }

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className="relative flex gap-[var(--space-5)] overflow-x-auto border-b border-[var(--border)] text-[var(--font-size-sm)]"
      >
        {items.map((item) => {
          const selected = item.id === activeId;
          const common =
            `relative z-[1] inline-flex min-h-[44px] cursor-pointer items-center whitespace-nowrap pb-[var(--space-2)] pt-[var(--space-2)] outline-none transition-colors focus-visible:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50 ${selected ? "font-medium text-[var(--fg)]" : "text-[var(--mutedfg)] hover:text-[var(--fg)]"} ${tabClassName}`.trim();
          const id = `${baseId}-tab-${item.id}`;
          const panelId = `${baseId}-panel-${item.id}`;

          if (item.href) {
            return (
              <a
                key={item.id}
                ref={(node) => {
                  if (node) tabRefs.current.set(item.id, node);
                  else tabRefs.current.delete(item.id);
                }}
                id={id}
                href={item.href}
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                className={common}
              >
                {item.label}
              </a>
            );
          }

          return (
            <button
              key={item.id}
              ref={(node) => {
                if (node) tabRefs.current.set(item.id, node);
                else tabRefs.current.delete(item.id);
              }}
              id={id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => onChange?.(item.id)}
              className={common}
            >
              {item.label}
            </button>
          );
        })}
        <div
          ref={underlineRef}
          aria-hidden="true"
          className="absolute bottom-0 left-0 h-[2px] rounded-[var(--radius-2)] bg-[var(--primary)]"
          style={{ width: underline.width, transform: `translateX(${underline.left}px)` }}
        />
      </div>
      {active?.panel ? (
        <div
          id={`${baseId}-panel-${active.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${active.id}`}
          className={panelClassName}
        >
          {active.panel}
        </div>
      ) : null}
    </div>
  );
}
