-- Audience Model
-- Segmentation, behavioral tracking, and lifetime value calculation

-- Create segments table
CREATE TABLE vantage.segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vantage.workspaces(id) ON DELETE CASCADE,

  -- Segment metadata
  name text NOT NULL,
  description text,
  segment_type text NOT NULL CHECK (segment_type IN ('behavioral', 'demographic', 'technographic', 'geographic', 'custom')),

  -- Segment definition (criteria for membership)
  -- definition: { match_type: "all" | "any", rules: [{ field, operator, value }] }
  definition jsonb NOT NULL,

  -- Target characteristics
  -- target_characteristics: { industry, company_size, role, location, interests }
  target_characteristics jsonb DEFAULT '{}'::jsonb,

  -- Engagement patterns
  -- engagement_pattern: { avg_posts_per_week, avg_engagement_rate, preferred_content_types, peak_days }
  engagement_pattern jsonb DEFAULT '{}'::jsonb,

  -- Size and growth
  member_count integer DEFAULT 0,
  growth_rate decimal(5,2), -- Monthly growth percentage

  -- Preferences (what this segment likes)
  -- preferences: { content_types: [...], tones: [...], post_lengths, best_posting_times }
  preferences jsonb DEFAULT '{}'::jsonb,

  -- LTV data
  -- ltv_metrics: { average_ltv, median_ltv, ltv_trend, churn_rate }
  ltv_metrics jsonb DEFAULT '{}'::jsonb,

  -- GA4 integration
  ga4_dimension_id text, -- Dimension ID in GA4 (e.g., user_segment, custom_user_id)
  ga4_filter_expression text, -- Filter expression for GA4 API queries

  -- Status
  is_active boolean DEFAULT true,
  last_synced_at timestamp with time zone,

  -- Metadata
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create segment_members table (tracks individual users/audience members)
CREATE TABLE vantage.segment_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vantage.workspaces(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL REFERENCES vantage.segments(id) ON DELETE CASCADE,

  -- Member identification
  external_id text NOT NULL, -- From GA4, Twitter ID, LinkedIn ID, etc.
  source_platform text NOT NULL CHECK (source_platform IN ('x', 'linkedin', 'reddit', 'ga4')),
  member_handle text, -- @handle or email

  -- Member profile
  -- profile: { name, email, company, role, location, interests, bio }
  profile jsonb DEFAULT '{}'::jsonb,

  -- Engagement history
  total_interactions integer DEFAULT 0,
  first_interaction_at timestamp with time zone,
  last_interaction_at timestamp with time zone,

  -- Behavioral data
  -- behaviors: { avg_engagement_rate, preferred_content_types, posting_frequency, response_time }
  behaviors jsonb DEFAULT '{}'::jsonb,

  -- Value metrics
  lifetime_value decimal(12,2), -- Total value generated (can be calculated or imported from GA4)
  predicted_churn_risk decimal(3,2), -- 0-1, probability of churn
  engagement_score decimal(3,2), -- 0-1, overall engagement quality

  -- Membership tracking
  joined_segment_at timestamp with time zone DEFAULT now(),
  is_active boolean DEFAULT true,

  -- Metadata
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create segment_analytics table (time-series metrics per segment)
CREATE TABLE vantage.segment_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vantage.workspaces(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL REFERENCES vantage.segments(id) ON DELETE CASCADE,

  -- Time window
  date_tracked date NOT NULL,

  -- Segment performance
  active_members integer, -- Members active in this period
  new_members integer,
  churned_members integer,

  -- Engagement metrics
  total_impressions integer DEFAULT 0,
  total_engagements integer DEFAULT 0,
  average_engagement_rate decimal(5,2),

  -- Content performance
  top_content_type text, -- Most engaged content type for segment
  preferred_posting_time text, -- Hour of day with highest engagement
  average_response_time_hours decimal(5,2),

  -- Conversion/value metrics
  conversions integer DEFAULT 0,
  conversion_value decimal(12,2),
  segment_revenue decimal(12,2),

  -- Metadata
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create ga4_sync_config table (stores GA4 connection settings)
CREATE TABLE vantage.ga4_sync_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vantage.workspaces(id) ON DELETE CASCADE UNIQUE,

  -- GA4 credentials
  property_id text NOT NULL, -- GA4 property ID
  measurement_id text,

  -- API authentication
  -- service_account_json: encrypted service account JSON for OAuth
  service_account_json_encrypted text,

  -- Sync configuration
  -- dimension_mapping: { ga4_dimension: segment_field, ... }
  dimension_mapping jsonb,

  -- Conversion event names to track
  -- conversion_events: ["purchase", "sign_up", "contact_us"]
  conversion_events jsonb DEFAULT '[]'::jsonb,

  -- LTV calculation method
  -- ltv_config: { method: "simple" | "cohort", window_days: 90, ... }
  ltv_config jsonb DEFAULT '{"method": "simple", "window_days": 90}'::jsonb,

  -- Sync status
  is_active boolean DEFAULT true,
  last_sync_at timestamp with time zone,
  last_sync_status text CHECK (last_sync_status IN ('success', 'failed', 'partial')),

  -- Metadata
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create segment_preferences table (what segments prefer in content)
CREATE TABLE vantage.segment_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL REFERENCES vantage.segments(id) ON DELETE CASCADE UNIQUE,

  -- Content preferences
  -- content_types: ["thought_leadership", "educational", "entertaining", "promotional"]
  preferred_content_types jsonb DEFAULT '[]'::jsonb,

  -- Tone preferences
  -- tones: ["professional", "casual", "technical", "inspirational"]
  preferred_tones jsonb DEFAULT '[]'::jsonb,

  -- Format preferences
  -- formats: ["short_text", "thread", "video", "carousel", "infographic"]
  preferred_formats jsonb DEFAULT '[]'::jsonb,

  -- Temporal preferences
  -- posting_schedule: { best_days: ["monday", "tuesday"], best_hours: [9, 10, 14] }
  posting_schedule jsonb,

  -- Length preferences
  avg_preferred_post_length integer, -- Character count
  prefers_visuals boolean DEFAULT true,
  prefers_hashtags boolean,

  -- Topic affinities
  -- topic_interests: { "ai": 0.9, "marketing": 0.8, "sales": 0.6 }
  topic_interests jsonb DEFAULT '{}'::jsonb,

  -- Call-to-action preferences
  -- cta_types: ["link", "comment", "share", "follow"]
  preferred_cta_types jsonb DEFAULT '[]'::jsonb,

  -- Metadata
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create ml_inference_cache table (stores ML model predictions for efficient reuse)
CREATE TABLE vantage.ml_inference_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vantage.workspaces(id) ON DELETE CASCADE,

  -- Inference request
  input_hash text NOT NULL, -- Hash of input data
  model_type text NOT NULL CHECK (model_type IN ('segment_membership', 'churn_prediction', 'ltv_prediction', 'content_preference')),

  -- Result
  -- output: { prediction_type: value, confidence: 0-1, ... }
  output jsonb NOT NULL,

  -- Metadata
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL, -- Cache TTL

  UNIQUE(workspace_id, input_hash, model_type)
);

-- Indexes for performance
CREATE INDEX idx_segments_workspace_id ON vantage.segments(workspace_id);
CREATE INDEX idx_segments_is_active ON vantage.segments(is_active);
CREATE INDEX idx_segment_members_segment_id ON vantage.segment_members(segment_id);
CREATE INDEX idx_segment_members_workspace_id ON vantage.segment_members(workspace_id);
CREATE INDEX idx_segment_members_external_id ON vantage.segment_members(external_id);
CREATE INDEX idx_segment_members_is_active ON vantage.segment_members(is_active);
CREATE INDEX idx_segment_analytics_segment_id ON vantage.segment_analytics(segment_id);
CREATE INDEX idx_segment_analytics_date ON vantage.segment_analytics(date_tracked);
CREATE INDEX idx_ga4_sync_config_workspace_id ON vantage.ga4_sync_config(workspace_id);
CREATE INDEX idx_segment_preferences_segment_id ON vantage.segment_preferences(segment_id);
CREATE INDEX idx_ml_inference_cache_workspace_id ON vantage.ml_inference_cache(workspace_id);
CREATE INDEX idx_ml_inference_cache_expires_at ON vantage.ml_inference_cache(expires_at);

-- Comments
COMMENT ON TABLE vantage.segments IS 'Audience segments for campaign targeting and personalization';
COMMENT ON TABLE vantage.segment_members IS 'Individual members/users assigned to segments with behavioral and value metrics';
COMMENT ON TABLE vantage.segment_analytics IS 'Time-series performance metrics per segment for trend analysis';
COMMENT ON TABLE vantage.ga4_sync_config IS 'Configuration for Google Analytics 4 integration and segment syncing';
COMMENT ON TABLE vantage.segment_preferences IS 'Learned preferences for content types, tones, formats per segment';
COMMENT ON TABLE vantage.ml_inference_cache IS 'Cache for ML model predictions (segment membership, churn, LTV, preferences)';
COMMENT ON COLUMN vantage.segments.definition IS 'Segment membership criteria: {match_type: "all"|"any", rules: [{field, operator, value}]}';
COMMENT ON COLUMN vantage.segment_members.lifetime_value IS 'Total value generated by member; can be calculated from GA4 or imported';
COMMENT ON COLUMN vantage.segment_members.predicted_churn_risk IS 'ML prediction of churn probability (0-1); used for retention campaigns';
COMMENT ON COLUMN vantage.ga4_sync_config.ltv_config IS 'LTV calculation method and parameters: {method: "simple"|"cohort", window_days: 90}';
