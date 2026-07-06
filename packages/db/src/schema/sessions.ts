import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

import { principals, scopes, tokens } from "./kernel";

export const sessionStatusEnum = pgEnum("session_status", [
  "running",
  "waiting",
  "idle",
  "completed",
  "error",
]);

// agent_sessions: cooperative registry of agent/client work sessions scoped to the tree.
export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    engine: text("engine").notNull(),
    model: text("model"),
    status: sessionStatusEnum("status").notNull().default("running"),
    tokenId: uuid("token_id").references(() => tokens.id, { onDelete: "set null" }),
    principalId: uuid("principal_id").references(() => principals.id, { onDelete: "set null" }),
    worktreeRef: text("worktree_ref"),
    lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeStatusUpdatedIdx: index("agent_sessions_scope_status_updated_idx").on(t.scopeId, t.status, t.updatedAt),
  })
);

export interface AgentSession {
  id: string;
  scopeId: string;
  title: string;
  engine: string;
  model: string | null;
  status: "running" | "waiting" | "idle" | "completed" | "error";
  tokenId: string | null;
  principalId: string | null;
  worktreeRef: string | null;
  lastHeartbeat: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type NewAgentSession = Pick<AgentSession, "scopeId" | "title" | "engine" | "createdBy"> &
  Partial<Pick<AgentSession, "model" | "status" | "tokenId" | "principalId" | "worktreeRef" | "lastHeartbeat">>;
