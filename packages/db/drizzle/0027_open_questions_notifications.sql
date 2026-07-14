ALTER TYPE "public"."attention_kind" ADD VALUE 'open_question';--> statement-breakpoint
CREATE UNIQUE INDEX "attention_items_intake_ordinal_idx" ON "attention_items" USING btree ("scope_id",("payload"->>'intakeId'),("payload"->>'ordinal')) WHERE ("attention_items"."payload"->>'source') = 'intake' AND ("attention_items"."payload"->>'ordinal') IS NOT NULL;
