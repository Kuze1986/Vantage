-- Phase 0: single private bucket for generated media paths (expand in Phase 2 for music library).
insert into storage.buckets (id, name, public)
values ('vantage-media', 'vantage-media', false)
on conflict (id) do nothing;

-- Allow authenticated uploads to vantage-media (service role bypasses RLS for API jobs).
drop policy if exists "vantage_media_authenticated_insert" on storage.objects;
drop policy if exists "vantage_media_authenticated_select" on storage.objects;

create policy "vantage_media_authenticated_insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'vantage-media');

create policy "vantage_media_authenticated_select"
on storage.objects for select to authenticated
using (bucket_id = 'vantage-media');
