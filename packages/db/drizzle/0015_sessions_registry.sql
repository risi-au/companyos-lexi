CREATE TYPE "public"."session_status" AS ENUM('running', 'waiting', 'idle', 'completed', 'error');
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope_id" uuid NOT NULL,
  "title" text NOT NULL,
  "engine" text NOT NULL,
  "model" text,
  "status" "public"."session_status" DEFAULT 'running' NOT NULL,
  "token_id" uuid,
  "principal_id" uuid,
  "worktree_ref" text,
  "last_heartbeat" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "agent_sessions_scope_status_updated_idx" ON "agent_sessions" USING btree ("scope_id","status","updated_at");
