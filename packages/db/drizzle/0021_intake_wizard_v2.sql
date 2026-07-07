ALTER TABLE "intake_packets" ADD COLUMN "pack_snapshot" text;
--> statement-breakpoint
ALTER TABLE "intake_packets" ADD COLUMN "related_history_selections" jsonb DEFAULT '[]'::jsonb NOT NULL;
