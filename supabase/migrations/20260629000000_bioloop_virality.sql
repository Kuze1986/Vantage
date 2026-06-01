-- BioLoop Virality Signals
-- Multi-platform trend detection and segment-aware virality analysis

-- Create viral_signals table (tracks posts with unusual viral patterns)
CREATE TABLE vantage.viral_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vantage.workspaces(id) ON DELETE CASCADE,

  -- Source post information
  source_platform text NOT NULL CHECK (source_platform IN ('x', 'linkedin', 'reddit')),
  source_post_id text NOT NULL,
  source_account_id text NOT NULL,
  source_account_name text NOT NULL,
  post_content text,
  posted_at timestamp with time zone,

  -- Engagement metrics
  impressions integer DEFAULT 0,
  engagements integer DEFAULT 0,
  likes integer DEFAULT 0,
  reposts_shares integer DEFAULT 0,
  replies integer DEFAULT 0,

  -- Virality indicators (what makes it go viral, not just engaged)
  -- virality_score: 0-1, likelihood of continued exponential growth
  virality_score decimal(3,2),

  -- velocity_metrics: { engagement_rate_per_hour, growth_acceleration, momentum_score }
  velocity_metrics jsonb,

  -- engagement_type: "organic_share" | "reply_driven" | "algorithm_amplified" | "community_amplified"
  engagement_type text,

  -- Trend correlation
  -- related_trends: [{ trend_id, trend_name, correlation_strength }]
  related_trends jsonb DEFAULT '[]'::jsonb,

  -- Segment affinity (which segments respond to this content style)
  -- segment_affinity: { segment_id: virality_lift_percentage, ... }
  segment_affinity jsonb DEFAULT '{}'::jsonb,

  -- Content characteristics that drove virality
  -- viral_characteristics: { format: "thread" | "video" | "image" | "text", hooks: [...], emotional_trigger: [...] }
  viral_characteristics jsonb,

  -- Replicability score (0-1: how reproducible is this virality)
  replicability_score decimal(3,2),

  -- Status and tracking
  is_benchmark boolean DEFAULT false, -- Flag as reference viral post
  analyzed_at timestamp with time zone DEFAULT now(),

  -- Metadata
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create virality_patterns table (aggregated viral patterns by segment/platform)
CREATE TABLE vantage.virality_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vantage.workspaces(id) ON DELETE CASCADE,
  segment_id uuid REFERENCES vantage.segments(id) ON DELETE SET NULL,

  -- Platform and timeframe
  source_platform text NOT NULL CHECK (source_platform IN ('x', 'linkedin', 'reddit')),
  pattern_window_days integer DEFAULT 7,

  -- Pattern characteristics
  pattern_name text NOT NULL, -- e.g., "question_driven_threads", "video_shorts", "contrarian_takes"
  pattern_description text,

  -- Performance metrics for this pattern
  sample_size integer, -- Number of posts analyzed
  avg_virality_score decimal(3,2),
  median_engagement_rate decimal(5,2),
  percentile_90_virality decimal(3,2), -- Top 10% virality

  -- Content characteristics
  -- characteristics: { format, hooks, tone, length, call_to_action, timing }
  characteristics jsonb,

  -- Success indicators
  success_indicators jsonb, -- [{ indicator, importance, threshold }]

  -- Reproducibility metrics
  reproduction_success_rate decimal(3,2), -- % of similar posts that go viral
  confidence_score decimal(3,2), -- How confident in this pattern

  -- Segment-specific performance
  segment_lift_percentage integer, -- % better/worse for specific segment vs. baseline

  -- Metadata
  detected_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create virality_recommendations table (AI-generated viral content strategies)
CREATE TABLE vantage.virality_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vantage.workspaces(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES vantage.campaigns(id) ON DELETE SET NULL,
  segment_id uuid REFERENCES vantage.segments(id) ON DELETE SET NULL,

  -- Recommendation details
  title text NOT NULL,
  description text NOT NULL,

  -- Viral strategy recommendation
  -- strategy: { pattern_to_follow, format, hooks, tone, timing, cta, expected_virality_lift }
  strategy jsonb NOT NULL,

  -- Evidence
  -- evidence: [{ post_id, platform, engagement_rate, virality_score, published_at }]
  supporting_evidence jsonb DEFAULT '[]'::jsonb,

  -- Expected outcome
  expected_virality_score decimal(3,2), -- Predicted virality (0-1)
  expected_engagement_lift integer, -- % improvement vs. baseline
  expected_reach_lift integer, -- % reach improvement

  -- Feasibility and risk
  implementation_difficulty text CHECK (implementation_difficulty IN ('low', 'medium', 'high')),
  viral_sustainability text CHECK (viral_sustainability IN ('one_time', 'short_term', 'sustained')),

  -- Segment-specific insights
  segment_match_score decimal(3,2), -- How well this matches segment preferences
  cross_platform_potential boolean, -- Can this pattern work on other platforms?

  -- Status
  status text DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'actioned', 'tested', 'dismissed')),
  tested_at timestamp with time zone,
  performance_feedback jsonb, -- { actual_virality, actual_engagement, notes }

  -- Metadata
  generated_by text, -- "claude" | "gpt-4o" | "grok"
  generated_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create platform_velocity_tracking table (real-time velocity monitoring)
