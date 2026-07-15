CREATE TABLE "oauth_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oauth_client_id" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"first_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_connections_client_principal_unique" ON "oauth_connections" USING btree ("oauth_client_id","principal_id");--> statement-breakpoint
CREATE INDEX "oauth_connections_principal_first_used_idx" ON "oauth_connections" USING btree ("principal_id","first_used_at");
