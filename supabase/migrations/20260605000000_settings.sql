-- ── Global pipeline settings ──────────────────────────────────────────────────
-- Single key-value store. Keys are stable; values are JSONB scalars or arrays.
-- Seeded with defaults that match prior hardcoded behavior.

create table if not exists vantage.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz default now()
);

alter table vantage.settings enable row level security;
create policy "settings_auth"    on vantage.settings for all to authenticated using (true) with check (true);
create policy "settings_service" on vantage.settings for all to service_role  using (true) with check (true);

-- Seed defaults (do not overwrite if already exists)
insert into vantage.settings (key, value) values
  ('dedup_days',        '30'),
  ('scripta_enabled',   'true'),
  ('bioloop_enabled',   'true'),
  ('active_verticals',  '[]')
on conflict (key) do nothing;

-- Public view
create or replace view public.settings as select * from vantage.settings;
grant select, insert, update, delete on public.settings to authenticated, service_role;
