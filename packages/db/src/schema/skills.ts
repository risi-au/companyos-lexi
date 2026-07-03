import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const skillsIndex = pgTable(
  "skills_index",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    scopePattern: text("scope_pattern").notNull(),
    domains: jsonb("domains").notNull().default([]),
    path: text("path").notNull(),
    description: text("description"),
    body: text("body").notNull(),
    sha: text("sha"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueName: uniqueIndex("skills_index_name_unique").on(t.name),
  })
);

export interface SkillIndexRow {
  id: string;
  name: string;
  scopePattern: string;
  domains: string[];
  path: string;
  description: string | null;
  body: string;
  sha: string | null;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type NewSkillIndexRow = Pick<SkillIndexRow, "name" | "scopePattern" | "domains" | "path" | "body" | "syncedAt"> &
  Partial<Pick<SkillIndexRow, "description" | "sha">>;
