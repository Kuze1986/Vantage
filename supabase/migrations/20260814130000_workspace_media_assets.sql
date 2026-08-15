create table if not exists vantage.media_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references vantage.workspaces(id) on delete cascade,
  storage_path text not null,
  title text not null,
  kind text not null check (kind in ('image', 'video')),
  created_at timestamptz not null default now(),
  unique (workspace_id, storage_path)
);

create index if not exists media_assets_workspace_created_idx
  on vantage.media_assets (workspace_id, created_at desc);

grant usage on schema vantage to service_role;
grant select, insert, update, delete on vantage.media_assets to service_role;
