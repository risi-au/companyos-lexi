import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

import { scopes, principals } from "./kernel";

// canvases: Excalidraw scenes as jsonb per-scope. slug unique per scope. soft archive. No revisions in v1.
export const canvases = pgTable(
  "canvases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    scene: jsonb("scene").notNull().default({}),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    uniqueScopeSlug: uniqueIndex("canvases_scope_slug_unique").on(t.scopeId, t.slug),
    scopeUpdatedIdx: index("canvases_scope_updated_idx").on(t.scopeId, t.updatedAt),
  })
);

// Typed models (inferred shape preserved manually for TS strict)
export interface Canvas {
  id: string;
  scopeId: string;
  slug: string;
  name: string;
  scene: Record<string, unknown>;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}
export type NewCanvas = Partial<Omit<Canvas, "id" | "createdAt" | "updatedAt">> &
  Pick<Canvas, "scopeId" | "slug" | "name" | "updatedBy"> & { scene?: Record<string, unknown> };
