create table if not exists vantage.campaign_assets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references vantage.campaigns(id) on delete cascade,
  workspace_id uuid not null,
  title text not null,
  asset_type text not null check (asset_type in ('visual', 'gif', 'video', 'music_project')),
  source_url text,
  source_ref text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists campaign_assets_campaign_idx on vantage.campaign_assets(campaign_id, created_at desc);
alter table vantage.campaign_assets enable row level security;
create policy "campaign_assets_auth" on vantage.campaign_assets for all to authenticated using (true) with check (true);
create policy "campaign_assets_service" on vantage.campaign_assets for all to service_role using (true) with check (true);
create or replace view public.campaign_assets as select * from vantage.campaign_assets;
grant select, insert, update, delete on public.campaign_assets to authenticated, service_role;
