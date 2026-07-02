/* eslint-disable @typescript-eslint/no-explicit-any */
import { eq, and, gte, lte, sql, asc, or } from "drizzle-orm";
import { metrics } from "@companyos/db";
import { createHash } from "crypto";
import {
  emitEvent,
  type DB,
} from "../../kernel/events";
import { getScope } from "../../kernel/scopes";
import { requireAccess } from "../../kernel/grants";
import {
  ScopeNotFoundError,
} from "../../errors";

export interface MetricPointInput {
  metric: string;
  date: string; // YYYY-MM-DD
  value: number | string;
  dims?: Record<string, string | number | boolean | null>;
}

export interface WriteMetricsInput {
  scopePath: string;
  points: MetricPointInput[];
}

function canonicalDimsHash(dims: Record<string, unknown> = {}): string {
  const sortedKeys = Object.keys(dims).sort();
  const canonical: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    canonical[k] = dims[k];
  }
  const str = JSON.stringify(canonical);
  return createHash("sha256").update(str).digest("hex");
}

export async function writeMetrics(
  db: DB,
  input: WriteMetricsInput,
  actorPrincipalId: string
): Promise<{ written: number; metrics: string[] }> {
  const { scopePath, points } = input;

  if (!Array.isArray(points) || points.length === 0) {
    return { written: 0, metrics: [] };
  }
  if (points.length > 1000) {
    throw new Error("writeMetrics max 1000 points per call");
  }

  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  await requireAccess(db, actorPrincipalId, scopePath, "editor");

  const uniqueMetricNames = new Set<string>();
  const valuesToInsert: any[] = [];

  for (const p of points) {
    if (!p.metric || !p.date || p.value == null) continue;
    const dims = p.dims ?? {};
    const dimsHash = canonicalDimsHash(dims);
    const valStr = typeof p.value === "number" ? p.value.toFixed(4) : String(p.value);
    uniqueMetricNames.add(p.metric);
    valuesToInsert.push({
      scopeId: scope.id,
      metric: p.metric,
      date: p.date,
      value: valStr,
      dims,
      dimsHash,
    });
  }

  if (valuesToInsert.length === 0) {
    return { written: 0, metrics: [] };
  }

  // Batch upsert: on conflict (scope,metric,date,dims_hash) do update value + updated_at
  await db
    .insert(metrics)
    .values(valuesToInsert)
    .onConflictDoUpdate({
      target: [metrics.scopeId, metrics.metric, metrics.date, metrics.dimsHash],
      set: {
        value: sql`excluded.value`,
        updatedAt: new Date(),
      },
    });

  const metricNames = Array.from(uniqueMetricNames).sort();

  await emitEvent(db, {
    type: "metrics.written",
    scopePath,
    principalId: actorPrincipalId,
    payload: {
      count: valuesToInsert.length,
      metrics: metricNames,
    },
  });

  return { written: valuesToInsert.length, metrics: metricNames };
}

export interface QueryMetricsInput {
  scopePath: string;
  metrics: string[];
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  groupBy?: "date" | "metric" | string; // dimKey e.g. "campaign"
  filters?: Record<string, string>;
  agg?: "sum" | "avg" | "min" | "max";
}

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface MetricSeries {
  metric: string;
  dim?: string | null; // e.g. "campaign=prospecting" or the dim value if grouped by dim
  points: [string, number][]; // compact [date, value]
}

