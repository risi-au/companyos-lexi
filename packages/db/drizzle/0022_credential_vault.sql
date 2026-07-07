CREATE TABLE "credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "value_ciphertext" text NOT NULL,
  "value_iv" text NOT NULL,
  "value_tag" text NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_accessed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_scope_name_unique" ON "credentials" USING btree ("scope_id","name");
--> statement-breakpoint
CREATE INDEX "credentials_scope_updated_idx" ON "credentials" USING btree ("scope_id","updated_at");
--> statement-breakpoint
CREATE INDEX "credentials_scope_last_accessed_idx" ON "credentials" USING btree ("scope_id","last_accessed_at");
