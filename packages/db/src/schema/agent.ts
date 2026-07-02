import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

import { scopes, principals } from "./kernel";

// Enums
export const agentMessageRoleEnum = pgEnum("agent_message_role", ["user", "assistant", "tool"]);

// agent_conversations: per-scope chat threads. Title derived from first user msg.
export const agentConversations = pgTable(
  "agent_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeCreatedIdx: index("agent_conversations_scope_created_idx").on(
      t.scopeId,
      t.createdAt
    ),
  })
);

// agent_messages: full history for a conversation (user/assistant/tool). Content is jsonb for flexibility (text + tool metadata).
export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => agentConversations.id, { onDelete: "cascade" }),
    role: agentMessageRoleEnum("role").notNull(),
    content: jsonb("content").notNull().default({}),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    convCreatedIdx: index("agent_messages_conv_created_idx").on(
      t.conversationId,
      t.createdAt
    ),
  })
);

// Typed models (inferred shape preserved manually for TS strict)
export interface AgentConversation {
  id: string;
  scopeId: string;
  title: string;
  createdBy: string;
  createdAt: Date;
}
export type NewAgentConversation = Partial<Omit<AgentConversation, "id" | "createdAt">> &
  Pick<AgentConversation, "scopeId" | "title" | "createdBy">;

export interface AgentMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "tool";
  content: Record<string, unknown>;
  model: string | null;
  createdAt: Date;
}
export type NewAgentMessage = Partial<Omit<AgentMessage, "id" | "createdAt">> &
  Pick<AgentMessage, "conversationId" | "role" | "content"> & { model?: string | null };
