import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { scopes } from "./kernel";

export const taskLinks = pgTable(
  "task_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id")
      .notNull()
      .unique()
      .references(() => scopes.id, { onDelete: "cascade" }),
    planeProjectId: text("plane_project_id").notNull(),
    planeLabelId: text("plane_label_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueScope: uniqueIndex("task_links_scope_unique").on(t.scopeId),
  })
);

// Typed models
export interface TaskLink {
  id: string;
  scopeId: string;
  planeProjectId: string;
  planeLabelId: string | null;
  createdAt: Date;
}
export type NewTaskLink = Pick<TaskLink, "scopeId" | "planeProjectId"> &
  Partial<Pick<TaskLink, "planeLabelId">>;
