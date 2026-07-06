CREATE INDEX "records_fts_idx" ON "records" USING gin (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("body_md", '')));
--> statement-breakpoint
CREATE INDEX "documents_fts_idx" ON "documents" USING gin (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("body_md", '')));
