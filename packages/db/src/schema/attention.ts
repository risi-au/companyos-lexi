import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { scopes, principals } from "./kernel";

export const attentionKindEnum = pgEnum("attention_kind", [
  "wiki_proposal",
  "lint_finding",
  "graduation",
  "external_gate",
  "page_update",
  "open_question",
  "connection_expiry",
]);

export const attentionStatusEnum = pgEnum("attention_status", [
  "open",
  "approved",
  "rejected",
  "dismissed",
]);

export const attentionItems = pgTable(
  "attention_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    kind: attentionKindEnum("kind").notNull(),
    status: attentionStatusEnum("status").notNull().default("open"),
    title: text("title").notNull(),
    summary: text("summary"),
    payload: jsonb("payload").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => principals.id),
    targetPrincipalId: uuid("target_principal_id").references(() => principals.id, { onDelete: "cascade" }),
    resolvedBy: uuid("resolved_by").references(() => principals.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeStatusCreatedIdx: index("attention_items_scope_status_created_idx").on(t.scopeId, t.status, t.createdAt),
    kindStatusIdx: index("attention_items_kind_status_idx").on(t.kind, t.status),
    targetStatusIdx: index("attention_items_target_status_idx").on(t.targetPrincipalId, t.status),
    intakeOrdinalUniqueIdx: uniqueIndex("attention_items_intake_ordinal_idx")
      .on(t.scopeId, sql`(${t.payload}->>'intakeId')`, sql`(${t.payload}->>'ordinal')`)
      .where(sql`(${t.payload}->>'source') = 'intake' AND (${t.payload}->>'ordinal') IS NOT NULL`),
  })
);

export interface AttentionItem {
  id: string;
  scopeId: string;
  kind: "wiki_proposal" | "lint_finding" | "graduation" | "external_gate" | "page_update" | "open_question" | "connection_expiry";
  status: "open" | "approved" | "rejected" | "dismissed";
  title: string;
  summary: string | null;
  payload: Record<string, unknown>;
  createdBy: string;
  targetPrincipalId: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewAttentionItem = Partial<Omit<AttentionItem, "id" | "status" | "createdAt" | "updatedAt" | "resolvedBy" | "resolvedAt" | "resolutionNote">> &
  Pick<AttentionItem, "scopeId" | "kind" | "title" | "payload" | "createdBy"> &
  Partial<Pick<AttentionItem, "status" | "summary" | "targetPrincipalId" | "resolvedBy" | "resolvedAt" | "resolutionNote">>;
