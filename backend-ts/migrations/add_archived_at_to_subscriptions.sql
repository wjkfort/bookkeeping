-- Add archived_at to subscriptions: NULL = active, non-NULL = archived (paused)
-- Apply: wrangler d1 execute bookkeeping-db --remote --file=migrations/add_archived_at_to_subscriptions.sql
ALTER TABLE subscriptions ADD COLUMN archived_at TEXT;
