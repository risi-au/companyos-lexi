CREATE TABLE "capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_id" uuid NOT NULL,
	"name" text NOT NULL,
	"engine" text NOT NULL,
	"engine_ref" text,
	"token_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capability_id" uuid NOT NULL,
	"run_ref" text,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"summary" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_runs" ADD CONSTRAINT "capability_runs_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capabilities_scope_name_unique" ON "capabilities" USING btree ("scope_id","name");--> statement-breakpoint
CREATE INDEX "capability_runs_capability_started_idx" ON "capability_runs" USING btree ("capability_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "capability_runs_capability_run_ref_unique" ON "capability_runs" USING btree ("capability_id","run_ref") WHERE "capability_runs"."run_ref" is not null;