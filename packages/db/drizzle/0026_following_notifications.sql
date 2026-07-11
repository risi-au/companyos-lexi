ALTER TYPE "public"."attention_kind" ADD VALUE 'page_update';--> statement-breakpoint
CREATE TABLE "doc_follows" (
	"document_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doc_follows" ADD CONSTRAINT "doc_follows_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_follows" ADD CONSTRAINT "doc_follows_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_items" ADD COLUMN "target_principal_id" uuid;--> statement-breakpoint
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_target_principal_id_principals_id_fk" FOREIGN KEY ("target_principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_follows_document_principal_unique" ON "doc_follows" USING btree ("document_id","principal_id");--> statement-breakpoint
CREATE INDEX "doc_follows_principal_idx" ON "doc_follows" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "attention_items_target_status_idx" ON "attention_items" USING btree ("target_principal_id","status");