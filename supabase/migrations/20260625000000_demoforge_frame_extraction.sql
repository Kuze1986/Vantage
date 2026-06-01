-- DemoForge Frame Extraction
-- Stores extracted keyframes from rendered videos for thumbnail generation

-- Add extracted_frames column to demoforge_jobs
ALTER TABLE vantage.demoforge_jobs
ADD COLUMN extracted_frames jsonb;  -- [{ timestamp_sec: 2.5, url: "s3://...", extracted_at: "..." }]

-- Create index for faster filtering
CREATE INDEX idx_demoforge_jobs_extracted_frames
ON vantage.demoforge_jobs USING GIN (extracted_frames);

-- Comment
COMMENT ON COLUMN vantage.demoforge_jobs.extracted_frames IS 'Array of extracted keyframe objects { timestamp_sec, url, extracted_at }';
