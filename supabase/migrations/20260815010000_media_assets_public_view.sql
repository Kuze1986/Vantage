-- The media API uses PostgREST's public schema. The original media_assets
-- migration created only vantage.media_assets, so every catalog insert failed
-- after the Storage object had already been written.
create or replace view public.media_assets as
  select * from vantage.media_assets;

grant usage on schema vantage to service_role;
grant select, insert, update, delete on public.media_assets to service_role;
