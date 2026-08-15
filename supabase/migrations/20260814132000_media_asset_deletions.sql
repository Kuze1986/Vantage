create table if not exists vantage.media_asset_deletions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references vantage.workspaces(id) on delete cascade,
  item_id text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, item_id)
);

create index if not exists media_asset_deletions_workspace_idx
  on vantage.media_asset_deletions (workspace_id, created_at desc);

create or replace view public.media_asset_deletions as
  select * from vantage.media_asset_deletions;

grant select, insert on public.media_asset_deletions to service_role;
