-- Widen campaign channel allowlists to all social platforms (email excluded).
-- Previously primary_channel / KPI source CHECKs only allowed x, linkedin, reddit.

ALTER TABLE vantage.campaign_timeline
  DROP CONSTRAINT campaign_timeline_primary_channel_check;

ALTER TABLE vantage.campaign_timeline
  ADD CONSTRAINT campaign_timeline_primary_channel_check
  CHECK (primary_channel = ANY (ARRAY[
    'x'::text,
    'linkedin'::text,
    'reddit'::text,
    'threads'::text,
    'bluesky'::text,
    'tiktok'::text,
    'instagram'::text,
    'facebook'::text
  ]));

ALTER TABLE vantage.campaign_kpi_tracking
  DROP CONSTRAINT campaign_kpi_tracking_source_check;

ALTER TABLE vantage.campaign_kpi_tracking
  ADD CONSTRAINT campaign_kpi_tracking_source_check
  CHECK (source = ANY (ARRAY[
    'x'::text,
    'linkedin'::text,
    'reddit'::text,
    'threads'::text,
    'bluesky'::text,
    'tiktok'::text,
    'instagram'::text,
    'facebook'::text,
    'all'::text
  ]));

ALTER TABLE vantage.campaigns
  ALTER COLUMN channel_mix SET DEFAULT '{
    "x": {"daily": 2},
    "linkedin": {"daily": 1},
    "reddit": {"daily": 1},
    "threads": {"daily": 1},
    "bluesky": {"daily": 1},
    "tiktok": {"daily": 1},
    "instagram": {"daily": 1},
    "facebook": {"daily": 1}
  }'::jsonb;

COMMENT ON COLUMN vantage.campaigns.channel_mix IS
  'Daily channel targets: { x: { daily: number }, linkedin: {...}, ... } for any campaign social channel';
