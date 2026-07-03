import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { scopes, tokens } from "./kernel";

export const capabilities = pgTable(
  "capabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    engine: text("engine").notNull(),
    engineRef: text("engine_ref"),
    tokenId: uuid("token_id").references(() => tokens.id, { onDelete: "set null" }),
    status: text("status").notNull().default("active"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueScopeName: uniqueIndex("capabilities_scope_name_unique").on(t.scopeId, t.name),
  })
);

export const capabilityRuns = pgTable(
  "capability_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    capabilityId: uuid("capability_id")
      .notNull()
      .references(() => capabilities.id, { onDelete: "cascade" }),
    runRef: text("run_ref"),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    summary: text("summary"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    capabilityStartedIdx: index("capability_runs_capability_started_idx").on(t.capabilityId, t.startedAt),
    uniqueCapabilityRunRef: uniqueIndex("capability_runs_capability_run_ref_unique")
      .on(t.capabilityId, t.runRef)
      .where(sql`${t.runRef} is not null`),
  })
);

export interface Capability {
  id: string;
  scopeId: string;
  name: string;
  engine: string;
  engineRef: string | null;
  tokenId: string | null;
  status: "active" | "disabled" | string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export type NewCapability = Pick<Capability, "scopeId" | "name" | "engine"> &
  Partial<Pick<Capability, "engineRef" | "tokenId" | "status" | "description">>;

export interface CapabilityRun {
  id: string;
  capabilityId: string;
  runRef: string | null;
  status: "running" | "success" | "error" | string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  summary: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}
export type NewCapabilityRun = Pick<CapabilityRun, "capabilityId" | "status"> &
  Partial<Pick<CapabilityRun, "runRef" | "startedAt" | "finishedAt" | "durationMs" | "summary" | "payload">>;