export async function queryMetrics(
  db: DB,
  input: QueryMetricsInput,
  actorPrincipalId: string
): Promise<MetricSeries[]> {
  const { scopePath, metrics: metricNames, from, to, groupBy, filters = {}, agg = "sum" } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    return [];
  }

  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  if (!metricNames || metricNames.length === 0) {
    return [];
  }

  const conditions: any[] = [
    eq(metrics.scopeId, scope.id),
    gte(metrics.date, from),
    lte(metrics.date, to),
  ];

  // metric filter (use or of eq to avoid sql.array type issues)
  if (metricNames.length === 1) {
    conditions.push(eq(metrics.metric, metricNames[0]!));
  } else {
    conditions.push(or(...metricNames.map((m) => eq(metrics.metric, m)))!);
  }

  // filters on dims jsonb
  for (const [k, v] of Object.entries(filters)) {
    if (v != null) {
      conditions.push(sql`${metrics.dims} ->> ${k} = ${v}`);
    }
  }

  const where = and(...conditions);

  const aggFn = {
    sum: sql`sum(${metrics.value}::numeric)`,
    avg: sql`avg(${metrics.value}::numeric)`,
    min: sql`min(${metrics.value}::numeric)`,
    max: sql`max(${metrics.value}::numeric)`,
  }[agg] || sql`sum(${metrics.value}::numeric)`;

  let rows: any[];

  if (groupBy === "date") {
    // aggregate per metric per date (collapse dims)
    rows = await db
      .select({
        metric: metrics.metric,
        date: metrics.date,
        value: aggFn.as("value"),
      })
      .from(metrics)
      .where(where)
      .groupBy(metrics.metric, metrics.date)
      .orderBy(asc(metrics.metric), asc(metrics.date));
  } else if (groupBy === "metric") {
    // aggregate per metric (collapse date and dims)
    rows = await db
      .select({
        metric: metrics.metric,
        value: aggFn.as("value"),
      })
      .from(metrics)
      .where(where)
      .groupBy(metrics.metric);
  } else if (groupBy && groupBy !== "date" && groupBy !== "metric") {
    // group by specific dim key: produce series per (metric, dimValue)
    const dimKey = groupBy;
    rows = await db
      .select({
        metric: metrics.metric,
        dimVal: sql`${metrics.dims} ->> ${dimKey}`.as("dimVal"),
        date: metrics.date,
        value: aggFn.as("value"),
      })
      .from(metrics)
      .where(where)
      .groupBy(metrics.metric, sql`${metrics.dims} ->> ${dimKey}`, metrics.date, metrics.dims)
      .orderBy(asc(metrics.metric), asc(sql`${metrics.dims} ->> ${dimKey}`), asc(metrics.date));
  } else {
    // default: no groupBy special — per metric per dims? but to keep simple, per (metric, date) collapsing dims like date
    // or treat as per metric/date
    rows = await db
      .select({
        metric: metrics.metric,
        date: metrics.date,
        value: aggFn.as("value"),
      })
      .from(metrics)
      .where(where)
      .groupBy(metrics.metric, metrics.date)
      .orderBy(asc(metrics.metric), asc(metrics.date));
  }

  // Build compact series output
  const seriesMap = new Map<string, MetricSeries>();

  for (const r of rows) {
    const mName = r.metric as string;
    let key: string;
    let dimLabel: string | null = null;

    if (groupBy && groupBy !== "date" && groupBy !== "metric") {
      const dVal = r.dimVal;
      dimLabel = dVal != null ? `${groupBy}=${dVal}` : null;
      key = `${mName}|${dimLabel ?? ""}`;
    } else if (groupBy === "metric") {
      key = mName;
    } else {
      key = mName;
    }

    if (!seriesMap.has(key)) {
      seriesMap.set(key, { metric: mName, dim: dimLabel, points: [] });
    }
    const ser = seriesMap.get(key)!;

    if (groupBy === "metric") {
      // groupBy metric: emit single aggregate value at 'from' to fit [[date, value]] shape
      ser.points[0] = [from, Number(r.value) || 0];
    } else {
      const d = r.date as string;
      const v = Number(r.value) || 0;
      ser.points.push([d, v]);
    }
  }

  // For default and groupBy date, ensure points sorted
  for (const ser of seriesMap.values()) {
    if (ser.points.length > 1) {
      ser.points.sort((a, b) => a[0].localeCompare(b[0]));
    }
  }

  return Array.from(seriesMap.values());
}

export interface ListMetricNamesInput {
  scopePath: string;
}

export interface MetricNameInfo {
  metric: string;
  firstDate: string | null;
  lastDate: string | null;
}

export async function listMetricNames(
  db: DB,
  input: ListMetricNamesInput,
  actorPrincipalId: string
): Promise<MetricNameInfo[]> {
  const { scopePath } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    return [];
  }

  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const rows = await db
    .select({
      metric: metrics.metric,
      firstDate: sql<string | null>`min(${metrics.date})`.as("firstDate"),
      lastDate: sql<string | null>`max(${metrics.date})`.as("lastDate"),
    })
    .from(metrics)
    .where(eq(metrics.scopeId, scope.id))
    .groupBy(metrics.metric)
    .orderBy(asc(metrics.metric));

  return rows.map((r: any) => ({
    metric: r.metric as string,
    firstDate: r.firstDate ?? null,
    lastDate: r.lastDate ?? null,
  }));
}
