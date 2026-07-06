import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { connections } from "./connect";
import { principals, scopes, tokens } from "./kernel";
import { agentSessions } from "./sessions";

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id").references(() => scopes.id, { onDelete: "set null" }),
    principalId: uuid("principal_id").references(() => principals.id, { onDelete: "set null" }),
    tokenId: uuid("token_id").references(() => tokens.id, { onDelete: "set null" }),
    sessionId: uuid("session_id").references(() => agentSessions.id, { onDelete: "set null" }),
    connectionId: uuid("connection_id").references(() => connections.id, { onDelete: "set null" }),
    source: text("source").notNull(),
    engine: text("engine"),
    model: text("model"),
    operation: text("operation").notNull(),
    inputTokensEst: integer("input_tokens_est"),
    outputTokensEst: integer("output_tokens_est"),
    totalTokensEst: integer("total_tokens_est"),
    actualInputTokens: integer("actual_input_tokens"),
    actualOutputTokens: integer("actual_output_tokens"),
    actualCostUsd: numeric("actual_cost_usd", { precision: 18, scale: 8 }),
    byteIn: integer("byte_in").notNull().default(0),
    byteOut: integer("byte_out").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    success: boolean("success").notNull(),
    errorCode: text("error_code"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeCreatedIdx: index("usage_events_scope_created_idx").on(t.scopeId, t.createdAt),
    principalCreatedIdx: index("usage_events_principal_created_idx").on(t.principalId, t.createdAt),
    tokenCreatedIdx: index("usage_events_token_created_idx").on(t.tokenId, t.createdAt),
    sessionCreatedIdx: index("usage_events_session_created_idx").on(t.sessionId, t.createdAt),
    connectionCreatedIdx: index("usage_events_connection_created_idx").on(t.connectionId, t.createdAt),
    operationCreatedIdx: index("usage_events_operation_created_idx").on(t.operation, t.createdAt),
  })
);

export const contextProfiles = pgTable(
  "context_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id").references(() => scopes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    config: jsonb("config").notNull().default({}),
    isDefault: boolean("is_default").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeDefaultIdx: index("context_profiles_scope_default_idx").on(t.scopeId, t.isDefault),
    scopeNameIdx: index("context_profiles_scope_name_idx").on(t.scopeId, t.name),
  })
);

export interface UsageEvent {
  id: string;
  scopeId: string | null;
  principalId: string | null;
  tokenId: string | null;
  sessionId: string | null;
  connectionId: string | null;
  source: string;
  engine: string | null;
  model: string | null;
  operation: string;
  inputTokensEst: number | null;
  outputTokensEst: number | null;
  totalTokensEst: number | null;
  actualInputTokens: number | null;
  actualOutputTokens: number | null;
  actualCostUsd: string | null;
  byteIn: number;
  byteOut: number;
  latencyMs: number;
  success: boolean;
  errorCode: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export type NewUsageEvent = Omit<UsageEvent, "id" | "createdAt">;

export interface ContextProfile {
  id: string;
  scopeId: string | null;
  name: string;
  config: Record<string, unknown>;
  isDefault: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type NewContextProfile = Pick<ContextProfile, "name" | "config" | "createdBy"> &
  Partial<Pick<ContextProfile, "scopeId" | "isDefault">>;
