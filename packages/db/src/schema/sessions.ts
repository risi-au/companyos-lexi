import {
  pgTable,
  uuid,
  text,
  jsonb,
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
    brief: jsonb("brief"),
    summary: text("summary"),
    citations: jsonb("citations"),
    structuredReturn: jsonb("structured_return"),
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

export interface SessionBrief {
  /** One-line goal for the session. Required when a brief is provided. */
  goal: string;
  /** Scope paths, doc slugs, or record ids that frame the work. */
  contextRefs?: string[];
  /** Reference to the kickoff artifact (doc slug or record id). */
  kickoffArtifactRef?: string;
  /** Free-text description or schema hint of what the wrap-up should contain. */
  expectedReturn?: string;
}

export interface SessionStructuredReturn {
  /** What happened / the result. Required when a structured return is provided. */
  outcome: string;
  /** Refs to artifacts produced (doc slugs, record ids, urls). */
  artifacts?: string[];
  /** Record ids logged during the session. */
  recordsLogged?: string[];
  /** Points where a human had to intervene. */
  humanInterventions?: string[];
  /** What was hard, blocked, or surprising. */
  friction?: string[];
  /** Follow-up actions for next time. */
  followUps?: string[];
}

export interface AgentSessionCitation {
  slug: string;
  scopePath: string;
  revisionId?: string;
  source: "scope" | "ancestor" | "root-pattern" | "critical-facts" | "personal";
  title?: string;
}

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
  brief: SessionBrief | null;
  summary: string | null;
  citations: AgentSessionCitation[] | null;
  structuredReturn: SessionStructuredReturn | null;
  lastHeartbeat: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type NewAgentSession = Pick<AgentSession, "scopeId" | "title" | "engine" | "createdBy"> &
  Partial<Pick<AgentSession, "model" | "status" | "tokenId" | "principalId" | "worktreeRef" | "brief" | "summary" | "citations" | "structuredReturn" | "lastHeartbeat">>;
