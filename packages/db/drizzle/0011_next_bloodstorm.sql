CREATE TABLE "workbenches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_id" uuid NOT NULL,
	"repo" text NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workbenches_scope_id_unique" UNIQUE("scope_id")
);
--> statement-breakpoint
ALTER TABLE "workbenches" ADD CONSTRAINT "workbenches_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workbenches_scope_unique" ON "workbenches" USING btree ("scope_id");