CREATE TABLE "task_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_id" uuid NOT NULL,
	"plane_project_id" text NOT NULL,
	"plane_label_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_scope_id_unique" UNIQUE ("scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_links_scope_unique" ON "task_links" USING btree ("scope_id");
