-- Vantage schema (nexus-core). Manual confirmation before apply in production.
drop schema if exists vantage cascade;
create schema vantage;

create table vantage.brand_voice (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  per_channel_tone jsonb not null default '{}',
  off_topics text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table vantage.channels (
  slug text primary key,
  display_name text not null,
  auth_method text not null check (auth_method in ('oauth','api_key','manual')),
  auth_state jsonb,
  access_token_hash text,
  enabled boolean default false,
  cadence_config jsonb not null default '{}',
  connected_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table vantage.topics (
  id uuid primary key default gen_random_uuid(),
  source_product text not null,
  source_ref text,
  vertical text,
  topic_text text not null,
  context_payload jsonb,
  priority numeric default 0,
  used_at timestamptz,
  created_at timestamptz default now()
);

create index topics_priority_unused_idx on vantage.topics (priority desc, created_at desc) where used_at is null;

create table vantage.content_pieces (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references vantage.topics(id) on delete cascade,
  channel_slug text not null references vantage.channels(slug),
  format text not null,
  content_payload jsonb not null,
  status text not null check (status in ('draft','auditing','approved','rejected','queued','published','failed')),
  audit_notes text,
  audit_iterations int default 0,
  scheduled_for timestamptz,
  published_at timestamptz,
  external_post_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index content_pieces_queue_idx on vantage.content_pieces (status, scheduled_for) where status = 'queued';
create index content_pieces_channel_published_idx on vantage.content_pieces (channel_slug, published_at desc);

create table vantage.engagement_events (
  id uuid primary key default gen_random_uuid(),
  content_piece_id uuid references vantage.content_pieces(id) on delete cascade,
  event_type text not null,
  event_payload jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz default now()
);

create index engagement_events_piece_time_idx on vantage.engagement_events (content_piece_id, occurred_at desc);

create table vantage.generation_weights (
  id uuid primary key default gen_random_uuid(),
  channel_slug text not null references vantage.channels(slug),
  pattern_key text not null,
  weight numeric not null default 1.0,
  sample_size int default 0,
  last_updated timestamptz default now()
);

create unique index generation_weights_channel_pattern_uidx on vantage.generation_weights (channel_slug, pattern_key);

create table vantage.activity_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_type text not null check (source_type in ('agent','system','adapter')),
  event_type text not null,
  summary text not null,
  payload jsonb,
  drill_uri text,
  occurred_at timestamptz default now()
);

create index activity_events_time_idx on vantage.activity_events (occurred_at desc);

-- Seed all channels
insert into vantage.channels (slug, display_name, auth_method, enabled, cadence_config) values
  ('x',         'X (Twitter)',  'oauth',   false, '{"posts_per_day":3,"posting_hours":[9,13,18]}'),
  ('linkedin',  'LinkedIn',     'oauth',   false, '{"posts_per_day":1,"posting_hours":[9]}'),
  ('reddit',    'Reddit',       'oauth',   false, '{"posts_per_day":2,"posting_hours":[10,17],"subreddits":[]}'),
  ('email',     'Email',        'api_key', false, '{"newsletter_day":"tuesday"}'),
  ('tiktok',    'TikTok',       'manual',  false, '{}'),
  ('instagram', 'Instagram',    'manual',  false, '{}'),
  ('facebook',  'Facebook',     'manual',  false, '{}');

alter table vantage.brand_voice enable row level security;
alter table vantage.channels enable row level security;
alter table vantage.topics enable row level security;
alter table vantage.content_pieces enable row level security;
alter table vantage.engagement_events enable row level security;
alter table vantage.generation_weights enable row level security;
alter table vantage.activity_events enable row level security;

-- Minimal single-tenant policies: authenticated users can read/write all vantage data (SPA + API user JWT).
create policy "vantage_brand_voice_all" on vantage.brand_voice for all to authenticated using (true) with check (true);
create policy "vantage_channels_all" on vantage.channels for all to authenticated using (true) with check (true);
create policy "vantage_topics_all" on vantage.topics for all to authenticated using (true) with check (true);
create policy "vantage_content_pieces_all" on vantage.content_pieces for all to authenticated using (true) with check (true);
create policy "vantage_engagement_events_all" on vantage.engagement_events for all to authenticated using (true) with check (true);
create policy "vantage_generation_weights_all" on vantage.generation_weights for all to authenticated using (true) with check (true);
create policy "vantage_activity_events_all" on vantage.activity_events for all to authenticated using (true) with check (true);

create policy "vantage_brand_voice_read_service" on vantage.brand_voice for select to service_role using (true);
create policy "vantage_channels_read_service" on vantage.channels for select to service_role using (true);
create policy "vantage_topics_read_service" on vantage.topics for select to service_role using (true);
create policy "vantage_content_pieces_read_service" on vantage.content_pieces for select to service_role using (true);
create policy "vantage_engagement_events_read_service" on vantage.engagement_events for select to service_role using (true);
create policy "vantage_generation_weights_read_service" on vantage.generation_weights for select to service_role using (true);
create policy "vantage_activity_events_read_service" on vantage.activity_events for select to service_role using (true);
