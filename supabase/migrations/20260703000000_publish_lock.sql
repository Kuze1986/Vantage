-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2c (SaaS readiness): claim-based publish lock for the cadence engine.
--
-- The cadence tick selected queued pieces and published them without claiming
-- the row first, so a publish slower than the 60s tick — or a second API
-- instance — could grab and publish the same piece twice. This adds:
--   * a transient `publishing` status the engine moves a piece into via an
--     atomic compare-and-swap (UPDATE ... WHERE status='queued') so exactly one
--     worker wins the claim, and
--   * `locked_at`, so a stale-lock reaper can re-queue pieces left mid-publish
--     by a crashed/restarted worker.
--
-- Runs in a single transaction. Manual confirmation before apply in production.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Allow the new transient status. The original CHECK was created inline, so
--    Postgres named it content_pieces_status_check.
alter table vantage.content_pieces drop constraint if exists content_pieces_status_check;
alter table vantage.content_pieces
  add constraint content_pieces_status_check
  check (status in ('draft','auditing','approved','rejected','queued','publishing','published','failed'));

-- 2. Lock timestamp — set when a piece is claimed, cleared when released.
alter table vantage.content_pieces
  add column if not exists locked_at timestamptz;

-- Find pieces stuck mid-publish quickly (reaper query).
create index if not exists content_pieces_publishing_locked_idx
  on vantage.content_pieces (locked_at) where status = 'publishing';

-- 3. Rebuild the content_pieces public view so locked_at is visible to PostgREST.
do $$
declare roles_to_keep text[]; r text;
begin
  select array_agg(distinct grantee) into roles_to_keep
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'content_pieces' and grantee = 'authenticated';

  drop view if exists public.content_pieces;
  create view public.content_pieces as select * from vantage.content_pieces;
  grant select, insert, update, delete on public.content_pieces to service_role;
  if roles_to_keep is not null then
    foreach r in array roles_to_keep loop
      execute format('grant select, insert, update, delete on public.content_pieces to %I', r);
    end loop;
  end if;
end $$;
