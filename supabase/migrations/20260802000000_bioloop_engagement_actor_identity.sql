-- Actor-identity capture on engagement_events, and Bluesky/Threads support on segment_members.
--
-- Structural fix only: engagement_events had no column at all for the identity of the user
-- who generated an engagement, which made it impossible to ever populate segment_members from
-- real webhook/poll traffic. This adds the column and widens segment_members' platform CHECK
-- for the two newly-ingested channels (bluesky, threads). Nothing yet reads actor_external_id
-- to write segment_members rows — that requires a segment-assignment engine that doesn't exist
-- in this codebase and is out of scope here.

ALTER TABLE vantage.engagement_events
  ADD COLUMN IF NOT EXISTS actor_external_id text;

COMMENT ON COLUMN vantage.engagement_events.actor_external_id IS
  'Platform-native identifier of the user who generated this engagement (e.g. X user id_str,
   LinkedIn actor URN, Resend recipient email) when the source payload exposes it. Null for
   aggregate-metric sources (Reddit/Bluesky/Threads polling, which report counts not identities)
   and for webhook payloads that do not include an identifiable actor. Structural groundwork
   only — nothing currently reads this column to populate segment_members.';

CREATE INDEX IF NOT EXISTS engagement_events_actor_external_id_idx
  ON vantage.engagement_events (actor_external_id)
  WHERE actor_external_id IS NOT NULL;

-- ALTER TABLE does not fire the expose_vantage_tables event trigger (it only fires on
-- CREATE TABLE — see 20260630000000_expose_vantage_views.sql), so the new column would
-- otherwise be invisible to PostgREST/service_role via the public proxy view.
CREATE OR REPLACE VIEW public.engagement_events AS SELECT * FROM vantage.engagement_events;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.engagement_events TO service_role;

-- Widen segment_members.source_platform now that Bluesky/Threads engagement ingestion exists.
-- Deliberately NOT adding tiktok/instagram/facebook — no engagement ingestion for those channels.
ALTER TABLE vantage.segment_members
  DROP CONSTRAINT segment_members_source_platform_check;

ALTER TABLE vantage.segment_members
  ADD CONSTRAINT segment_members_source_platform_check
  CHECK (source_platform = ANY (ARRAY[
    'x'::text,
    'linkedin'::text,
    'reddit'::text,
    'ga4'::text,
    'bluesky'::text,
    'threads'::text
  ]));
