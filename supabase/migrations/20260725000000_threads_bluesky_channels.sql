-- ─────────────────────────────────────────────────────────────────────────────
-- Add Threads (OAuth) and Bluesky (app-password / AT Protocol) distribution
-- channels. Channels are keyed (workspace_id, slug) since 20260702_core_tenancy,
-- so seed one row of each per existing workspace. New workspaces get these via
-- seedDefaultChannels() in apps/api/src/lib/workspace.ts.
--
-- Idempotent: on conflict do nothing, so re-running is harmless.
-- ─────────────────────────────────────────────────────────────────────────────

insert into vantage.channels (workspace_id, slug, display_name, auth_method, enabled, cadence_config)
select w.id, 'threads', 'Threads', 'oauth', false, '{"posts_per_day":2,"posting_hours":[9,17]}'::jsonb
from vantage.workspaces w
on conflict (workspace_id, slug) do nothing;

insert into vantage.channels (workspace_id, slug, display_name, auth_method, enabled, cadence_config)
select w.id, 'bluesky', 'Bluesky', 'api_key', false, '{"posts_per_day":3,"posting_hours":[9,13,18]}'::jsonb
from vantage.workspaces w
on conflict (workspace_id, slug) do nothing;
