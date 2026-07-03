-- M4-01: scope_type enum migration to root|project|subproject
-- Maps: client -> project, area -> subproject
-- Works for fresh DB (no-op updates) and DBs with legacy rows.
-- Temp cast to text to allow value remap before new enum exists.
--> statement-breakpoint
ALTER TABLE "scopes" ALTER COLUMN "type" TYPE text;
--> statement-breakpoint
UPDATE "scopes" SET "type" = 'project' WHERE "type" = 'client';
--> statement-breakpoint
UPDATE "scopes" SET "type" = 'subproject' WHERE "type" = 'area';
--> statement-breakpoint
-- Now swap: drop old enum (after column is text), create new, cast column
DROP TYPE IF EXISTS "public"."scope_type";
--> statement-breakpoint
CREATE TYPE "public"."scope_type" AS ENUM('root', 'project', 'subproject');
--> statement-breakpoint
ALTER TABLE "scopes" ALTER COLUMN "type" TYPE "public"."scope_type" USING "type"::"public"."scope_type";
--> statement-breakpoint
-- cleanup any old if renamed in alt paths, no-op here