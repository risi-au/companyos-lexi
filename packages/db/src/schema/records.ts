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
export const recordKindEnum = pgEnum("record_kind", ["changelog", "decision", "report", "note"]);

// records
export const records = pgTable(
  "records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    kind: recordKindEnum("kind").notNull(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    data: jsonb("data").notNull().default({}),
    authorId: uuid("author_id")
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeKindCreatedIdx: index("records_scope_kind_created_idx").on(
      t.scopeId,
      t.kind,
      t.createdAt
    ),
    scopeCreatedIdx: index("records_scope_created_idx").on(
      t.scopeId,
      t.createdAt
    ),
  })
);

// Typed models (inferred shape preserved manually for TS strict)
export interface Record {
  id: string;
  scopeId: string;
  kind: "changelog" | "decision" | "report" | "note";
  title: string;
  bodyMd: string;
  data: { [key: string]: unknown };
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
}
export type NewRecord = Partial<Omit<Record, "id" | "createdAt" | "updatedAt">> &
  Pick<Record, "scopeId" | "kind" | "title" | "authorId"> & { bodyMd?: string; data?: { [key: string]: unknown } };
