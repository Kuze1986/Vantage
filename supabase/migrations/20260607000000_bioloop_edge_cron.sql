-- ─────────────────────────────────────────────────────────────────────────────
-- BioLoop edge function — daily pg_cron schedule
--
-- Prerequisites (enable once in Supabase Dashboard → Database → Extensions):
--   pg_cron   — for scheduling
--   pg_net    — for HTTP calls from SQL
--
-- After deploying the edge function (`supabase functions deploy bioloop`),
-- run this migration. Replace <PROJECT_REF> and <SERVICE_ROLE_KEY> with your
-- actual values from Supabase Dashboard → Project Settings → API.
-- ─────────────────────────────────────────────────────────────────────────────

-- Store connection details as database-level config so they are not
-- hard-coded in the cron SQL body.
-- Run these two ALTER DATABASE commands once in the SQL editor (they are
-- not re-runnable as migrations without risk of overwrite):
--
--   ALTER DATABASE postgres
--     SET app.supabase_url = 'https://<PROJECT_REF>.supabase.co';
--
--   ALTER DATABASE postgres
--     SET app.service_role_key = '<SERVICE_ROLE_KEY>';

-- Schedule BioLoop daily at 02:00 UTC
SELECT cron.schedule(
  'bioloop-daily',            -- job name (unique)
  '0 2 * * *',               -- cron expression: every day at 02:00 UTC
  $$
  SELECT
    net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/bioloop',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body    := '{}'::jsonb
    ) AS request_id;
  $$
);

-- To verify the job was created:
--   SELECT * FROM cron.job WHERE jobname = 'bioloop-daily';

-- To check recent run history:
--   SELECT * FROM cron.job_run_details WHERE jobid =
--     (SELECT jobid FROM cron.job WHERE jobname = 'bioloop-daily')
--   ORDER BY start_time DESC LIMIT 10;

-- To remove the schedule:
--   SELECT cron.unschedule('bioloop-daily');
