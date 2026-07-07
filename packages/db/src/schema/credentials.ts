import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { principals, scopes } from "./kernel";

// credentials: encrypted per-scope secret values for agent work. Plaintext never persists.
export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    valueCiphertext: text("value_ciphertext").notNull(),
    valueIv: text("value_iv").notNull(),
    valueTag: text("value_tag").notNull(),
    createdBy: uuid("created_by").references(() => principals.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
  },
  (t) => ({
    uniqueScopeName: uniqueIndex("credentials_scope_name_unique").on(t.scopeId, t.name),
    scopeUpdatedIdx: index("credentials_scope_updated_idx").on(t.scopeId, t.updatedAt),
    scopeLastAccessedIdx: index("credentials_scope_last_accessed_idx").on(t.scopeId, t.lastAccessedAt),
  })
);

export interface Credential {
  id: string;
  scopeId: string;
  name: string;
  description: string;
  valueCiphertext: string;
  valueIv: string;
  valueTag: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date | null;
}

export type NewCredential = Pick<
  Credential,
  "scopeId" | "name" | "description" | "valueCiphertext" | "valueIv" | "valueTag"
> & Partial<Pick<Credential, "createdBy" | "lastAccessedAt">>;
