CREATE TABLE "metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"date" date NOT NULL,
	"value" numeric(18, 4) NOT NULL,
	"dims" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dims_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_scope_metric_date_dims_hash_unique" ON "metrics" USING btree ("scope_id","metric","date","dims_hash");--> statement-breakpoint
CREATE INDEX "metrics_scope_metric_date_idx" ON "metrics" USING btree ("scope_id","metric","date");