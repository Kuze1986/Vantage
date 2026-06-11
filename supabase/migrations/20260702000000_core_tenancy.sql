-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1 (SaaS readiness): make the CORE pipeline multi-tenant.
--
-- Until now only the newest feature areas (campaigns, intelligence, audience,
-- virality) carried `workspace_id`. The core pipeline — brand_voice, channels,
-- topics, content_pieces, engagement_events, generation_weights, settings,
-- newsletter_subscribers, email_templates, demoforge_jobs, activity_events —
-- was single-tenant. This migration adds `workspace_id` to every one of those,
-- backfills existing rows to a single default workspace, enforces NOT NULL,
-- re-keys `channels` and `settings` per workspace, rebuilds the public proxy
-- views so the new column is visible to PostgREST, and tightens RLS as a
-- defense-in-depth backstop (the API enforces scoping in application code).
--
-- music_tracks and sound_effects are intentionally left GLOBAL — they are a
-- shared media library, not tenant-owned data.
--
-- Runs in a single transaction (Supabase wraps each migration) → all-or-nothing.
-- Manual confirmation before apply in production.
-- ─────────────────────────────────────────────────────────────────────────────

-- 0. Resolve (or bootstrap) the default workspace that existing rows belong to.
--    Stored in a transaction-local GUC so every backfill below can read it.
do $$
declare ws uuid;
begin
  select id into ws from vantage.workspaces order by created_at asc limit 1;
  if ws is null then
    insert into vantage.workspaces (name, slug, owner_id)
    values ('Default (migrated)', 'default-migrated',
            '00000000-0000-0000-0000-000000000000')
    returning id into ws;
    raise notice 'No workspace existed — created bootstrap %. Reassign owner_id to the real operator.', ws;
  end if;
  perform set_config('vantage.default_workspace', ws::text, false);
end $$;

-- Helper expression used throughout: current_setting('vantage.default_workspace')::uuid

-- 1. brand_voice — one voice per workspace ────────────────────────────────────
alter table vantage.brand_voice
  add column if not exists workspace_id uuid references vantage.workspaces(id) on delete cascade;
update vantage.brand_voice
  set workspace_id = current_setting('vantage.default_workspace')::uuid
  where workspace_id is null;
alter table vantage.brand_voice alter column workspace_id set not null;
create unique index if not exists brand_voice_workspace_uidx
  on vantage.brand_voice (workspace_id);

-- 2. channels — re-key from (slug) to (workspace_id, slug) ─────────────────────
-- Dependent FKs in content_pieces / generation_weights must be dropped first,
-- then re-created as composite FKs after both sides have workspace_id.
do $$
declare r record;
begin
  for r in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where confrelid = 'vantage.channels'::regclass and contype = 'f'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table vantage.channels
  add column if not exists workspace_id uuid references vantage.workspaces(id) on delete cascade;
update vantage.channels
  set workspace_id = current_setting('vantage.default_workspace')::uuid
  where workspace_id is null;
alter table vantage.channels alter column workspace_id set not null;

alter table vantage.channels drop constraint if exists channels_pkey;
alter table vantage.channels add primary key (workspace_id, slug);

-- 3. topics ───────────────────────────────────────────────────────────────────
alter table vantage.topics
  add column if not exists workspace_id uuid references vantage.workspaces(id) on delete cascade;
update vantage.topics
  set workspace_id = current_setting('vantage.default_workspace')::uuid
  where workspace_id is null;
alter table vantage.topics alter column workspace_id set not null;
-- Replace the "unused topics" index with a workspace-scoped one.
drop index if exists vantage.topics_priority_unused_idx;
create index if not exists topics_ws_priority_unused_idx
  on vantage.topics (workspace_id, priority desc, created_at desc) where used_at is null;

-- 4. content_pieces ───────────────────────────────────────────────────────────
alter table vantage.content_pieces
  add column if not exists workspace_id uuid references vantage.workspaces(id) on delete cascade;
update vantage.content_pieces
  set workspace_id = current_setting('vantage.default_workspace')::uuid
  where workspace_id is null;
alter table vantage.content_pieces alter column workspace_id set not null;
-- Composite FK guarantees a piece's channel belongs to the same workspace.
alter table vantage.content_pieces
  add constraint content_pieces_channel_fk
  foreign key (workspace_id, channel_slug)
  references vantage.channels (workspace_id, slug);
-- Workspace-scoped hot-path indexes.
drop index if exists vantage.content_pieces_queue_idx;
create index if not exists content_pieces_ws_queue_idx
  on vantage.content_pieces (workspace_id, status, scheduled_for) where status = 'queued';
create index if not exists content_pieces_ws_channel_published_idx
  on vantage.content_pieces (workspace_id, channel_slug, published_at desc);

-- 5. engagement_events — derive workspace from the parent piece ────────────────
alter table vantage.engagement_events
  add column if not exists workspace_id uuid references vantage.workspaces(id) on delete cascade;
update vantage.engagement_events e
  set workspace_id = cp.workspace_id
  from vantage.content_pieces cp
  where e.content_piece_id = cp.id and e.workspace_id is null;
update vantage.engagement_events
  set workspace_id = current_setting('vantage.default_workspace')::uuid
  where workspace_id is null; -- orphans with null content_piece_id
alter table vantage.engagement_events alter column workspace_id set not null;
create index if not exists engagement_events_ws_time_idx
  on vantage.engagement_events (workspace_id, occurred_at desc);

