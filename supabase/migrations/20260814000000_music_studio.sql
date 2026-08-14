create table if not exists vantage.music_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null,
  duration_secs numeric not null default 30,
  master_volume numeric not null default 1,
  export_settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vantage.music_project_clips (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references vantage.music_projects(id) on delete cascade,
  track_type text not null check (track_type in ('music', 'narration', 'effect')),
  music_track_id uuid references vantage.music_tracks(id) on delete set null,
  title text not null,
  storage_path text,
  start_secs numeric not null default 0,
  trim_start_secs numeric not null default 0,
  trim_end_secs numeric,
  duration_secs numeric not null default 0,
  volume numeric not null default 1,
  fade_in_secs numeric not null default 0,
  fade_out_secs numeric not null default 0,
  loop_enabled boolean not null default false,
  muted boolean not null default false,
  created_at timestamptz not null default now()
);

alter table vantage.music_projects enable row level security;
alter table vantage.music_project_clips enable row level security;
create policy "music_projects_auth" on vantage.music_projects for all to authenticated using (true) with check (true);
create policy "music_projects_service" on vantage.music_projects for all to service_role using (true) with check (true);
create policy "music_project_clips_auth" on vantage.music_project_clips for all to authenticated using (true) with check (true);
create policy "music_project_clips_service" on vantage.music_project_clips for all to service_role using (true) with check (true);

create or replace view public.music_projects as select * from vantage.music_projects;
create or replace view public.music_project_clips as select * from vantage.music_project_clips;
grant select, insert, update, delete on public.music_projects, public.music_project_clips to authenticated, service_role;
