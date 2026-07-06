CREATE TABLE "usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope_id" uuid,
  "principal_id" uuid,
  "token_id" uuid,
  "session_id" uuid,
  "connection_id" uuid,
  "source" text NOT NULL,
  "engine" text,
  "model" text,
  "operation" text NOT NULL,
  "input_tokens_est" integer,
  "output_tokens_est" integer,
  "total_tokens_est" integer,
  "actual_input_tokens" integer,
  "actual_output_tokens" integer,
  "actual_cost_usd" numeric(18, 8),
  "byte_in" integer DEFAULT 0 NOT NULL,
  "byte_out" integer DEFAULT 0 NOT NULL,
  "latency_ms" integer DEFAULT 0 NOT NULL,
  "success" boolean NOT NULL,
  "error_code" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope_id" uuid,
  "name" text NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "context_profiles" ADD CONSTRAINT "context_profiles_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "context_profiles" ADD CONSTRAINT "context_profiles_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "usage_events_scope_created_idx" ON "usage_events" USING btree ("scope_id","created_at");
--> statement-breakpoint
CREATE INDEX "usage_events_principal_created_idx" ON "usage_events" USING btree ("principal_id","created_at");
--> statement-breakpoint
CREATE INDEX "usage_events_token_created_idx" ON "usage_events" USING btree ("token_id","created_at");
--> statement-breakpoint
CREATE INDEX "usage_events_session_created_idx" ON "usage_events" USING btree ("session_id","created_at");
--> statement-breakpoint
CREATE INDEX "usage_events_connection_created_idx" ON "usage_events" USING btree ("connection_id","created_at");
--> statement-breakpoint
CREATE INDEX "usage_events_operation_created_idx" ON "usage_events" USING btree ("operation","created_at");
--> statement-breakpoint
CREATE INDEX "context_profiles_scope_default_idx" ON "context_profiles" USING btree ("scope_id","is_default");
--> statement-breakpoint
CREATE INDEX "context_profiles_scope_name_idx" ON "context_profiles" USING btree ("scope_id","name");
