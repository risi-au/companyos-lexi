import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  pgEnum,
  bigserial,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";


// Enums
export const scopeTypeEnum = pgEnum("scope_type", ["root", "project", "subproject", "personal"]);
export const scopeStatusEnum = pgEnum("scope_status", ["active", "archived"]);
export const principalKindEnum = pgEnum("principal_kind", ["human", "agent"]);
export const principalStatusEnum = pgEnum("principal_status", ["active", "disabled"]);
export const grantRoleEnum = pgEnum("grant_role", ["owner", "admin", "editor", "viewer", "agent"]);

// scopes
export const scopes = pgTable("scopes", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentId: uuid("parent_id").references((): AnyPgColumn => scopes.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  path: text("path").notNull().unique(),
  name: text("name").notNull(),
  type: scopeTypeEnum("type").notNull(),
  status: scopeStatusEnum("status").notNull().default("active"),
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// principals
export const principals = pgTable("principals", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: principalKindEnum("kind").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  authUserId: text("auth_user_id").unique(),
  status: principalStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// grants
export const grants = pgTable(
  "grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id, { onDelete: "cascade" }),
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    role: grantRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniquePrincipalScope: uniqueIndex("grants_principal_scope_unique").on(
      t.principalId,
      t.scopeId
    ),
  })
);

// tokens
export const tokens = pgTable("tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  principalId: uuid("principal_id")
    .notNull()
    .references(() => principals.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// module_instances
export const moduleInstances = pgTable(
  "module_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    moduleType: text("module_type").notNull(),
    config: jsonb("config").notNull().default({}),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueScopeModule: uniqueIndex("module_instances_scope_module_unique").on(
      t.scopeId,
      t.moduleType
    ),
  })
);

// events
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    type: text("type").notNull(),
    scopeId: uuid("scope_id").references(() => scopes.id, { onDelete: "set null" }),
    principalId: uuid("principal_id").references(() => principals.id, { onDelete: "set null" }),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeCreatedIdx: index("events_scope_created_idx").on(t.scopeId, t.createdAt),
    typeCreatedIdx: index("events_type_created_idx").on(t.type, t.createdAt),
  })
);

// Typed models (inferred shape preserved manually for TS strict + circular)
export interface Scope {
  id: string;
  parentId: string | null;
  slug: string;
  path: string;
  name: string;
  type: "root" | "project" | "subproject" | "personal";
  status: "active" | "archived";
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
export type NewScope = Partial<Omit<Scope, "id" | "createdAt" | "updatedAt">> & Pick<Scope, "slug" | "path" | "name" | "type">;

export interface Principal {
  id: string;
  kind: "human" | "agent";
  name: string;
  email: string | null;
  authUserId: string | null;
  status: "active" | "disabled";
  createdAt: Date;
}
export type NewPrincipal = Partial<Omit<Principal, "id" | "createdAt">> & Pick<Principal, "kind" | "name">;

export interface Grant {
  id: string;
  principalId: string;
  scopeId: string;
  role: "owner" | "admin" | "editor" | "viewer" | "agent";
  createdAt: Date;
}
export type NewGrant = Pick<Grant, "principalId" | "scopeId" | "role">;

export interface Token {
  id: string;
  principalId: string;
  name: string;
  tokenHash: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}
export type NewToken = Pick<Token, "principalId" | "name" | "tokenHash"> & Partial<Pick<Token, "expiresAt" | "revokedAt">>;

export interface ModuleInstance {
  id: string;
  scopeId: string;
  moduleType: string;
  config: Record<string, unknown>;
  position: number;
  createdAt: Date;
}
export type NewModuleInstance = Pick<ModuleInstance, "scopeId" | "moduleType"> & Partial<Pick<ModuleInstance, "config" | "position">>;

export interface Event {
  id: string | number | bigint;
  type: string;
  scopeId: string | null;
  principalId: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}
export type NewEvent = Pick<Event, "type" | "payload"> & Partial<Pick<Event, "scopeId" | "principalId">>;
