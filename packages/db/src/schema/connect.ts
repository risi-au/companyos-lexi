import {
  pgTable,
  uuid,
  timestamp,
  index,
  uniqueIndex,
  text,
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

// oauthConnections records the first and most recent authenticated OAuth MCP call.
export const oauthConnections = pgTable(
  "oauth_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    oauthClientId: text("oauth_client_id").notNull(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id, { onDelete: "cascade" }),
    firstUsedAt: timestamp("first_used_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clientPrincipalUnique: uniqueIndex("oauth_connections_client_principal_unique").on(t.oauthClientId, t.principalId),
    principalFirstUsedIdx: index("oauth_connections_principal_first_used_idx").on(t.principalId, t.firstUsedAt),
  })
);

export interface OAuthConnection {
  id: string;
  oauthClientId: string;
  principalId: string;
  firstUsedAt: Date;
  lastUsedAt: Date;
}

export type NewOAuthConnection = Pick<OAuthConnection, "oauthClientId" | "principalId">;
