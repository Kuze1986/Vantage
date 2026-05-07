-- Idempotent add to supabase_realtime publication
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'vantage' and tablename = 'content_pieces'
  ) then
    alter publication supabase_realtime add table vantage.content_pieces;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'vantage' and tablename = 'activity_events'
  ) then
    alter publication supabase_realtime add table vantage.activity_events;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'vantage' and tablename = 'engagement_events'
  ) then
    alter publication supabase_realtime add table vantage.engagement_events;
  end if;
end $$;
