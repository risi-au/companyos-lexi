"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { anim, df, rm } from "@companyos/ui";

export function ScopeTabPanel({
  tabId,
  children,
}: {
  tabId: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const setFinal = () => {
      node.style.opacity = "";
      node.style.transform = "";
    };

    if (rm()) {
      setFinal();
      return;
    }

    let cancelled = false;
    void anim(
      (gsap) => {
        if (cancelled) return;
        gsap.killTweensOf(node);
        gsap.fromTo(
          node,
          { opacity: 0, y: 8 },
          {
            opacity: 1,
            y: 0,
            duration: df(0.18),
            ease: "power2.out",
            clearProps: "opacity,transform",
          },
        );
      },
      setFinal,
    );

    return () => {
      cancelled = true;
      void anim((gsap) => {
        gsap.killTweensOf(node);
      });
    };
  }, [tabId]);

  return <div ref={ref}>{children}</div>;
}
