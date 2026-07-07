import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { principals, scopes } from "./kernel";

export const intakePacketStatusEnum = pgEnum("intake_packet_status", [
  "draft",
  "awaiting_external",
  "needs_review",
  "approved",
  "provisioned",
  "rejected",
  "dismissed",
]);

export const intakePackets = pgTable(
  "intake_packets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id").notNull().references(() => scopes.id, { onDelete: "cascade" }),
    status: intakePacketStatusEnum("status").notNull().default("draft"),
    templateSlug: text("template_slug").notNull().default("new-project"),
    answers: jsonb("answers").notNull().default({}),
    packetMd: text("packet_md"),
    researchSources: jsonb("research_sources").notNull().default([]),
    proposedProvisionSpec: jsonb("proposed_provision_spec").notNull().default({}),
    proposedDocs: jsonb("proposed_docs").notNull().default([]),
    proposedTasks: jsonb("proposed_tasks").notNull().default([]),
    proposedWikiUpdates: jsonb("proposed_wiki_updates").notNull().default([]),
    openQuestions: jsonb("open_questions").notNull().default([]),
    riskNotes: jsonb("risk_notes").notNull().default([]),
    reusePatternSlug: text("reuse_pattern_slug"),
    sourceEngine: text("source_engine"),
    sourceModel: text("source_model"),
    submittedBy: uuid("submitted_by").references(() => principals.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => principals.id, { onDelete: "set null" }),
    reportRecordId: uuid("report_record_id"),
    artifactLinks: jsonb("artifact_links").notNull().default({}),
    packSnapshot: text("pack_snapshot"),
    relatedHistorySelections: jsonb("related_history_selections").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
  },
  (t) => ({
    scopeStatusIdx: index("intake_packets_scope_status_idx").on(t.scopeId, t.status, t.updatedAt),
    statusUpdatedIdx: index("intake_packets_status_updated_idx").on(t.status, t.updatedAt),
  })
);

export interface IntakePacket {
  id: string;
  scopeId: string;
  status: "draft" | "awaiting_external" | "needs_review" | "approved" | "provisioned" | "rejected" | "dismissed";
  templateSlug: string;
  answers: unknown;
  packetMd: string | null;
  researchSources: unknown;
  proposedProvisionSpec: unknown;
  proposedDocs: unknown;
  proposedTasks: unknown;
  proposedWikiUpdates: unknown;
  openQuestions: unknown;
  riskNotes: unknown;
  reusePatternSlug: string | null;
  sourceEngine: string | null;
  sourceModel: string | null;
  submittedBy: string | null;
  approvedBy: string | null;
  reportRecordId: string | null;
  artifactLinks: unknown;
  packSnapshot: string | null;
  relatedHistorySelections: unknown;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
  approvedAt: Date | null;
  provisionedAt: Date | null;
}
