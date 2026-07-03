-- M4-03: workspace-per-project — task_links records which Plane workspace a link lives in.
-- NULL = env-default workspace (legacy v1 mapping). No backfill needed.
-- (drizzle-kit generated extra statements from a stale snapshot; trimmed to the real delta.
--  0010_snapshot.json is intentionally kept — it re-syncs the snapshot with reality.)
ALTER TABLE "task_links" ADD COLUMN "plane_workspace_slug" text;
