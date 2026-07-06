import {
  pgTable,
  uuid,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { principals, scopes, tokens } from "./kernel";

// connections: module-owned record tying scoped MCP tokens to the actor who minted them.
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => tokens.id, { onDelete: "cascade" }),
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    mintedBy: uuid("minted_by")
      .notNull()
      .references(() => principals.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueToken: uniqueIndex("connections_token_id_unique").on(t.tokenId),
    scopeCreatedIdx: index("connections_scope_created_idx").on(t.scopeId, t.createdAt),
    mintedByIdx: index("connections_minted_by_idx").on(t.mintedBy),
  })
);

export interface Connection {
  id: string;
  tokenId: string;
  scopeId: string;
  mintedBy: string;
  createdAt: Date;
}

export type NewConnection = Pick<Connection, "tokenId" | "scopeId" | "mintedBy">;
