import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { scopes, principals } from "./kernel";

// documents: markdown-canonical per-scope KB. slug unique per scope. soft archive via archived_at.
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    position: integer("position").notNull().default(0),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => principals.id),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    uniqueScopeSlug: uniqueIndex("documents_scope_slug_unique").on(t.scopeId, t.slug),
    scopeUpdatedIdx: index("documents_scope_updated_idx").on(t.scopeId, t.updatedAt),
  })
);

// document_revisions: immutable history, keep last 50 per doc
export const documentRevisions = pgTable(
  "document_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    savedBy: uuid("saved_by")
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

// Typed models (inferred shape preserved manually for TS strict)
export interface Document {
  id: string;
  scopeId: string;
  slug: string;
  title: string;
  bodyMd: string;
  position: number;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}
export type NewDocument = Partial<Omit<Document, "id" | "createdAt" | "updatedAt">> &
  Pick<Document, "scopeId" | "slug" | "title" | "createdBy" | "updatedBy"> & { bodyMd?: string; position?: number };

export interface DocumentRevision {
  id: string;
  documentId: string;
  title: string;
  bodyMd: string;
  savedBy: string;
  createdAt: Date;
}
export type NewDocumentRevision = Pick<DocumentRevision, "documentId" | "title" | "bodyMd" | "savedBy">;
