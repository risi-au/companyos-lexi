import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { scopes, principals } from "./kernel";

// dashboards: validated spec storage per (scope, name)
export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("main"),
    spec: jsonb("spec").notNull().default({}),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueScopeName: uniqueIndex("dashboards_scope_name_unique").on(t.scopeId, t.name),
  })
);

// dashboard_revisions: immutable history, keep last 50
export const dashboardRevisions = pgTable(
  "dashboard_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dashboardId: uuid("dashboard_id")
      .notNull()
      .references(() => dashboards.id, { onDelete: "cascade" }),
    spec: jsonb("spec").notNull(),
    savedBy: uuid("saved_by")
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

// Typed models (inferred shape preserved manually for TS strict)
export interface Dashboard {
  id: string;
  scopeId: string;
  name: string;
  spec: Record<string, unknown>;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}
export type NewDashboard = Partial<Omit<Dashboard, "id" | "createdAt" | "updatedAt">> &
  Pick<Dashboard, "scopeId" | "name" | "spec" | "updatedBy">;

export interface DashboardRevision {
  id: string;
  dashboardId: string;
  spec: Record<string, unknown>;
  savedBy: string;
  createdAt: Date;
}
export type NewDashboardRevision = Pick<DashboardRevision, "dashboardId" | "spec" | "savedBy">;
