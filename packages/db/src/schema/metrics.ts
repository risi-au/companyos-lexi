import {
  pgTable,
  uuid,
  text,
  date,
  numeric,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { scopes } from "./kernel";

// metrics - generic time-series points, upsert by (scope, metric, date, dims_hash)
export const metrics = pgTable(
  "metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    value: numeric("value", { precision: 18, scale: 4 }).notNull(),
    dims: jsonb("dims").notNull().default({}),
    dimsHash: text("dims_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueScopeMetricDateDims: uniqueIndex("metrics_scope_metric_date_dims_hash_unique").on(
      t.scopeId,
      t.metric,
      t.date,
      t.dimsHash
    ),
    scopeMetricDateIdx: index("metrics_scope_metric_date_idx").on(
      t.scopeId,
      t.metric,
      t.date
    ),
  })
);

// Typed models (inferred shape preserved manually for TS strict)
export interface Metric {
  id: string;
  scopeId: string;
  metric: string;
  date: string; // YYYY-MM-DD
  value: string; // stored as numeric, returned as string by drizzle
  dims: Record<string, unknown>;
  dimsHash: string;
  createdAt: Date;
  updatedAt: Date;
}
export type NewMetric = Partial<Omit<Metric, "id" | "createdAt" | "updatedAt">> &
  Pick<Metric, "scopeId" | "metric" | "date" | "value" | "dimsHash"> & { dims?: Record<string, unknown> };