CREATE TABLE vantage.platform_velocity_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vantage.workspaces(id) ON DELETE CASCADE,

  -- Time window
  date_tracked date NOT NULL,
  platform text NOT NULL CHECK (platform IN ('x', 'linkedin', 'reddit')),

  -- Velocity metrics
  -- average_time_to_virality_hours: how long until post hits viral threshold
  average_time_to_virality_hours decimal(5,2),

  -- velocity_acceleration: posts per hour in first 24 hours for viral content
  velocity_acceleration decimal(8,2),

  -- Engagement patterns
  peak_engagement_hour integer, -- Hour of day with peak engagement (0-23)
  engagement_curve text, -- "exponential" | "linear" | "plateau" | "saw_tooth"

  -- Trending topics
  -- trending_topics: [{ topic, mention_count, growth_rate, virality_correlation }]
  trending_topics jsonb DEFAULT '[]'::jsonb,

  -- Segment-specific velocity
  -- segment_velocity: { segment_id: avg_time_to_virality_hours, ... }
  segment_velocity jsonb DEFAULT '{}'::jsonb,

  -- Metadata
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create virality_boost_signals table (early detection of emerging viral content)
CREATE TABLE vantage.virality_boost_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vantage.workspaces(id) ON DELETE CASCADE,

  -- Detected post
  post_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('x', 'linkedin', 'reddit')),
  post_url text,
  post_content text,

  -- Early signals detected
  -- signals: [{ signal_type: "velocity_spike" | "engagement_clustering" | "authority_endorsement", score, detected_at }]
  signals jsonb NOT NULL,

  -- Confidence in viral prediction
  viral_probability decimal(3,2), -- 0-1: probability this will go viral in next 24h
  time_to_virality_estimate_hours integer,

  -- Recommended action
  recommended_action text, -- "amplify" | "watch" | "participate" | "feature"

  -- Segment opportunity
  best_segments_for_amplification jsonb, -- [{ segment_id, segment_name, lift_potential }]

  -- Alert status
  alert_sent boolean DEFAULT false,
  sent_at timestamp with time zone,

  -- Outcome
  actual_virality_score decimal(3,2), -- Filled after 24-48 hours
  prediction_accuracy decimal(3,2), -- 0-1: how accurate was prediction

  -- Metadata
  detected_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_viral_signals_workspace_id ON vantage.viral_signals(workspace_id);
CREATE INDEX idx_viral_signals_platform ON vantage.viral_signals(source_platform);
CREATE INDEX idx_viral_signals_virality_score ON vantage.viral_signals(virality_score DESC);
CREATE INDEX idx_viral_signals_posted_at ON vantage.viral_signals(posted_at DESC);

CREATE INDEX idx_virality_patterns_workspace_id ON vantage.virality_patterns(workspace_id);
CREATE INDEX idx_virality_patterns_segment_id ON vantage.virality_patterns(segment_id);
CREATE INDEX idx_virality_patterns_platform ON vantage.virality_patterns(source_platform);

CREATE INDEX idx_virality_recommendations_workspace_id ON vantage.virality_recommendations(workspace_id);
CREATE INDEX idx_virality_recommendations_campaign_id ON vantage.virality_recommendations(campaign_id);
CREATE INDEX idx_virality_recommendations_segment_id ON vantage.virality_recommendations(segment_id);
CREATE INDEX idx_virality_recommendations_status ON vantage.virality_recommendations(status);

CREATE INDEX idx_platform_velocity_workspace_id ON vantage.platform_velocity_tracking(workspace_id);
CREATE INDEX idx_platform_velocity_date ON vantage.platform_velocity_tracking(date_tracked DESC);
CREATE INDEX idx_platform_velocity_platform ON vantage.platform_velocity_tracking(platform);

CREATE INDEX idx_virality_boost_signals_workspace_id ON vantage.virality_boost_signals(workspace_id);
CREATE INDEX idx_virality_boost_signals_viral_probability ON vantage.virality_boost_signals(viral_probability DESC);
CREATE INDEX idx_virality_boost_signals_detected_at ON vantage.virality_boost_signals(detected_at DESC);

-- Comments
COMMENT ON TABLE vantage.viral_signals IS 'Detected viral signals from posts showing unusual growth patterns';
COMMENT ON TABLE vantage.virality_patterns IS 'Aggregated patterns of viral content by segment/platform with reproducibility metrics';
COMMENT ON TABLE vantage.virality_recommendations IS 'AI-generated viral content strategies with segment-specific insights';
COMMENT ON TABLE vantage.platform_velocity_tracking IS 'Real-time velocity metrics tracking how fast content goes viral per platform';
COMMENT ON TABLE vantage.virality_boost_signals IS 'Early-stage viral detection signals for emerging trending content';
COMMENT ON COLUMN vantage.viral_signals.virality_score IS '0-1 score: likelihood of continued exponential growth beyond initial engagement';
COMMENT ON COLUMN vantage.viral_signals.engagement_type IS 'Type of viral driver: organic shares, reply chains, algorithm amplification, community consensus';
COMMENT ON COLUMN vantage.virality_patterns.reproduction_success_rate IS '% of posts following this pattern that achieve viral status';
COMMENT ON COLUMN vantage.virality_boost_signals.viral_probability IS 'ML-ready probability (0-1) that post will go viral in next 24 hours';
