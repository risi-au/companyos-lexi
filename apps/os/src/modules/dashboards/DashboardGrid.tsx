import React from "react";
// Consume spec shape without direct module fork (types via api surface)
type DashboardSpec = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Widget = any; // eslint-disable-line @typescript-eslint/no-explicit-any
import { MetricCard } from "./MetricCard";
import { TimeseriesWidget } from "./TimeseriesWidget";
import { BarWidget } from "./BarWidget";
import { TableWidget } from "./TableWidget";
import { TasksWidget } from "./TasksWidget";
import { RecordsWidget } from "./RecordsWidget";
import { TextWidget } from "./TextWidget";
import { resolveRange } from "./utils";
import type { RangeKey } from "./utils";
import { api } from "@/lib/api";

interface DashboardGridProps {
  spec: DashboardSpec;
  scopePath: string;
  actor: string;
  rangeKey?: string;
}

interface WidgetData {
  current?: number;
  prev?: number | null;
  series?: Array<{ metric: string; points: Array<[string, number]>; dim?: string | null }>;
  records?: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  tasks?: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  error?: string;
}

export async function DashboardRenderer({ spec, scopePath, actor, rangeKey }: DashboardGridProps) {
  const rKey: RangeKey = (["7d", "30d", "90d"].includes(rangeKey || "") ? (rangeKey as RangeKey) : spec.range.default) || "7d";
  const win = resolveRange(rKey);

  // Preload data per data widget. Keep simple; parallel where possible.
  const widgetDataMap = new Map<string, WidgetData>();

  for (const w of spec.widgets) {
    if (["metric-card", "timeseries", "bar", "table"].includes(w.type) && w.query) {
      try {
        const q = w.query;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const seriesCurr = await api.queryMetrics(
          {
            scopePath,
            metrics: q.metrics,
            from: win.from,
            to: win.to,
            agg: q.agg,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            groupBy: q.groupBy as any,
            filters: q.filters,
          },
          actor
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let seriesPrev: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (q.compare === "prev_period") {
          seriesPrev = await api.queryMetrics(
            {
              scopePath,
              metrics: q.metrics,
              from: win.prevFrom,
              to: win.prevTo,
              agg: q.agg,
              groupBy: q.groupBy as any, // eslint-disable-line @typescript-eslint/no-explicit-any
              filters: q.filters,
            },
            actor
          );
        }
        // For metric-card pick first (or sum if multiple)
        let currVal = 0;
        let prevVal: number | null = null;
        if (w.type === "metric-card") {
          // aggregate all series for the card
          const sumCurr = seriesCurr.reduce((sum, s) => sum + s.points.reduce((pSum: number, p: any) => pSum + (p[1] || 0), 0), 0); // eslint-disable-line @typescript-eslint/no-explicit-any
          currVal = sumCurr;
          if (q.compare === "prev_period") {
            const sumPrev = seriesPrev.reduce((sum, s) => sum + s.points.reduce((pSum: number, p: any) => pSum + (p[1] || 0), 0), 0); // eslint-disable-line @typescript-eslint/no-explicit-any
            prevVal = sumPrev;
          }
        }
        widgetDataMap.set(w.id, {
          current: currVal,
          prev: prevVal,
          series: seriesCurr,
        });
      } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        widgetDataMap.set(w.id, { error: e?.message || "Query failed" });
      }
    } else if (w.type === "tasks") {
      try {
        const opts = (w.options || {}) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const state = opts.state === "completed" ? "completed" : "open";
        const lim = Math.min(50, Math.max(1, Number(opts.limit) || 8));
        const tasks = await api.listTasks({ scopePath, state, limit: lim }, actor);
        widgetDataMap.set(w.id, { tasks });
      } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        widgetDataMap.set(w.id, { error: e?.message || "Tasks failed", tasks: [] });
      }
    } else if (w.type === "records") {
      try {
        const opts = (w.options || {}) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const lim = Math.min(50, Math.max(1, Number(opts.limit) || 8));
        const recs = await api.listRecords({ scopePath, limit: lim }, actor);
        widgetDataMap.set(w.id, { records: recs });
      } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        widgetDataMap.set(w.id, { error: e?.message || "Records failed", records: [] });
      }
    }
  }

  const widgets = spec.widgets;

  return (
    <div className="dashboard-grid" style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))" }}>
      {widgets.map((w: Widget) => {
        const data = widgetDataMap.get(w.id) || {};
        const style: React.CSSProperties = {
          gridColumn: `${w.grid.x + 1} / span ${w.grid.w}`,
          gridRow: `${w.grid.y + 1} / span ${w.grid.h}`,
        };
        const commonTitle = w.title || w.id;

        if (w.type === "metric-card") {
          const val = data.current ?? 0;
          return (
            <div key={w.id} className="dashboard-widget" style={style}>
              <MetricCard
                title={commonTitle}
                value={val}
                prevValue={data.prev}
                metricName={w.query?.metrics?.[0]}
                loading={false}
              />
            </div>
          );
        }
        if (w.type === "timeseries") {
          return (
            <div key={w.id} className="dashboard-widget" style={style}>
              <TimeseriesWidget title={commonTitle} series={data.series || []} error={data.error} />
            </div>
          );
        }
        if (w.type === "bar") {
          return (
            <div key={w.id} className="dashboard-widget" style={style}>
              <BarWidget title={commonTitle} series={data.series || []} error={data.error} />
            </div>
          );
        }
        if (w.type === "table") {
          return (
            <div key={w.id} className="dashboard-widget" style={style}>
              <TableWidget title={commonTitle} series={data.series || []} error={data.error} />
            </div>
          );
        }
        if (w.type === "tasks") {
          return (
            <div key={w.id} className="dashboard-widget" style={style}>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <TasksWidget title={commonTitle} tasks={(data.tasks || []).map((t: any) => ({ id: t.id, title: t.title || t.name, url: t.url }))} />
            </div>
          );
        }
        if (w.type === "records") {
          return (
            <div key={w.id} className="dashboard-widget" style={style}>
              <RecordsWidget title={commonTitle} records={data.records || []} />
            </div>
          );
        }
        if (w.type === "text") {
          const md = (w.options as any)?.markdown || ""; // eslint-disable-line @typescript-eslint/no-explicit-any
          return (
            <div key={w.id} className="dashboard-widget" style={style}>
              <TextWidget title={commonTitle} markdown={md} />
            </div>
          );
        }
        return (
          <div key={w.id} className="dashboard-widget rounded border p-3" style={style}>
            Unknown widget type: {w.type}
          </div>
        );
      })}
    </div>
  );
}

export function DashboardEmptyState({ scopePath }: { scopePath: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-6)]">
      <div className="text-[var(--font-size-sm)] font-medium mb-2">No dashboard yet</div>
      <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
        An agent can create one with <span className="font-mono">save_dashboard</span> for this scope.
      </div>
      <div className="mt-3 text-[var(--font-size-xs)] text-[var(--muted-foreground)] font-mono break-all">
        scope: {scopePath}
      </div>
    </div>
  );
}

export function RangePicker({ scopePath, currentRange }: { scopePath: string; currentRange: string }) {
  const options = ["7d", "30d", "90d"] as const;
  return (
    <div className="inline-flex rounded-[var(--radius-sm)] border border-[var(--border)] overflow-hidden text-[var(--font-size-sm)]">
      {options.map((opt) => {
        const active = opt === currentRange;
        const href = `/s/${scopePath}?tab=dashboard&range=${opt}`;
        return (
          <a
            key={opt}
            href={href}
            className={`px-[var(--space-3)] py-[var(--space-1)] ${active ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "hover:bg-[var(--muted)] text-[var(--foreground)]"}`}
            aria-current={active ? "page" : undefined}
          >
            {opt}
          </a>
        );
      })}
    </div>
  );
}
