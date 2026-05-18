-- Email subscriber list for the newsletter channel.
create table vantage.newsletter_subscribers (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  name           text,
  tags           text[] default '{}',
  subscribed_at  timestamptz default now(),
  unsubscribed_at timestamptz,
  created_at     timestamptz default now(),
  constraint newsletter_subscribers_email_unique unique (email)
);

create index newsletter_subscribers_active_idx
  on vantage.newsletter_subscribers (email)
  where unsubscribed_at is null;

alter table vantage.newsletter_subscribers enable row level security;
create policy "vantage_newsletter_subscribers_all"     on vantage.newsletter_subscribers for all     to authenticated using (true) with check (true);
create policy "vantage_newsletter_subscribers_service" on vantage.newsletter_subscribers for select  to service_role  using (true);
create policy "vantage_newsletter_subscribers_write"   on vantage.newsletter_subscribers for insert  to service_role  with check (true);
create policy "vantage_newsletter_subscribers_update"  on vantage.newsletter_subscribers for update  to service_role  using (true);

-- Public view so the API (which uses public schema) can reach this table
create or replace view public.newsletter_subscribers as
  select * from vantage.newsletter_subscribers;

grant select, insert, update, delete on public.newsletter_subscribers to authenticated, service_role;
