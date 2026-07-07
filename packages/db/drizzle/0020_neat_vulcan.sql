CREATE TYPE "public"."intake_packet_status" AS ENUM('draft', 'awaiting_external', 'needs_review', 'approved', 'provisioned', 'rejected', 'dismissed');
--> statement-breakpoint
CREATE TABLE "intake_packets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_id" uuid NOT NULL,
	"status" "intake_packet_status" DEFAULT 'draft' NOT NULL,
	"template_slug" text DEFAULT 'new-project' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"packet_md" text,
	"research_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_provision_spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proposed_docs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_tasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_wiki_updates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"open_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reuse_pattern_slug" text,
	"source_engine" text,
	"source_model" text,
	"submitted_by" uuid,
	"approved_by" uuid,
	"report_record_id" uuid,
	"artifact_links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"provisioned_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "intake_packets" ADD CONSTRAINT "intake_packets_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "intake_packets" ADD CONSTRAINT "intake_packets_submitted_by_principals_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "intake_packets" ADD CONSTRAINT "intake_packets_approved_by_principals_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "intake_packets_scope_status_idx" ON "intake_packets" USING btree ("scope_id","status","updated_at");
--> statement-breakpoint
CREATE INDEX "intake_packets_status_updated_idx" ON "intake_packets" USING btree ("status","updated_at");