-- 6. generation_weights — per-workspace pattern weights ───────────────────────
alter table vantage.generation_weights
  add column if not exists workspace_id uuid references vantage.workspaces(id) on delete cascade;
update vantage.generation_weights
  set workspace_id = current_setting('vantage.default_workspace')::uuid
  where workspace_id is null;
alter table vantage.generation_weights alter column workspace_id set not null;
drop index if exists vantage.generation_weights_channel_pattern_uidx;
create unique index if not exists generation_weights_ws_channel_pattern_uidx
  on vantage.generation_weights (workspace_id, channel_slug, pattern_key);
alter table vantage.generation_weights
  add constraint generation_weights_channel_fk
  foreign key (workspace_id, channel_slug)
  references vantage.channels (workspace_id, slug);

-- 7. activity_events — nullable: system/global events have no workspace ────────
alter table vantage.activity_events
  add column if not exists workspace_id uuid references vantage.workspaces(id) on delete cascade;
update vantage.activity_events
  set workspace_id = current_setting('vantage.default_workspace')::uuid
  where workspace_id is null;
create index if not exists activity_events_ws_time_idx
  on vantage.activity_events (workspace_id, occurred_at desc);

-- 8. settings — re-key from (key) to (workspace_id, key) ───────────────────────
alter table vantage.settings
  add column if not exists workspace_id uuid references vantage.workspaces(id) on delete cascade;
update vantage.settings
  set workspace_id = current_setting('vantage.default_workspace')::uuid
  where workspace_id is null;
alter table vantage.settings alter column workspace_id set not null;
alter table vantage.settings drop constraint if exists settings_pkey;
alter table vantage.settings add primary key (workspace_id, key);

-- 9. newsletter_subscribers — unique email is per-workspace ────────────────────
alter table vantage.newsletter_subscribers
  add column if not exists workspace_id uuid references vantage.workspaces(id) on delete cascade;
update vantage.newsletter_subscribers
  set workspace_id = current_setting('vantage.default_workspace')::uuid
  where workspace_id is null;
alter table vantage.newsletter_subscribers alter column workspace_id set not null;
alter table vantage.newsletter_subscribers
  drop constraint if exists newsletter_subscribers_email_unique;
alter table vantage.newsletter_subscribers
  add constraint newsletter_subscribers_ws_email_unique unique (workspace_id, email);
drop index if exists vantage.newsletter_subscribers_active_idx;
create index if not exists newsletter_subscribers_ws_active_idx
  on vantage.newsletter_subscribers (workspace_id, email) where unsubscribed_at is null;

-- 10. email_templates ─────────────────────────────────────────────────────────
alter table vantage.email_templates
  add column if not exists workspace_id uuid references vantage.workspaces(id) on delete cascade;
update vantage.email_templates
  set workspace_id = current_setting('vantage.default_workspace')::uuid
  where workspace_id is null;
alter table vantage.email_templates alter column workspace_id set not null;

-- 11. demoforge_jobs ──────────────────────────────────────────────────────────
alter table vantage.demoforge_jobs
  add column if not exists workspace_id uuid references vantage.workspaces(id) on delete cascade;
update vantage.demoforge_jobs
  set workspace_id = current_setting('vantage.default_workspace')::uuid
  where workspace_id is null;
alter table vantage.demoforge_jobs alter column workspace_id set not null;
create index if not exists demoforge_jobs_ws_status_idx
  on vantage.demoforge_jobs (workspace_id, status);

-- 12. Rebuild ALL public proxy views ──────────────────────────────────────────
-- A `SELECT *` view freezes its column list at creation, so the freshly added
-- workspace_id is NOT visible through the existing views until they are rebuilt.
-- This is the same idempotent rebuild as 20260630000000_expose_vantage_views.sql.
do $$
declare
  t text;
  roles_to_keep text[];
  r text;
begin
  for t in select tablename from pg_tables where schemaname = 'vantage' order by tablename
  loop
    if exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind <> 'v'
    ) then
      continue;
    end if;

    select array_agg(distinct grantee) into roles_to_keep
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = t and grantee = 'authenticated';

    execute format('drop view if exists public.%I', t);
    execute format('create view public.%I as select * from vantage.%I', t, t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);

    if roles_to_keep is not null then
      foreach r in array roles_to_keep loop
        execute format('grant select, insert, update, delete on public.%I to %I', t, r);
      end loop;
    end if;
  end loop;
end $$;

-- 13. RLS backstop — scope authenticated access to workspaces the user owns ────
-- Defense in depth only: the API uses the service_role key (bypasses RLS) and is
-- the real enforcement point (see Phase 1c). The public.* views also run as their
-- (superuser) owner and bypass base-table RLS, so these policies do not change
-- current browser behavior — they harden any future direct base-table access.
do $$
declare
  t text;
  pred text := 'workspace_id in (select id from vantage.workspaces where owner_id = auth.uid())';
begin
  foreach t in array array[
    'brand_voice','channels','topics','content_pieces','engagement_events',
    'generation_weights','newsletter_subscribers','email_templates','demoforge_jobs'
  ] loop
    execute format('drop policy if exists %I on vantage.%I', 'vantage_' || t || '_all', t);
    execute format('drop policy if exists %I on vantage.%I', t || '_auth', t);
    execute format(
      'create policy %I on vantage.%I for all to authenticated using (%s) with check (%s)',
      'vantage_' || t || '_ws', t, pred, pred);
  end loop;
end $$;
