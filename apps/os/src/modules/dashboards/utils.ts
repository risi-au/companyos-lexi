// Consume spec (Widget grid) without forking the schema file
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Widget = any;

export type RangeKey = "7d" | "30d" | "90d";

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;
  prevFrom: string;
  prevTo: string;
  days: number;
}

export function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function resolveRange(range: RangeKey = "7d"): DateRange {
  const now = new Date();
  // UTC date at start of day
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let days = 7;
  if (range === "30d") days = 30;
  if (range === "90d") days = 90;
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  const prevTo = new Date(from);
  prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1));
  return {
    from: toDateStr(from),
    to: toDateStr(to),
    prevFrom: toDateStr(prevFrom),
    prevTo: toDateStr(prevTo),
    days,
  };
}

export function formatDateShort(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00Z");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

export function formatValue(value: number, metricName?: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const name = (metricName || "").toLowerCase();
  const isMoney = name.includes("spend") || name.includes("revenue") || name.includes("cost") || name.includes("price") || name.includes("sales");
  const abs = Math.abs(value);
  let s: string;
  if (abs >= 1_000_000) {
    s = (value / 1_000_000).toFixed(1) + "M";
  } else if (abs >= 10000) {
    s = Math.round(value / 1000) + "k";
  } else if (abs >= 1000) {
    s = (value / 1000).toFixed(1) + "k";
  } else if (isMoney && abs >= 100) {
    s = value.toFixed(0);
  } else if (isMoney) {
    s = value.toFixed(2);
  } else {
    s = abs < 10 ? value.toFixed(2) : value.toFixed(0);
  }
  if (isMoney) {
    if (value < 0) s = "-" + s.replace(/^-/, "");
    s = "$" + s;
  }
  return s;
}

export function computeDelta(curr: number, prev: number | null | undefined): { pct: number | null; arrow: string; colorClass: string } {
  if (prev == null || !Number.isFinite(prev) || prev === 0) {
    return { pct: null, arrow: "", colorClass: "text-[var(--muted-foreground)]" };
  }
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  const rounded = Math.round(pct);
  const arrow = pct > 0 ? "↑" : pct < 0 ? "↓" : "→";
  const colorClass = pct > 0 ? "text-[var(--status-ok)]" : pct < 0 ? "text-[var(--status-error)]" : "text-[var(--muted-foreground)]";
  return { pct: rounded, arrow, colorClass };
}

export function getRangeOptions() {
  return ["7d", "30d", "90d"] as const;
}

export function getWidgetHeight(widget: Widget): number {
  return widget.grid?.h || 2;
}

// Simple safe markdown renderer props type
export interface TextWidgetData {
  markdown: string;
}
