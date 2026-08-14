-- ── Global pipeline settings mitigation ──────────────────────────────────────
-- Older deployments may have created the table without a primary key or policies.

create table if not exists vantage.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz default now()
);

alter table vantage.settings enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'vantage' and tablename = 'settings' and policyname = 'settings_auth') then
    create policy "settings_auth" on vantage.settings for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'vantage' and tablename = 'settings' and policyname = 'settings_service') then
    create policy "settings_service" on vantage.settings for all to service_role using (true) with check (true);
  end if;
end $$;

insert into vantage.settings (key, value)
select seed.key, seed.value
from (values
  ('dedup_days', '30'::jsonb),
  ('scripta_enabled', 'true'::jsonb),
  ('bioloop_enabled', 'true'::jsonb),
  ('active_verticals', '[]'::jsonb)
) as seed(key, value)
where not exists (select 1 from vantage.settings existing where existing.key = seed.key);

create or replace view public.settings as select * from vantage.settings;
grant select, insert, update, delete on public.settings to authenticated, service_role;
