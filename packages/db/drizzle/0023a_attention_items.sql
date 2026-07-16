CREATE TYPE "public"."attention_kind" AS ENUM('wiki_proposal', 'lint_finding', 'graduation', 'external_gate');--> statement-breakpoint
CREATE TYPE "public"."attention_status" AS ENUM('open', 'approved', 'rejected', 'dismissed');--> statement-breakpoint
CREATE TABLE "attention_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_id" uuid NOT NULL,
	"kind" "attention_kind" NOT NULL,
	"status" "attention_status" DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"payload" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_resolved_by_principals_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attention_items_scope_status_created_idx" ON "attention_items" USING btree ("scope_id","status","created_at");--> statement-breakpoint
CREATE INDEX "attention_items_kind_status_idx" ON "attention_items" USING btree ("kind","status");
