import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { principals, scopes } from "./kernel";

export const externalCredentials = pgTable(
  "external_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id").references(() => scopes.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    component: text("component").notNull(),
    ownerNote: text("owner_note").notNull().default(""),
    whereItLives: text("where_it_lives").notNull().default(""),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").notNull().default({}),
    createdBy: uuid("created_by").references(() => principals.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueName: uniqueIndex("external_credentials_name_unique").on(t.name),
    expiryIdx: index("external_credentials_expiry_idx").on(t.expiresAt),
    componentIdx: index("external_credentials_component_idx").on(t.component),
  })
);

export const opsAlertState = pgTable(
  "ops_alert_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkKey: text("check_key").notNull(),
    status: text("status").notNull(),
    message: text("message").notNull().default(""),
    lastAlertedAt: timestamp("last_alerted_at", { withTimezone: true }),
    lastDigestAt: timestamp("last_digest_at", { withTimezone: true }),
    emailSent: boolean("email_sent").notNull().default(false),
    metadata: jsonb("metadata").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueCheckKey: uniqueIndex("ops_alert_state_check_key_unique").on(t.checkKey),
    statusUpdatedIdx: index("ops_alert_state_status_updated_idx").on(t.status, t.updatedAt),
  })
);

export interface ExternalCredential {
  id: string;
  scopeId: string | null;
  name: string;
  component: string;
  ownerNote: string;
  whereItLives: string;
  expiresAt: Date | null;
  status: string;
  metadata: Record<string, unknown>;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewExternalCredential = Pick<ExternalCredential, "name" | "component"> &
  Partial<Pick<ExternalCredential, "scopeId" | "ownerNote" | "whereItLives" | "expiresAt" | "status" | "metadata" | "createdBy">>;

export interface OpsAlertState {
  id: string;
  checkKey: string;
  status: string;
  message: string;
  lastAlertedAt: Date | null;
  lastDigestAt: Date | null;
  emailSent: boolean;
  metadata: Record<string, unknown>;
  updatedAt: Date;
}
