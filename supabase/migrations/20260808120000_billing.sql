-- Phase 4-7: Billing & Plans.
--
-- One Stripe Customer + Subscription per workspace. Quota is metered on
-- generation (not publication) and enforced as a hard block; no overage is
-- billed, so there is no metered-price plumbing here.
--
-- Additive and idempotent. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Stripe mirror
-- ---------------------------------------------------------------------------

-- One row per workspace that has ever reached checkout.
CREATE TABLE IF NOT EXISTS vantage.billing_customers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL UNIQUE REFERENCES vantage.workspaces (id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL UNIQUE,
  email              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- One active subscription per workspace. `plan_key` is resolved from the Stripe
-- price id at webhook time and stored, so quota checks never call Stripe.
CREATE TABLE IF NOT EXISTS vantage.billing_subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid NOT NULL UNIQUE REFERENCES vantage.workspaces (id) ON DELETE CASCADE,
  billing_customer_id    uuid REFERENCES vantage.billing_customers (id) ON DELETE SET NULL,
  stripe_subscription_id text NOT NULL UNIQUE,
  status                 text NOT NULL,
  price_id               text,
  plan_key               text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vantage.billing_invoices (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid REFERENCES vantage.workspaces (id) ON DELETE CASCADE,
  stripe_invoice_id        text UNIQUE,
  stripe_payment_intent_id text,
  amount_paid              integer,
  currency                 text,
  status                   text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

-- Webhook idempotency. Stripe redelivers; the unique id makes replay a no-op.
CREATE TABLE IF NOT EXISTS vantage.billing_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  type            text NOT NULL,
  payload         jsonb,
  processed_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Usage metering
-- ---------------------------------------------------------------------------

-- A new billing period produces a new row rather than resetting an old one, so
-- "reset at renewal" needs no scheduled job and prior periods stay as history.
CREATE TABLE IF NOT EXISTS vantage.usage_counters (
  workspace_id uuid    NOT NULL REFERENCES vantage.workspaces (id) ON DELETE CASCADE,
  metric       text    NOT NULL,
  period_start date    NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, metric, period_start)
);

CREATE INDEX IF NOT EXISTS usage_counters_workspace_period_idx
  ON vantage.usage_counters (workspace_id, period_start);

/*
 * Atomic increment. Doing this as read-then-write in the API would race two
 * concurrent generations into the same count and let a workspace exceed quota.
 * SECURITY DEFINER so the service role can call it through PostgREST.
 */
CREATE OR REPLACE FUNCTION public.increment_usage_counter(
  p_workspace_id uuid,
  p_metric       text,
  p_period_start date,
  p_amount       integer DEFAULT 1
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vantage, public
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO vantage.usage_counters (workspace_id, metric, period_start, count, updated_at)
  VALUES (p_workspace_id, p_metric, p_period_start, p_amount, now())
  ON CONFLICT (workspace_id, metric, period_start) DO UPDATE
    SET count = vantage.usage_counters.count + EXCLUDED.count,
        updated_at = now()
  RETURNING count INTO new_count;
  RETURN new_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_usage_counter(uuid, text, date, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.increment_usage_counter(uuid, text, date, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- RLS — service role only. The API is the enforcement point; nothing about
-- billing should be reachable from the browser's anon/user key.
-- ---------------------------------------------------------------------------

ALTER TABLE vantage.billing_customers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vantage.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vantage.billing_invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vantage.billing_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vantage.usage_counters        ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'billing_customers','billing_subscriptions','billing_invoices','billing_events','usage_counters'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON vantage.%I', t || '_service', t);
    EXECUTE format(
      'CREATE POLICY %I ON vantage.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t || '_service', t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Public proxy views (PostgREST serves only `public`)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.billing_customers     AS SELECT * FROM vantage.billing_customers;
CREATE OR REPLACE VIEW public.billing_subscriptions AS SELECT * FROM vantage.billing_subscriptions;
CREATE OR REPLACE VIEW public.billing_invoices      AS SELECT * FROM vantage.billing_invoices;
CREATE OR REPLACE VIEW public.billing_events        AS SELECT * FROM vantage.billing_events;
CREATE OR REPLACE VIEW public.usage_counters        AS SELECT * FROM vantage.usage_counters;
