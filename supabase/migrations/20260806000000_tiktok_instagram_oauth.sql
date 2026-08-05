-- Flip TikTok/Instagram from manual-post-only to real OAuth posting now that
-- the Content Posting API (TikTok) / Graph API (Instagram) adapters are live.
-- seedDefaultChannels()'s upsert uses ignoreDuplicates: true, which will NOT
-- update auth_method on already-existing workspace rows — this backfills them
-- explicitly. New workspaces get 'oauth' directly from DEFAULT_CHANNELS in
-- apps/api/src/lib/workspace.ts. Idempotent — only touches rows still on 'manual'.
--
-- CAUTION before applying: this flips the "Connect via OAuth" button live for
-- every workspace immediately. Don't run this against production data until
-- TikTok's sandbox testing (app review in progress) and Instagram's Meta app
-- (not yet created) are each independently confirmed working — otherwise real
-- users get a Connect button for a platform that can't actually complete the
-- flow yet. Safe to split into two separate `update` runs timed to each
-- platform's actual readiness instead of applying both at once.

update vantage.channels
set auth_method = 'oauth', updated_at = now()
where slug = 'tiktok' and auth_method = 'manual';

update vantage.channels
set auth_method = 'oauth', updated_at = now()
where slug = 'instagram' and auth_method = 'manual';
