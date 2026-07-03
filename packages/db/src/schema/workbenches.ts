import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { scopes } from "./kernel";

export const workbenches = pgTable(
  "workbenches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id")
      .notNull()
      .unique()
      .references(() => scopes.id, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    path: text("path").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueScope: uniqueIndex("workbenches_scope_unique").on(t.scopeId),
  })
);

export interface Workbench {
  id: string;
  scopeId: string;
  repo: string;
  path: string;
  createdAt: Date;
  updatedAt: Date;
}
export type NewWorkbench = Pick<Workbench, "scopeId" | "repo"> &
  Partial<Pick<Workbench, "path">>;
