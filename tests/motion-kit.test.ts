import { describe, expect, it } from "vitest";
import {
  df,
  normalizeMotionIntensity,
  prefersReducedMotion,
  rm,
} from "../packages/ui/src/motion";

describe("motion kit", () => {
  it("normalizes motion intensity values", () => {
    expect(normalizeMotionIntensity("0")).toBe(0);
    expect(normalizeMotionIntensity("1")).toBe(1);
    expect(normalizeMotionIntensity("3")).toBe(3);
    expect(normalizeMotionIntensity("2")).toBe(2);
    expect(normalizeMotionIntensity(null)).toBe(2);
  });

  it("scales durations through df", () => {
    expect(df(0.24)).toBeGreaterThan(0);
    expect(df(0.8)).toBeGreaterThan(df(0.24));
  });

  it("reports reduced motion only in browser contexts", () => {
    expect(prefersReducedMotion()).toBe(false);
    expect(rm()).toBe(false);
  });
});