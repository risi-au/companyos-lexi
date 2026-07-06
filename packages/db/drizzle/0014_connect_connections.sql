CREATE TABLE "connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_id" uuid NOT NULL,
  "scope_id" uuid NOT NULL,
  "minted_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_minted_by_principals_id_fk" FOREIGN KEY ("minted_by") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "connections_token_id_unique" ON "connections" USING btree ("token_id");
--> statement-breakpoint
CREATE INDEX "connections_scope_created_idx" ON "connections" USING btree ("scope_id","created_at");
--> statement-breakpoint
CREATE INDEX "connections_minted_by_idx" ON "connections" USING btree ("minted_by");
