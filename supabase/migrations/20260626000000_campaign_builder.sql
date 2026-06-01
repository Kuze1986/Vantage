-- Campaign Builder
-- Multi-week campaigns with daily granularity, messaging pillars, channel targets, and KPI tracking

-- Create campaigns table
CREATE TABLE vantage.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vantage.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'paused')),

  -- Timing
  start_date date NOT NULL,
  end_date date NOT NULL,

  -- Configuration (stored as JSONB for flexibility)
  -- cadence_config: { weeks: number, periodsPerWeek: number, customPeriods?: [{ name, daysOfWeek }] }
  cadence_config jsonb NOT NULL DEFAULT '{"weeks": 3, "periodsPerWeek": 1}'::jsonb,

  -- Content strategy
  -- messaging_pillars: [{ id, name, description, tone, keyMessages, targetAudience }]
  messaging_pillars jsonb DEFAULT '[]'::jsonb,

  -- Daily channel targets (JSONB for flexibility)
  -- channel_mix: { x: { daily: number, weeklyPattern: [...] }, linkedin: {...}, reddit: {...} }
  channel_mix jsonb DEFAULT '{"x": {"daily": 2}, "linkedin": {"daily": 1}, "reddit": {"daily": 1}}'::jsonb,

  -- KPI targets for campaign duration
  -- kpi_targets: { impressions: number, engagements: number, follows: number, viralityScore: number }
  kpi_targets jsonb DEFAULT '{"impressions": 10000, "engagements": 500}'::jsonb,

  -- Metadata
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create campaign_timeline table (one row per day)
CREATE TABLE vantage.campaign_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES vantage.campaigns(id) ON DELETE CASCADE,

  -- Day numbering (0-based from campaign start_date)
  day_number integer NOT NULL,
  date_scheduled date NOT NULL,

  -- Content strategy for this day
  -- messaging_pillar_id: which pillar this day focuses on
  messaging_pillar_id text,
  content_type text DEFAULT 'mixed' CHECK (content_type IN ('promotional', 'educational', 'engagement', 'behind_the_scenes', 'mixed')),

  -- Channel routing
  primary_channel text NOT NULL CHECK (primary_channel IN ('x', 'linkedin', 'reddit')),
  -- secondary_channels: ["linkedin", "reddit"] — will cross-post
  secondary_channels jsonb DEFAULT '[]'::jsonb,

  -- Content ideas generated for this day (AI-assisted)
  -- content_ideas: [{ id, title, outline, demoforgeScript, notes }]
  content_ideas jsonb DEFAULT '[]'::jsonb,

  -- Content that was actually published
  -- published_pieces: [{ id, content_piece_id, channels, publishedAt }]
  published_pieces jsonb DEFAULT '[]'::jsonb,

  -- Created/updated tracking
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create campaign_kpi_tracking table (daily rollup)
CREATE TABLE vantage.campaign_kpi_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES vantage.campaigns(id) ON DELETE CASCADE,

  -- Date this metrics snapshot represents
  date_tracked date NOT NULL,

  -- Performance metrics
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  engagements integer DEFAULT 0,
  shares integer DEFAULT 0,
  follows integer DEFAULT 0,

  -- Virality indicators (populated by BioLoop layer later)
  virality_score decimal(5,2) DEFAULT 0,
  segment_id uuid REFERENCES vantage.segments(id) ON DELETE SET NULL,

  -- Per-channel breakdown (optional, for now rolled up)
  source text CHECK (source IN ('x', 'linkedin', 'reddit', 'all')),

  -- Metadata
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Indexes for query performance
CREATE INDEX idx_campaigns_workspace_id ON vantage.campaigns(workspace_id);
CREATE INDEX idx_campaigns_status ON vantage.campaigns(status);
CREATE INDEX idx_campaign_timeline_campaign_id ON vantage.campaign_timeline(campaign_id);
CREATE INDEX idx_campaign_timeline_date ON vantage.campaign_timeline(date_scheduled);
CREATE INDEX idx_campaign_kpi_tracking_campaign_id ON vantage.campaign_kpi_tracking(campaign_id);
CREATE INDEX idx_campaign_kpi_tracking_date ON vantage.campaign_kpi_tracking(date_tracked);

-- Comments
COMMENT ON TABLE vantage.campaigns IS 'Multi-week social campaigns with daily granularity, messaging pillars, and channel targets';
COMMENT ON TABLE vantage.campaign_timeline IS 'Per-day campaign timeline entries; one row per campaign day';
COMMENT ON TABLE vantage.campaign_kpi_tracking IS 'Daily KPI tracking rollup for campaigns; populated by analytics sync';
COMMENT ON COLUMN vantage.campaigns.cadence_config IS 'Campaign structure: { weeks: number, periodsPerWeek: number, customPeriods?: [...] }';
COMMENT ON COLUMN vantage.campaigns.messaging_pillars IS 'Content strategy array: [{ id, name, description, tone, keyMessages, targetAudience }]';
COMMENT ON COLUMN vantage.campaigns.channel_mix IS 'Daily channel targets: { x: { daily: number }, linkedin: {...}, reddit: {...} }';
COMMENT ON COLUMN vantage.campaign_timeline.content_ideas IS 'AI-generated content ideas: [{ id, title, outline, demoforgeScript, notes }]';
COMMENT ON COLUMN vantage.campaign_timeline.published_pieces IS 'Content actually published on this day: [{ id, content_piece_id, channels, publishedAt }]';
