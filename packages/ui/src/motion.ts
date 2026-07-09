export type MotionIntensity = 0 | 1 | 2 | 3;

type GsapLike = typeof import("gsap").gsap;

const STORAGE_KEY = "motionIntensity";
const FACTORS: Record<MotionIntensity, number> = {
  0: 0,
  1: 0.7,
  2: 1,
  3: 1.4,
};

function canUseDom() {
  return typeof window !== "undefined";
}

export function prefersReducedMotion() {
  return canUseDom() && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function normalizeMotionIntensity(value: unknown): MotionIntensity {
  return value === 0 || value === "0"
    ? 0
    : value === 1 || value === "1"
      ? 1
      : value === 3 || value === "3"
        ? 3
        : 2;
}

export function getMotionIntensity(): MotionIntensity {
  if (!canUseDom()) return 2;
  if (prefersReducedMotion()) return 0;
  try {
    return normalizeMotionIntensity(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return 2;
  }
}

export function setMotionIntensity(intensity: MotionIntensity) {
  if (!canUseDom()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(intensity));
  } catch {
    /* ignore storage errors */
  }
}

export function df(duration = 1) {
  return duration * FACTORS[getMotionIntensity()];
}

export function rm() {
  return getMotionIntensity() === 0;
}

async function loadGsap(): Promise<GsapLike | null> {
  try {
    const mod = await import("gsap");
    return mod.gsap ?? mod.default ?? null;
  } catch {
    return null;
  }
}

export async function anim(
  fn: (gsap: GsapLike) => void | Promise<void>,
  instant?: () => void,
) {
  if (rm()) {
    instant?.();
    return;
  }
  const gsap = await loadGsap();
  if (!gsap) {
    instant?.();
    return;
  }
  try {
    await fn(gsap);
  } catch {
    instant?.();
  }
}

export interface CountUpOptions {
  format?: (value: number) => string;
  duration?: number;
}

export async function countUp(
  el: HTMLElement,
  value: number,
  options: CountUpOptions = {},
) {
  const format = options.format ?? ((n: number) => String(Math.round(n)));
  const duration = options.duration ?? 0.8;
  el.dataset.count = String(value);

  const setFinal = () => {
    el.textContent = format(value);
  };

  if (rm()) {
    setFinal();
    return;
  }

  const counter = { value: 0 };
  await anim(
    (gsap) => {
      gsap.to(counter, {
        value,
        duration: df(duration),
        ease: "power2.out",
        onUpdate: () => {
          el.textContent = format(counter.value);
        },
        onComplete: setFinal,
      });
    },
    setFinal,
  );
}

export async function viewEnter(root: HTMLElement, items?: NodeListOf<Element> | Element[]) {
  const setFinal = () => {
    root.style.opacity = "1";
    root.style.transform = "none";
    if (items) {
      for (const item of items) {
        const node = item as HTMLElement;
        node.style.opacity = "1";
        node.style.transform = "none";
      }
    }
  };

  if (rm()) {
    setFinal();
    return;
  }

  await anim(
    (gsap) => {
      gsap.fromTo(
        root,
        { opacity: 0, y: 10 },
        {
          opacity: 1,
          y: 0,
          duration: df(0.24),
          ease: "power3.out",
          clearProps: "transform,opacity",
        },
      );
      if (items && items.length > 0) {
        gsap.fromTo(
          items,
          { opacity: 0, y: 8 },
          {
            opacity: 1,
            y: 0,
            duration: df(0.2),
            stagger: df(0.05),
            delay: df(0.04),
            ease: "power2.out",
            clearProps: "transform,opacity",
          },
        );
      }
    },
    setFinal,
  );
}

export async function pulse(el: HTMLElement) {
  const setFinal = () => {
    el.style.opacity = "1";
  };

  if (rm()) {
    setFinal();
    return;
  }

  await anim(
    (gsap) => {
      gsap.to(el, {
        opacity: 0.35,
        duration: 1.1,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });
    },
    setFinal,
  );
}

export function initPulseDots(root: ParentNode = document) {
  if (!canUseDom() || rm()) return () => {};
  const elements = root.querySelectorAll<HTMLElement>("[data-pulse]");
  const stops: Array<() => void> = [];

  for (const el of elements) {
    let active = true;
    void loadGsap().then((gsap) => {
      if (!active || !gsap || rm()) {
        el.style.opacity = "1";
        return;
      }
      gsap.to(el, {
        opacity: 0.35,
        duration: 1.1,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });
    });
    stops.push(() => {
      active = false;
      void loadGsap().then((gsap) => {
        gsap?.killTweensOf(el);
        el.style.opacity = "1";
      });
    });
  }

  return () => {
    for (const stop of stops) stop();
  };
}