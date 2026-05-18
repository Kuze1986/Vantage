-- PostgREST only exposes schemas listed in its config. On this Supabase instance
-- the db_schemas GUC is not user-configurable, so adding 'vantage' via the
-- dashboard has no effect. Fix: create auto-updatable views in 'public' (always
-- exposed) that proxy every vantage table. Simple SELECT * views are
-- automatically updatable in Postgres 9.3+ — INSERT/UPDATE/DELETE/RETURNING
-- all pass through to the underlying table including its defaults and triggers.

CREATE OR REPLACE VIEW public.channels           AS SELECT * FROM vantage.channels;
CREATE OR REPLACE VIEW public.topics             AS SELECT * FROM vantage.topics;
CREATE OR REPLACE VIEW public.content_pieces     AS SELECT * FROM vantage.content_pieces;
CREATE OR REPLACE VIEW public.engagement_events  AS SELECT * FROM vantage.engagement_events;
CREATE OR REPLACE VIEW public.activity_events    AS SELECT * FROM vantage.activity_events;
CREATE OR REPLACE VIEW public.brand_voice        AS SELECT * FROM vantage.brand_voice;
CREATE OR REPLACE VIEW public.generation_weights AS SELECT * FROM vantage.generation_weights;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.channels           TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.topics             TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_pieces     TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.engagement_events  TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_events    TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_voice        TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generation_weights TO authenticated, service_role;
