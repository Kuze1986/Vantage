-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2: A/B variants, music library, DemoForge jobs
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A/B variant grouping on content pieces ────────────────────────────────────
alter table vantage.content_pieces
  add column if not exists variant_group_id uuid,
  add column if not exists image_url        text;

create index if not exists content_pieces_variant_group_idx
  on vantage.content_pieces (variant_group_id)
  where variant_group_id is not null;

-- ── Music library ─────────────────────────────────────────────────────────────
create table if not exists vantage.music_tracks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  artist        text,
  mood          text not null,    -- e.g. 'upbeat', 'calm', 'inspirational', 'corporate'
  use_case      text not null,    -- e.g. 'intro', 'background', 'outro', 'general'
  duration_secs int,
  storage_path  text not null,    -- path inside vantage-media bucket
  bpm           int,
  created_at    timestamptz default now()
);

alter table vantage.music_tracks enable row level security;
create policy "music_tracks_auth"    on vantage.music_tracks for all to authenticated using (true) with check (true);
create policy "music_tracks_service" on vantage.music_tracks for all to service_role  using (true) with check (true);

-- ── DemoForge video generation jobs ──────────────────────────────────────────
create table if not exists vantage.demoforge_jobs (
  id                uuid primary key default gen_random_uuid(),
  content_piece_id  uuid references vantage.content_pieces(id) on delete set null,
  status            text not null default 'pending'
                      check (status in ('pending','recording','synthesizing','mixing','done','failed')),
  target_format     text not null
                      check (target_format in ('tiktok','linkedin','instagram')),
  input_payload     jsonb not null default '{}',
  output_url        text,         -- Supabase Storage URL once done
  error_message     text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists demoforge_jobs_status_idx   on vantage.demoforge_jobs (status);
create index if not exists demoforge_jobs_piece_id_idx on vantage.demoforge_jobs (content_piece_id);

alter table vantage.demoforge_jobs enable row level security;
create policy "demoforge_jobs_auth"    on vantage.demoforge_jobs for all to authenticated using (true) with check (true);
create policy "demoforge_jobs_service" on vantage.demoforge_jobs for all to service_role  using (true) with check (true);

-- ── Public views ──────────────────────────────────────────────────────────────
create or replace view public.music_tracks    as select * from vantage.music_tracks;
create or replace view public.demoforge_jobs  as select * from vantage.demoforge_jobs;

grant select, insert, update, delete on public.music_tracks   to authenticated, service_role;
grant select, insert, update, delete on public.demoforge_jobs to authenticated, service_role;

-- Refresh the content_pieces public view to pick up new columns
create or replace view public.content_pieces as select * from vantage.content_pieces;
grant select, insert, update, delete on public.content_pieces to authenticated, service_role;
