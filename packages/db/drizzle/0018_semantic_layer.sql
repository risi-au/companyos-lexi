CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
DO $$
DECLARE
  embedding_dimensions integer := COALESCE(NULLIF(current_setting('companyos.embedding_dimensions', true), '')::integer, 1536);
BEGIN
  EXECUTE format($sql$
    CREATE TABLE "embeddings" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "entity_type" text NOT NULL,
      "entity_id" uuid NOT NULL,
      "scope_id" uuid NOT NULL,
      "content_hash" text NOT NULL,
      "model" text NOT NULL,
      "embedding" vector(%s) NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "embeddings_entity_type_check" CHECK ("entity_type" IN ('doc', 'record'))
    )
  $sql$, embedding_dimensions);
END $$;
--> statement-breakpoint
CREATE TABLE "doc_links" (
  "from_document_id" uuid NOT NULL,
  "to_scope_id" uuid NOT NULL,
  "to_slug" text NOT NULL,
  "to_document_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "doc_links" ADD CONSTRAINT "doc_links_from_document_id_documents_id_fk" FOREIGN KEY ("from_document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "doc_links" ADD CONSTRAINT "doc_links_to_scope_id_scopes_id_fk" FOREIGN KEY ("to_scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "doc_links" ADD CONSTRAINT "doc_links_to_document_id_documents_id_fk" FOREIGN KEY ("to_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "embeddings_entity_unique" ON "embeddings" USING btree ("entity_type","entity_id");
--> statement-breakpoint
CREATE INDEX "embeddings_scope_entity_idx" ON "embeddings" USING btree ("scope_id","entity_type");
--> statement-breakpoint
CREATE INDEX "embeddings_updated_idx" ON "embeddings" USING btree ("updated_at");
--> statement-breakpoint
CREATE INDEX "embeddings_vector_idx" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "doc_links_from_idx" ON "doc_links" USING btree ("from_document_id");
--> statement-breakpoint
CREATE INDEX "doc_links_to_scope_slug_idx" ON "doc_links" USING btree ("to_scope_id","to_slug");
--> statement-breakpoint
CREATE INDEX "doc_links_to_document_idx" ON "doc_links" USING btree ("to_document_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "doc_links_unique" ON "doc_links" USING btree ("from_document_id","to_scope_id","to_slug");
