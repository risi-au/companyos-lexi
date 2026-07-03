CREATE TABLE "skills_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"scope_pattern" text NOT NULL,
	"domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"path" text NOT NULL,
	"description" text,
	"body" text NOT NULL,
	"sha" text,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "skills_index_name_unique" ON "skills_index" USING btree ("name");
