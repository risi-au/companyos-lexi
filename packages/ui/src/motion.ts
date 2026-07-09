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

export async function anim(fn: (gsap: GsapLike) => void | Promise<void>) {
  if (rm()) return;
  const gsap = await loadGsap();
  if (!gsap) return;
  await fn(gsap);
}
