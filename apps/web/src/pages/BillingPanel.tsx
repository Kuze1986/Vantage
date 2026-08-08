// BillingPanel — plan, usage against quota, and the upgrade / manage actions.
// Lives on Settings, alongside Brand Kits.
//
// Quota is metered on generation and sold as "posts": that is what the customer
// perceives, and it is where the cost actually is.

import React from 'react'
import { vantageApi } from '../api/vantage'
import type { BillingPlan, BillingState } from '../api/vantage'
import { Panel, Badge } from '../ds'

const isUnlimited = (n: number) => n < 0

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const unlimited = isUnlimited(limit)
  const pct = unlimited || limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100))
  const spent = !unlimited && limit > 0 && used >= limit
  const near = !unlimited && limit > 0 && pct >= 80 && !spent

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--nx-text-3)', textTransform: 'uppercase' }}>
          {label}
        </span>
        <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 11, color: spent ? 'var(--nx-red, #ef4444)' : 'var(--nx-text-2)' }}>
          {unlimited ? `${used} · unlimited` : `${used} / ${limit}`}
        </span>
      </div>
      {!unlimited && (
        <div style={{ height: 5, borderRadius: 3, background: 'var(--nx-surface-2)', overflow: 'hidden' }}>
          <div style={{
            width: `${pct}%`, height: '100%',
            background: spent ? 'var(--nx-red, #ef4444)' : near ? 'var(--nx-amber)' : 'var(--nx-cyan)',
            transition: 'width 200ms',
          }} />
        </div>
      )}
    </div>
  )
}

function PlanCard({
  plan, current, interval, busy, onChoose,
}: {
  plan: BillingPlan
  current: boolean
  interval: 'monthly' | 'annual'
  busy: boolean
  onChoose: () => void
}) {
  const price = interval === 'annual' ? (plan.priceAnnual ?? plan.priceMonthly) : plan.priceMonthly
  return (
    <div style={{
      border: `1px solid ${current ? 'var(--nx-cyan)' : 'var(--nx-border)'}`,
      borderRadius: 6, padding: '14px 16px', background: 'var(--nx-surface-2)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 12, letterSpacing: '0.1em', color: 'var(--nx-text-1)' }}>
          {plan.label.toUpperCase()}
        </span>
        {current && <Badge label="current" variant="active" />}
      </div>
      <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 22, color: 'var(--nx-text-1)' }}>
        {price}
        <span style={{ fontSize: 11, color: 'var(--nx-text-4)' }}>{interval === 'annual' ? '/yr' : '/mo'}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {plan.features.map((f) => (
          <li key={f} style={{ fontFamily: 'var(--nx-mono)', fontSize: 9.5, color: 'var(--nx-text-4)', lineHeight: 1.5 }}>
            — {f}
          </li>
        ))}
      </ul>
      {!current && (
        <button
          type="button"
          onClick={onChoose}
          disabled={busy}
          className="nx-btn nx-btn--sm"
          style={{ marginTop: 'auto', justifyContent: 'center', fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.12em', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? '…' : 'CHOOSE'}
        </button>
      )}
    </div>
  )
}

export function BillingPanel() {
  const [state, setState] = React.useState<BillingState | null>(null)
  const [interval, setInterval] = React.useState<'monthly' | 'annual'>('monthly')
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)

  const load = React.useCallback(() => {
    vantageApi.getBilling()
      .then(setState)
      .catch((e) => setErr(String((e as Error).message)))
  }, [])

  React.useEffect(() => { load() }, [load])

  const choose = async (planKey: string) => {
    setBusy(true); setErr(null)
    try {
      const { url } = await vantageApi.startCheckout(planKey, interval)
      window.location.href = url
    } catch (e) {
      setErr(String((e as Error).message))
      setBusy(false)
    }
  }

  const manage = async () => {
    setBusy(true); setErr(null)
    try {
      const { url } = await vantageApi.openBillingPortal()
      window.location.href = url
    } catch (e) {
      setErr(String((e as Error).message))
      setBusy(false)
    }
  }

  if (!state) {
    return (
      <Panel title="Billing" titleAccent="cyan">
        <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 11, color: 'var(--nx-text-4)' }}>
          {err ?? 'Loading…'}
        </p>
      </Panel>
    )
  }

  const { plan, usage, subscription, plans, stripe_configured } = state
  const internal = plan.key === 'internal'
  const sellable = plans.filter((p) => p.selfServe)

  return (
    <Panel title="Billing" titleAccent="cyan">
      {err && (
        <div style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-red, #ef4444)', marginBottom: 10 }}>
          {err}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontFamily: 'var(--nx-mono)', fontSize: 14, color: 'var(--nx-text-1)', letterSpacing: '0.08em' }}>
          {plan.label.toUpperCase()}
        </span>
        {subscription && <Badge label={subscription.status} variant={subscription.status === 'active' ? 'active' : 'pending'} />}
        {internal && <Badge label="not billed" variant="core" />}
      </div>

      {internal ? (
        <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)', lineHeight: 1.7, margin: '0 0 4px' }}>
          This workspace is exempt from metering — no quota is applied and nothing is counted.
          Granted server-side via <code>BILLING_EXEMPT_WORKSPACES</code>; it cannot be set from the app.
        </p>
      ) : (
        <>
          <UsageBar label="Posts" used={usage.used.generations} limit={usage.limits.generations} />
          <UsageBar label="DemoForge videos" used={usage.used.videos} limit={usage.limits.videos} />
          <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, color: 'var(--nx-text-4)', marginTop: -4, marginBottom: 16 }}>
            Period from {usage.period_start}. Counted when a post is generated.
          </p>
        </>
      )}

      {!internal && stripe_configured && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {(['monthly', 'annual'] as const).map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setInterval(i)}
                className={`nx-btn nx-btn--sm${interval === i ? ' nx-btn--primary' : ''}`}
                style={{ fontFamily: 'var(--nx-mono)', fontSize: 9, letterSpacing: '0.12em', padding: '4px 10px', opacity: interval === i ? 1 : 0.6 }}
              >
                {i === 'annual' ? 'ANNUAL — 2 MONTHS FREE' : 'MONTHLY'}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            {sellable.map((p) => (
              <PlanCard
                key={p.key}
                plan={p}
                current={p.key === plan.key}
                interval={interval}
                busy={busy}
                onChoose={() => void choose(p.key)}
              />
            ))}
          </div>

          {subscription && (
            <button
              type="button"
              onClick={() => void manage()}
              disabled={busy}
              className="nx-btn nx-btn--sm"
              style={{ marginTop: 12, fontFamily: 'var(--nx-mono)', fontSize: 10, letterSpacing: '0.12em', opacity: busy ? 0.6 : 1 }}
            >
              ⚙ MANAGE SUBSCRIPTION
            </button>
          )}
        </>
      )}

      {!internal && !stripe_configured && (
        <p style={{ fontFamily: 'var(--nx-mono)', fontSize: 10, color: 'var(--nx-text-4)', lineHeight: 1.7 }}>
          Billing is not configured on this deployment. Set <code>STRIPE_SECRET_KEY</code> and the
          <code> STRIPE_PRICE_*</code> ids to enable checkout.
        </p>
      )}
    </Panel>
  )
}
