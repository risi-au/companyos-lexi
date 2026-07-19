import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";

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

const vectorColumn = customType<{ data: number[]; driverData: string; config: { dimensions?: number } }>({
  dataType(config) {
    const dimensions = config?.dimensions ?? Number(process.env.EMBEDDING_DIMENSIONS || 1536);
    return `vector(${dimensions})`;
  },
  toDriver(value) {
    return `[${value.map((n) => Number(n)).join(",")}]`;
  },
  fromDriver(value) {
    return String(value)
      .replace(/^\[|\]$/g, "")
      .split(",")
      .filter(Boolean)
      .map((part) => Number(part));
  },
});

export const embeddings = pgTable(
  "embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    model: text("model").notNull(),
    embedding: vectorColumn("embedding", { dimensions: Number(process.env.EMBEDDING_DIMENSIONS || 1536) }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueEntity: uniqueIndex("embeddings_entity_unique").on(t.entityType, t.entityId),
    scopeEntityIdx: index("embeddings_scope_entity_idx").on(t.scopeId, t.entityType),
    updatedIdx: index("embeddings_updated_idx").on(t.updatedAt),
  })
);

export const docLinks = pgTable(
  "doc_links",
  {
    fromDocumentId: uuid("from_document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    toScopeId: uuid("to_scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    toSlug: text("to_slug").notNull(),
    toDocumentId: uuid("to_document_id").references(() => documents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    fromIdx: index("doc_links_from_idx").on(t.fromDocumentId),
    toScopeSlugIdx: index("doc_links_to_scope_slug_idx").on(t.toScopeId, t.toSlug),
    toDocumentIdx: index("doc_links_to_document_idx").on(t.toDocumentId),
    uniqueLink: uniqueIndex("doc_links_unique").on(t.fromDocumentId, t.toScopeId, t.toSlug),
  })
);

export const docFollows = pgTable(
  "doc_follows",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueDocumentPrincipal: uniqueIndex("doc_follows_document_principal_unique").on(t.documentId, t.principalId),
    principalIdx: index("doc_follows_principal_idx").on(t.principalId),
  })
);

export function isReservedOperationalWikiReportSlug(slug: string): boolean {
  return slug === "lint-report" || slug.startsWith("lint-report");
}

export function notReservedOperationalWikiReportSlug(slugColumn: typeof documents.slug): SQL {
  return sql`${slugColumn} not like 'lint-report%'`;
}
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

export interface Embedding {
  id: string;
  entityType: "doc" | "record" | string;
  entityId: string;
  scopeId: string;
  contentHash: string;
  model: string;
  embedding: number[];
  updatedAt: Date;
}
export type NewEmbedding = Pick<Embedding, "entityType" | "entityId" | "scopeId" | "contentHash" | "model" | "embedding">;

export interface DocLink {
  fromDocumentId: string;
  toScopeId: string;
  toSlug: string;
  toDocumentId: string | null;
  createdAt: Date;
}
export type NewDocLink = Pick<DocLink, "fromDocumentId" | "toScopeId" | "toSlug"> & Partial<Pick<DocLink, "toDocumentId">>;

export interface DocFollow {
  documentId: string;
  principalId: string;
  createdAt: Date;
}
export type NewDocFollow = Pick<DocFollow, "documentId" | "principalId">;
