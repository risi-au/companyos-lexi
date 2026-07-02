import { describe, it, expect } from "vitest";
import { resolveRange, formatValue, formatDateShort } from "./utils";

describe("dashboard range resolver (UTC)", () => {
  it("computes 7d window and prev period of equal length", () => {
    const r = resolveRange("7d");
    expect(r.days).toBe(7);
    expect(r.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // length check: to - from +1 === 7 days
    const fromD = new Date(r.from);
    const toD = new Date(r.to);
    const diffDays = Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1;
    expect(diffDays).toBe(7);

    const pFrom = new Date(r.prevFrom);
    const pTo = new Date(r.prevTo);
    const pDiff = Math.round((pTo.getTime() - pFrom.getTime()) / 86400000) + 1;
    expect(pDiff).toBe(7);
    // prev ends the day before current from
    const expectedPrevTo = new Date(fromD);
    expectedPrevTo.setUTCDate(expectedPrevTo.getUTCDate() - 1);
    expect(r.prevTo).toBe(expectedPrevTo.toISOString().slice(0, 10));
  });

  it("computes 30d and 90d windows", () => {
    const r30 = resolveRange("30d");
    expect(r30.days).toBe(30);
    const r90 = resolveRange("90d");
    expect(r90.days).toBe(90);
  });

  it("defaults to 7d", () => {
    const r = resolveRange();
    expect(r.days).toBe(7);
  });
});

describe("value formatter (tabular mono friendly)", () => {
  it("abbreviates k/M and adds $ for spend/revenue", () => {
    expect(formatValue(1234, "meta.spend")).toMatch(/^\$\d/);
    expect(formatValue(1234567)).toMatch(/M/);
    expect(formatValue(45000, "revenue")).toMatch(/k/);
    expect(formatValue(12.345, "ga4.sessions")).toBe("12.35");
  });

  it("handles zero and small numbers", () => {
    expect(formatValue(0, "meta.spend")).toBe("$0");
    expect(formatValue(5.5)).toBe("5.50");
  });

  it("produces tabular-nums friendly strings (no extra chars)", () => {
    const v = formatValue(98765, "woo.revenue");
    expect(v).toMatch(/^\$\d+k?$/);
  });
});

describe("date short formatter", () => {
  it("formats to D MMM style", () => {
    expect(formatDateShort("2026-07-02")).toBe("2 Jul");
    expect(formatDateShort("2026-01-15")).toBe("15 Jan");
  });
});
