-- Flip Facebook from manual-post-only to real OAuth posting now that the
-- Graph API adapter (Page posting) is live. seedDefaultChannels()'s
-- ignoreDuplicates upsert won't update existing rows, so this backfills
-- explicitly — same pattern as 20260806000000_tiktok_instagram_oauth.sql.
-- New workspaces get 'oauth' directly from DEFAULT_CHANNELS.
--
-- Do NOT apply until pages_manage_posts has Advanced Access via Meta App
-- Review (or you're testing with an app admin/tester Page) — until then,
-- flipping this live shows a "Connect via OAuth" button that fails for
-- anyone who isn't already a role on the Meta app.

update vantage.channels set auth_method = 'oauth', updated_at = now()
where slug = 'facebook' and auth_method = 'manual';
