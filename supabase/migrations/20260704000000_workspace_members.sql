-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2a (SaaS readiness): membership model for real auth.
--
-- Until now a workspace had exactly one user (workspaces.owner_id) and the API
-- guard authorized by owner_id. This adds workspace_members so a workspace can
-- have several users with roles, and the guard can authorize by membership.
-- Existing owners are backfilled as 'owner' members. owner_id stays on
-- workspaces as the canonical creator/billing contact.
--
-- The public.workspace_members proxy view + service_role grant are created
-- automatically by the expose_vantage_tables event trigger (20260630…).
-- Manual confirmation before apply in production.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists vantage.workspace_members (
  workspace_id uuid not null references vantage.workspaces(id) on delete cascade,
  user_id      uuid not null,
  role         text not null default 'editor' check (role in ('owner','admin','editor','viewer')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx on vantage.workspace_members (user_id);

-- Backfill: every existing workspace owner becomes an 'owner' member.
insert into vantage.workspace_members (workspace_id, user_id, role)
  select id, owner_id, 'owner' from vantage.workspaces
  on conflict (workspace_id, user_id) do nothing;

-- RLS backstop (the API enforces via service_role; defense in depth):
-- a user may read membership rows for workspaces they belong to.
alter table vantage.workspace_members enable row level security;

create policy "workspace_members_self_read" on vantage.workspace_members
  for select to authenticated
  using (
    workspace_id in (select workspace_id from vantage.workspace_members where user_id = auth.uid())
  );

create policy "workspace_members_service" on vantage.workspace_members
  for all to service_role using (true) with check (true);
