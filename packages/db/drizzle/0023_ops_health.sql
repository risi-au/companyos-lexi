CREATE TABLE "external_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope_id" uuid,
  "name" text NOT NULL,
  "component" text NOT NULL,
  "owner_note" text DEFAULT '' NOT NULL,
  "where_it_lives" text DEFAULT '' NOT NULL,
  "expires_at" timestamp with time zone,
  "status" text DEFAULT 'active' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_alert_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "check_key" text NOT NULL,
  "status" text NOT NULL,
  "message" text DEFAULT '' NOT NULL,
  "last_alerted_at" timestamp with time zone,
  "last_digest_at" timestamp with time zone,
  "email_sent" boolean DEFAULT false NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_credentials" ADD CONSTRAINT "external_credentials_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "external_credentials" ADD CONSTRAINT "external_credentials_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "external_credentials_name_unique" ON "external_credentials" USING btree ("name");
--> statement-breakpoint
CREATE INDEX "external_credentials_expiry_idx" ON "external_credentials" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "external_credentials_component_idx" ON "external_credentials" USING btree ("component");
--> statement-breakpoint
CREATE UNIQUE INDEX "ops_alert_state_check_key_unique" ON "ops_alert_state" USING btree ("check_key");
--> statement-breakpoint
CREATE INDEX "ops_alert_state_status_updated_idx" ON "ops_alert_state" USING btree ("status","updated_at");
--> statement-breakpoint
INSERT INTO "external_credentials" ("name", "component", "owner_note", "where_it_lives", "expires_at", "metadata")
VALUES (
  'GITHUB_TOKEN',
  'github-skills-pat',
  'Fine-grained PAT for companyos-skills; rotate before expiry.',
  'Instance environment variable GITHUB_TOKEN',
  '2026-10-05 00:00:00+00',
  '{"seededBy":"M9-01","repo":"companyos-skills"}'::jsonb
)
ON CONFLICT ("name") DO UPDATE SET
  "component" = excluded."component",
  "owner_note" = excluded."owner_note",
  "where_it_lives" = excluded."where_it_lives",
  "expires_at" = excluded."expires_at",
  "metadata" = excluded."metadata",
  "updated_at" = now();
