import { useState, useEffect, type CSSProperties } from 'react'
import { vantageApi } from '../api/vantage'
import { Panel, Button, Badge } from '../ds'

interface Campaign {
  id: string
  name: string
  description?: string
  status: 'draft' | 'active' | 'completed' | 'paused'
  start_date: string
  end_date: string
  cadence_config: Record<string, any>
  messaging_pillars: any[]
  channel_mix: Record<string, any>
  kpi_targets: Record<string, number>
  default_brand_id?: string | null
  default_demoforge_template_id?: string | null
  destination_url?: string | null
  created_at: string
  updated_at: string
}

interface DemoForgeTemplateMeta {
  id: string
  name: string
  format: string
}

const VISUAL_TYPES = ['demo_video', 'product_still', 'social_graphic', 'none'] as const
const BRAND_OPTIONS = ['shift', 'keystone', 'scripta', 'demoforge', 'crucible', 'vantage'] as const
/** Matches campaign API CAMPAIGN_CHANNELS (email excluded). */
const CAMPAIGN_CHANNELS = [
  { id: 'x', label: 'X' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'threads', label: 'Threads' },
  { id: 'bluesky', label: 'Bluesky' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
] as const

const DEFAULT_CHANNEL_MIX: Record<string, { daily: number }> = {
  x: { daily: 2 },
  linkedin: { daily: 1 },
  reddit: { daily: 1 },
  threads: { daily: 1 },
  bluesky: { daily: 1 },
  tiktok: { daily: 1 },
  instagram: { daily: 1 },
  facebook: { daily: 1 },
}

interface TimelineDay {
  id: string
  campaign_id: string
  day_number: number
  date_scheduled: string
  messaging_pillar_id?: string
  content_type: string
  primary_channel: string
  secondary_channels: string[]
  content_ideas: any[]
  published_pieces: any[]
}

interface KPIMetrics {
  id: string
  campaign_id: string
  date_tracked: string
  impressions: number
  clicks: number
  engagements: number
  shares: number
  follows: number
  virality_score: number
}

type ViewState = 'list' | 'create' | 'details'

const STATUS_VARIANTS: Record<string, 'active' | 'pending' | 'critical' | 'new' | 'core' | 'soon' | 'default'> = {
  draft: 'pending',
  active: 'active',
  completed: 'core',
  paused: 'new',
}

/** Nexus Design CampaignsView status chrome (mapped to product statuses). */
const STATUS_HUD: Record<string, { label: string; tone: string }> = {
  active: { label: 'AUTOPILOT', tone: 'var(--nx-green, #00E47A)' },
  draft: { label: 'NEEDS REVIEW', tone: 'var(--nx-amber, #EFA020)' },
  paused: { label: 'PAUSED', tone: 'var(--nx-text-2)' },
  completed: { label: 'COMPLETE', tone: 'var(--nx-cyan, #00C4E8)' },
}

type ShiftPackMeta = {
  id: string
  name: string
  description: string
  items: { id: string; title: string; outline: string; visual_type: string }[]
}

const DEFAULT_WEEKS = 3
/** Content days per week. The generator's day count is weeks × periodsPerWeek, so a
 *  value of 1 yields one post per week — not a daily plan. Exposed in the form. */
const DEFAULT_PERIODS_PER_WEEK = 3

/** Initial create-form state. A factory, not a shared object, so resetting after a
 *  create can't hand back a mutated reference. */
function createInitialFormData() {
  const start = new Date()
  const end = new Date(start.getTime() + DEFAULT_WEEKS * 7 * 24 * 60 * 60 * 1000)
  return {
    name: '',
    description: '',
    start_date: start.toISOString().split('T')[0],
    end_date: end.toISOString().split('T')[0],
    cadence_config: { weeks: DEFAULT_WEEKS, periodsPerWeek: DEFAULT_PERIODS_PER_WEEK },
    messaging_pillars: [
      {
        id: '1',
        name: 'Product Launch',
        description: 'Introducing new features',
        tone: 'Professional & Exciting',
        keyMessages: ['New capabilities', 'Customer success'],
        targetAudience: 'Early adopters & decision makers',
      },
    ],
    channel_mix: { ...DEFAULT_CHANNEL_MIX },
    kpi_targets: { impressions: 10000, engagements: 500 },
  }
}

/** Mirrors MAX_TIMELINE_DAYS / timelineDayCount() in apps/api/src/lib/campaigns.ts —
 *  the server is authoritative and enforces this; the form shows the real number before
 *  you generate so the cap can't truncate a plan silently. Keep the two in step. */
const MAX_TIMELINE_DAYS = 60
function timelineDayCount(weeks: number, periodsPerWeek: number): number {
  const w = Math.max(1, Number.isFinite(weeks) ? Math.trunc(weeks) : 1)
  const p = Math.max(1, Number.isFinite(periodsPerWeek) ? Math.trunc(periodsPerWeek) : 1)
  return Math.min(w * p, MAX_TIMELINE_DAYS)
}

export default function CampaignBuilderPage() {
  const [view, setView] = useState<ViewState>('list')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignLoadError, setCampaignLoadError] = useState<string | null>(null)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [timeline, setTimeline] = useState<TimelineDay[]>([])
  const [campaignAssets, setCampaignAssets] = useState<any[]>([])
  const [kpiMetrics, setKpiMetrics] = useState<KPIMetrics[]>([])
  const [formData, setFormData] = useState(createInitialFormData)

  const [busy, setBusy] = useState<string | null>(null)
  const [editingCampaign, setEditingCampaign] = useState(false)
  const [editData, setEditData] = useState<{
    name: string
    description: string
    messaging_pillars: any[]
    channel_mix: Record<string, { daily: number }>
    default_brand_id: string
    default_demoforge_template_id: string
    destination_url: string
  }>({
    name: '',
    description: '',
    messaging_pillars: [],
    channel_mix: { ...DEFAULT_CHANNEL_MIX },
    default_brand_id: 'shift',
    default_demoforge_template_id: '',
    destination_url: '',
  })
  const [launchInfo, setLaunchInfo] = useState<string | null>(null)
  const [templates, setTemplates] = useState<DemoForgeTemplateMeta[]>([])
  const [shiftPacks, setShiftPacks] = useState<ShiftPackMeta[]>([])
  const [selectedPackId, setSelectedPackId] = useState('')

  // Start Date, End Date, and Duration (weeks) used to be three independently-editable
  // fields with no sync between them — a user could set a 3-week end date while leaving
  // Duration at 2, and the timeline generator (which drives day count from
  // cadence_config.weeks, not the date range) would silently produce a 2-day plan under
  // a 3-week-looking date range. End Date is now derived from Start Date + Duration so
  // the two can never drift apart.
  useEffect(() => {
    const start = new Date(`${formData.start_date}T00:00:00Z`)
    if (Number.isNaN(start.getTime())) return
    // Clearing the Duration input yields NaN; adding it produces an Invalid Date whose
    // toISOString() throws and takes the whole form down. Fall back to 1 week.
    const weeks = Number.isFinite(formData.cadence_config.weeks)
      ? Math.max(1, formData.cadence_config.weeks)
      : 1
    start.setUTCDate(start.getUTCDate() + weeks * 7)
    const computedEndDate = start.toISOString().split('T')[0]
    if (computedEndDate !== formData.end_date) {
      setFormData((prev) => ({ ...prev, end_date: computedEndDate }))
    }
  }, [formData.start_date, formData.cadence_config.weeks, formData.end_date])

  useEffect(() => {
    fetchCampaigns()
    void vantageApi.listDemoForgeTemplates()
      .then((res) => setTemplates(res.templates || []))
      .catch(() => setTemplates([
        { id: 'shift-queue-modes', name: 'The Shift — Queue Mode Reel', format: 'tiktok' },
        { id: 'shift-ube-university-demo', name: 'The Shift — UBE University Demo', format: 'linkedin' },
        { id: 'shift-queue-reel', name: 'The Shift — Adaptive Queue Reel', format: 'tiktok' },
      ]))
    void vantageApi.listShiftPacks()
      .then((res) => {
        setShiftPacks(res.packs || [])
        if (res.packs?.[0]) setSelectedPackId(res.packs[0].id)
      })
      .catch(() => setShiftPacks([]))
  }, [])

  const fetchCampaigns = async () => {
    try {
      const data = await vantageApi.listCampaigns()
      setCampaigns(data.campaigns || [])
      setCampaignLoadError(null)
    } catch (err) {
      console.error('Failed to fetch campaigns:', err)
      setCampaignLoadError(err instanceof Error ? err.message : 'The campaign service could not be reached.')
    }
  }

  const fetchCampaignDetails = async (campaignId: string) => {
    try {
      const [campaignData, timelineData, kpiData, assetData] = await Promise.all([
        vantageApi.getCampaign(campaignId),
        vantageApi.getCampaignTimeline(campaignId),
        vantageApi.getCampaignKPI(campaignId),
        vantageApi.listCampaignAssets(campaignId),
      ])
      setSelectedCampaign(campaignData)
      setTimeline(timelineData.timeline || [])
      setKpiMetrics(kpiData.kpi_tracking || [])
      setCampaignAssets(assetData.assets || [])
    } catch (err) {
      console.error('Failed to fetch campaign details:', err)
    }
  }

  const handleSelectCampaign = async (campaign: Campaign) => {
    await fetchCampaignDetails(campaign.id)
    setView('details')
  }

  const toggleChannelMix = (
    mix: Record<string, { daily: number }>,
    channelId: string,
    enabled: boolean,
  ): Record<string, { daily: number }> => {
    const next = { ...mix }
    if (enabled) {
      next[channelId] = { daily: next[channelId]?.daily ?? (channelId === 'x' ? 2 : 1) }
    } else {
      delete next[channelId]
    }
    return next
  }

  const setChannelDaily = (
    mix: Record<string, { daily: number }>,
    channelId: string,
    daily: number,
  ): Record<string, { daily: number }> => ({
    ...mix,
    [channelId]: { daily: Math.max(1, daily || 1) },
  })

  const handleCreateCampaign = async () => {
    if (!formData.name) {
      alert('Campaign name is required')
      return
    }
    if (!Object.keys(formData.channel_mix).length) {
      alert('Select at least one channel')
      return
    }
    try {
      await vantageApi.createCampaign(formData)
      await fetchCampaigns()
      setView('list')
      setFormData(createInitialFormData())
    } catch (err) {
      console.error('Failed to create campaign:', err)
      alert('Failed to create campaign: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  const handleDeleteCampaign = async (id: string) => {
    if (confirm('Are you sure you want to delete this campaign?')) {
      try {
        await vantageApi.deleteCampaign(id)
        setCampaigns(campaigns.filter((c) => c.id !== id))
      } catch (err) {
        console.error('Failed to delete campaign:', err)
        alert('Failed to delete campaign')
      }
    }
  }

  const handleGenerateTimeline = async () => {
    if (!selectedCampaign) return
    if (timeline.length && !confirm('Regenerate the timeline? This replaces the current plan.')) return
    setBusy('generate')
    try {
      const res = await vantageApi.generateCampaignTimeline(selectedCampaign.id)
      setTimeline(res.timeline || [])
    } catch (err) {
      alert('Failed to generate timeline: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setBusy(null)
    }
  }

  const handleLaunch = async () => {
    if (!selectedCampaign) return
    if (!timeline.length) {
      alert('Generate a timeline before launching.')
      return
    }
    const channelEstimate = timeline.reduce((n, day) => {
      const secs = Array.isArray(day.secondary_channels) ? day.secondary_channels.length : 0
      return n + 1 + secs
    }, 0)
    if (!confirm(
      `Launch autopilot for ${timeline.length} day(s) (~${channelEstimate} pieces)? ` +
      'Ilita audits each piece; media-ready pieces auto-queue for cadence publish.',
    )) return
    setBusy('launch')
    setLaunchInfo(null)
    try {
      const res = await vantageApi.launchCampaign(selectedCampaign.id)
      const failDetail = Array.isArray(res.failures) && res.failures.length
        ? `\nFailures: ${res.failures.slice(0, 8).map((f: { day_number?: number; channel?: string; error?: string }) =>
            `day ${(f.day_number ?? 0) + 1}${f.channel ? '/' + f.channel : ''}: ${f.error ?? 'error'}`,
          ).join('; ')}${res.failures.length > 8 ? '…' : ''}`
        : ''
      setLaunchInfo(
        `Autopilot launched ${res.launched} piece(s)${res.failed ? `, ${res.failed} failed` : ''}. ` +
        `Text-only pieces are queued; DemoForge media auto-queues when ready.${failDetail}`,
      )
      await fetchCampaignDetails(selectedCampaign.id)
    } catch (err) {
      alert('Failed to launch campaign: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setBusy(null)
    }
  }

  const updateDayLocal = (dayNumber: number, patch: Partial<TimelineDay>) =>
    setTimeline((prev) => prev.map((d) => (d.day_number === dayNumber ? { ...d, ...patch } : d)))

  const handleSaveDay = async (day: TimelineDay) => {
    if (!selectedCampaign) return
    setBusy(`day:${day.day_number}`)
    try {
      await vantageApi.updateCampaignTimelineDay(selectedCampaign.id, day.day_number, {
        primary_channel: day.primary_channel,
        secondary_channels: day.secondary_channels ?? [],
        content_type: day.content_type,
        messaging_pillar_id: day.messaging_pillar_id ?? null,
        content_ideas: day.content_ideas,
      })
    } catch (err) {
      alert('Failed to save day: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setBusy(null)
    }
  }

  const handleAddDay = async () => {
    if (!selectedCampaign) return
    setBusy('add-day')
    try {
      const nextNum = timeline.length ? Math.max(...timeline.map((d) => d.day_number)) + 1 : 0
      const anchor = timeline.length ? timeline[timeline.length - 1].date_scheduled : selectedCampaign.start_date
      const next = new Date(`${anchor}T00:00:00Z`)
      next.setUTCDate(next.getUTCDate() + (timeline.length ? 1 : 0))
      const date = next.toISOString().slice(0, 10)
      await vantageApi.addCampaignTimelineDays(selectedCampaign.id, {
        day_number: nextNum,
        date_scheduled: date,
        primary_channel: 'x',
        content_type: 'mixed',
        secondary_channels: [],
        content_ideas: [{ id: crypto.randomUUID(), title: '', outline: '' }],
      })
      const res = await vantageApi.getCampaignTimeline(selectedCampaign.id)
      setTimeline(res.timeline || [])
    } catch (err) {
      alert('Failed to add day: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setBusy(null)
    }
  }

  const handleRemoveDay = async (day: TimelineDay) => {
    if (!selectedCampaign) return
    if (!confirm(`Remove day ${day.day_number + 1}?`)) return
    setBusy(`day:${day.day_number}`)
    try {
      await vantageApi.deleteCampaignTimelineDay(selectedCampaign.id, day.day_number)
      setTimeline((prev) => prev.filter((d) => d.day_number !== day.day_number))
    } catch (err) {
      alert('Failed to remove day: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setBusy(null)
    }
  }

  const pendingMediaCount = timeline.reduce((n, day) => {
    const pubs = Array.isArray(day.published_pieces) ? day.published_pieces : []
    return n + pubs.filter((p) => p?.media_status === 'pending' || p?.media_status === 'failed').length
  }, 0)

  const handleAddPack = async () => {
    if (!selectedCampaign || !selectedPackId) return
    setBusy('pack')
    try {
      const res = await vantageApi.addCampaignPack(selectedCampaign.id, selectedPackId)
      setLaunchInfo(`Added ${res.added} pack day(s) to timeline.`)
      await fetchCampaignDetails(selectedCampaign.id)
    } catch (err) {
      alert('Failed to add pack: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setBusy(null)
    }
  }

  const handleRefillEvergreen = async () => {
    if (!selectedCampaign) return
    setBusy('evergreen')
    try {
      const res = await vantageApi.refillCampaignEvergreen(selectedCampaign.id)
      setLaunchInfo(res.message || `Refilled ${res.added} evergreen day(s).`)
      if (res.added) await fetchCampaignDetails(selectedCampaign.id)
    } catch (err) {
      alert('Failed to refill evergreen: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setBusy(null)
    }
  }

  const handleGenerateDay = async (day: TimelineDay) => {
    if (!selectedCampaign) return
    setBusy(`gen-day:${day.day_number}`)
    setLaunchInfo(null)
    try {
      const res = await vantageApi.launchCampaign(selectedCampaign.id, [day.day_number])
      if (res.failed) {
        alert(`Generation failed: ${res.failures[0]?.error ?? 'Unknown error'}`)
      } else {
        setLaunchInfo(`Generated ${res.launched} piece for day ${day.day_number + 1} (auto-queues when media-ready).`)
      }
      await fetchCampaignDetails(selectedCampaign.id)
    } catch (err) {
      alert('Failed to generate content: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setBusy(null)
    }
  }

  const startEditCampaign = () => {
    if (!selectedCampaign) return
    const mix = selectedCampaign.channel_mix && typeof selectedCampaign.channel_mix === 'object'
      ? Object.fromEntries(
          Object.entries(selectedCampaign.channel_mix)
            .filter(([, v]) => v && typeof (v as any).daily === 'number')
            .map(([k, v]) => [k, { daily: (v as { daily: number }).daily }]),
        )
      : { ...DEFAULT_CHANNEL_MIX }
    setEditData({
      name: selectedCampaign.name,
      description: selectedCampaign.description || '',
      messaging_pillars: JSON.parse(JSON.stringify(selectedCampaign.messaging_pillars || [])),
      channel_mix: mix,
      default_brand_id: selectedCampaign.default_brand_id || 'shift',
      default_demoforge_template_id: selectedCampaign.default_demoforge_template_id || '',
      destination_url: selectedCampaign.destination_url || '',
    })
    setEditingCampaign(true)
  }

  const handleSaveCampaign = async () => {
    if (!selectedCampaign) return
    if (!Object.keys(editData.channel_mix).length) {
      alert('Select at least one channel')
      return
    }
    if (editData.destination_url.trim() && !/^https?:\/\//i.test(editData.destination_url.trim())) {
      alert('Destination URL must start with http:// or https://')
      return
    }
    setBusy('campaign')
    try {
      const updated = await vantageApi.updateCampaign(selectedCampaign.id, {
        name: editData.name,
        description: editData.description,
        messaging_pillars: editData.messaging_pillars,
        channel_mix: editData.channel_mix,
        default_brand_id: editData.default_brand_id || 'shift',
        default_demoforge_template_id: editData.default_demoforge_template_id || null,
        destination_url: editData.destination_url.trim() || null,
      })
      setSelectedCampaign(updated)
      setEditingCampaign(false)
    } catch (err) {
      alert('Failed to save campaign: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setBusy(null)
    }
  }

  const renderChannelMixEditor = (
    mix: Record<string, { daily: number }>,
    onChange: (next: Record<string, { daily: number }>) => void,
  ) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <label style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block' }}>
        Channel mix
      </label>
      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--nx-text-4)' }}>
        Enabled channels are all cross-posted on every timeline day (primary + secondaries).
        Launch creates one piece per enabled channel per day — regenerate the timeline after changing this mix.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem' }}>
        {CAMPAIGN_CHANNELS.map((ch) => {
          const enabled = ch.id in mix
          return (
            <label
              key={ch.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                border: '1px solid var(--nx-border)',
                borderRadius: '0.25rem',
                padding: '0.5rem 0.65rem',
                fontSize: '0.85rem',
              }}
            >
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => onChange(toggleChannelMix(mix, ch.id, e.target.checked))}
              />
              <span style={{ flex: 1 }}>{ch.label}</span>
              <input
                type="number"
                min={1}
                disabled={!enabled}
                value={enabled ? mix[ch.id].daily : ''}
                onChange={(e) => onChange(setChannelDaily(mix, ch.id, parseInt(e.target.value, 10)))}
                title="Daily target"
                style={{
                  width: '3rem',
                  padding: '0.25rem',
                  border: '1px solid var(--nx-border)',
                  borderRadius: '0.25rem',
                  fontFamily: 'inherit',
                  background: enabled ? 'transparent' : 'var(--nx-bg-2, transparent)',
                  color: 'inherit',
                  opacity: enabled ? 1 : 0.4,
                }}
              />
            </label>
          )
        })}
      </div>
    </div>
  )

  const addPillar = () =>
    setEditData((prev) => ({
      ...prev,
      messaging_pillars: [
        ...prev.messaging_pillars,
        {
          id: crypto.randomUUID(),
          name: 'New Pillar',
          description: '',
          tone: 'Professional',
          keyMessages: [],
          targetAudience: '',
        },
      ],
    }))

  const updatePillar = (idx: number, patch: Record<string, any>) =>
    setEditData((prev) => ({
      ...prev,
      messaging_pillars: prev.messaging_pillars.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    }))

  const removePillar = (idx: number) =>
    setEditData((prev) => ({
      ...prev,
      messaging_pillars: prev.messaging_pillars.filter((_, i) => i !== idx),
    }))

  if (view === 'list') {
    return (
      <div className="v-page" style={{ padding: 20, maxWidth: 1200, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <div className="nx-mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--nx-text-muted, var(--nx-text-4))', marginBottom: 6 }}>
              CAMPAIGNS · OBJECTIVES
            </div>
            <h1 className="nx-display" style={{ margin: 0, fontSize: 34, letterSpacing: '0.03em', lineHeight: 0.95 }}>
              CAMPAIGN PORTFOLIO
            </h1>
            <p className="nx-mono" style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--nx-text-2)', maxWidth: 520, lineHeight: 1.5 }}>
              Each campaign carries an objective. Autopilot launches pieces through audit → media → cadence.
            </p>
          </div>
          <button type="button" className="nx-btn nx-btn--primary" style={{ padding: '11px 18px' }} onClick={() => setView('create')}>
            + NEW CAMPAIGN
          </button>
        </div>

        {campaignLoadError ? (
          <Panel title="Campaigns Unavailable">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <span>Existing campaigns could not be loaded. {campaignLoadError}</span>
              <button type="button" className="nx-btn nx-btn--ghost" onClick={() => void fetchCampaigns()}>
                RETRY
              </button>
            </div>
          </Panel>
        ) : campaigns.length === 0 ? (
          <Panel title="No Campaigns Yet">
            Create your first campaign to get started with multi-week social media planning.
          </Panel>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {campaigns.map((campaign) => {
              const hud = STATUS_HUD[campaign.status] || STATUS_HUD.draft
              const channelCount = campaign.channel_mix ? Object.keys(campaign.channel_mix).length : 0
              return (
                <button
                  key={campaign.id}
                  type="button"
                  onClick={() => void handleSelectCampaign(campaign)}
                  className="nx-panel"
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    padding: 14,
                    width: '100%',
                    display: 'block',
                    border: '1px solid var(--nx-border)',
                    background: 'var(--nx-surface, transparent)',
                    color: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: hud.tone, boxShadow: `0 0 7px ${hud.tone}` }} />
                      <span className="nx-mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: hud.tone }}>{hud.label}</span>
                    </span>
                    <span className="nx-chip" style={{ fontSize: 8.5, padding: '2px 6px' }}>{channelCount} CH</span>
                  </div>
                  <div className="nx-display" style={{ fontSize: 19, letterSpacing: '0.03em', lineHeight: 1 }}>{campaign.name}</div>
                  {campaign.description && (
                    <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--nx-text-3)', lineHeight: 1.4 }}>
                      {campaign.description.slice(0, 120)}{campaign.description.length > 120 ? '…' : ''}
                    </p>
                  )}
                  <div className="nx-mono" style={{ marginTop: 12, fontSize: 10, color: 'var(--nx-text-4)' }}>
                    {campaign.start_date} → {campaign.end_date}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="nx-btn nx-btn--ghost nx-btn--sm" onClick={() => void handleSelectCampaign(campaign)}>OPEN</button>
                    <button type="button" className="nx-btn nx-btn--ghost nx-btn--sm" onClick={() => void handleDeleteCampaign(campaign.id)}>DELETE</button>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  if (view === 'create') {
    return (
      <div style={{ padding: '2rem', maxWidth: '800px' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '2rem' }}>Create New Campaign</h1>

        <Panel title="Campaign Details">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div>
              <label style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>Campaign Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Q2 Product Launch"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid var(--nx-border)',
                  borderRadius: '0.25rem',
                  fontFamily: 'inherit',
                  marginTop: '0.5rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Campaign objectives and strategy..."
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid var(--nx-border)',
                  borderRadius: '0.25rem',
                  fontFamily: 'inherit',
                  marginTop: '0.5rem',
                  minHeight: '120px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>Start Date</label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid var(--nx-border)',
                    borderRadius: '0.25rem',
                    fontFamily: 'inherit',
                    marginTop: '0.5rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>End Date</label>
                <input
                  type="date"
                  value={formData.end_date}
                  readOnly
                  disabled
                  title="Derived from Start Date + Duration (weeks) below — change Duration to adjust this."
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid var(--nx-border)',
                    borderRadius: '0.25rem',
                    fontFamily: 'inherit',
                    marginTop: '0.5rem',
                    boxSizing: 'border-box',
                    opacity: 0.7,
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>Duration (weeks)</label>
                <input
                  type="number"
                  value={Number.isFinite(formData.cadence_config.weeks) ? formData.cadence_config.weeks : ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      cadence_config: { ...formData.cadence_config, weeks: parseInt(e.target.value) },
                    })
                  }
                  min="1"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid var(--nx-border)',
                    borderRadius: '0.25rem',
                    fontFamily: 'inherit',
                    marginTop: '0.5rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>Posts per week</label>
                <input
                  type="number"
                  value={Number.isFinite(formData.cadence_config.periodsPerWeek) ? formData.cadence_config.periodsPerWeek : ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      cadence_config: {
                        ...formData.cadence_config,
                        periodsPerWeek: parseInt(e.target.value),
                      },
                    })
                  }
                  min="1"
                  max="7"
                  title="7 = one content day per day. The timeline generator produces weeks × posts-per-week days."
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid var(--nx-border)',
                    borderRadius: '0.25rem',
                    fontFamily: 'inherit',
                    marginTop: '0.5rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <p style={{ fontSize: '0.8125rem', color: 'var(--nx-text-2)', marginTop: '-0.5rem' }}>
              Timeline will generate{' '}
              <strong style={{ color: 'var(--nx-cyan, #00C4E8)' }}>
                {timelineDayCount(formData.cadence_config.weeks, formData.cadence_config.periodsPerWeek)} content days
              </strong>{' '}
              spread evenly across the date range. Launch creates one piece per selected channel per day
              {Object.keys(formData.channel_mix).length > 0 && (
                <>
                  {' '}(
                  {timelineDayCount(formData.cadence_config.weeks, formData.cadence_config.periodsPerWeek) *
                    Object.keys(formData.channel_mix).length}{' '}
                  pieces total)
                </>
              )}
              .
              {timelineDayCount(formData.cadence_config.weeks, formData.cadence_config.periodsPerWeek) <
                Math.max(1, formData.cadence_config.weeks || 1) *
                  Math.max(1, formData.cadence_config.periodsPerWeek || 1) && (
                <span style={{ color: 'var(--nx-amber, #EFA020)' }}>
                  {' '}Capped at {MAX_TIMELINE_DAYS} days — reduce duration or posts per week to plan the full run.
                </span>
              )}
            </p>

            {renderChannelMixEditor(formData.channel_mix, (channel_mix) =>
              setFormData({ ...formData, channel_mix }),
            )}

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <Button
                label="Cancel"
                variant="secondary"
                onClick={() => setView('list')}
              />
              <Button
                label="Create Campaign"
                variant="primary"
                onClick={handleCreateCampaign}
                disabled={!formData.name || !Object.keys(formData.channel_mix).length}
              />
            </div>
          </div>
        </Panel>
      </div>
    )
  }

  if (view === 'details' && selectedCampaign) {
    // Prefer rolled-up `all` rows so per-channel sources aren't double-counted
    const kpiRows = kpiMetrics.some((m) => (m as { source?: string }).source === 'all')
      ? kpiMetrics.filter((m) => (m as { source?: string }).source === 'all')
      : kpiMetrics
    const kpiSummary = kpiRows.reduce(
      (acc, metric) => ({
        impressions: acc.impressions + (metric.impressions || 0),
        engagements: acc.engagements + (metric.engagements || 0),
        follows: acc.follows + (metric.follows || 0),
      }),
      { impressions: 0, engagements: 0, follows: 0 }
    )

    const engagementRate = kpiSummary.impressions
      ? ((kpiSummary.engagements / kpiSummary.impressions) * 100).toFixed(2)
      : '0'

    const inputStyle: CSSProperties = {
      width: '100%',
      padding: '0.5rem',
      border: '1px solid var(--nx-border)',
      borderRadius: '0.25rem',
      fontFamily: 'inherit',
      boxSizing: 'border-box',
      background: 'transparent',
      color: 'inherit',
    }
    const labelStyle: CSSProperties = {
      fontSize: '0.75rem',
      fontWeight: 600,
      display: 'block',
      marginBottom: '0.25rem',
      color: 'var(--nx-text-3)',
    }
    const pillars = (selectedCampaign.messaging_pillars || []) as any[]

    const hud = STATUS_HUD[selectedCampaign.status] || STATUS_HUD.draft
    const targets = selectedCampaign.kpi_targets || {}
    const impressionProgress = targets.impressions
      ? Math.min(100, Math.round((kpiSummary.impressions / targets.impressions) * 100))
      : 0

    return (
      <div className="v-page" style={{ padding: 20, maxWidth: 1200, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button type="button" className="nx-btn nx-btn--ghost" onClick={() => setView('list')}>← PORTFOLIO</button>
          <div style={{ display: 'flex', gap: 8 }}>
            {!editingCampaign && (
              <button type="button" className="nx-btn" style={{ fontSize: 10, padding: '8px 12px' }} onClick={startEditCampaign}>EDIT</button>
            )}
            <button
              type="button"
              className="nx-btn nx-btn--primary"
              style={{ fontSize: 10, padding: '8px 12px' }}
              onClick={() => void handleLaunch()}
              disabled={busy !== null || timeline.length === 0}
            >
              {busy === 'launch' ? 'LAUNCHING…' : '▶ ENGAGE AUTOPILOT'}
            </button>
          </div>
        </div>

        <div className="nx-panel" style={{ padding: 16, border: '1px solid var(--nx-border)', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -40, right: -30, width: 220, height: 220, background: `radial-gradient(circle, ${hud.tone}22, transparent 70%)`, pointerEvents: 'none' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9, position: 'relative' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: hud.tone, boxShadow: `0 0 8px ${hud.tone}` }} />
            <span className="nx-mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: hud.tone }}>{hud.label}</span>
            <Badge label={selectedCampaign.status} variant={STATUS_VARIANTS[selectedCampaign.status] || 'default'} />
          </div>
          <h1 className="nx-display" style={{ margin: 0, fontSize: 34, letterSpacing: '0.03em', lineHeight: 0.95, position: 'relative' }}>
            {selectedCampaign.name}
          </h1>
          <div className="nx-mono" style={{ marginTop: 10, fontSize: 11, color: 'var(--nx-text-3)' }}>
            {selectedCampaign.start_date} → {selectedCampaign.end_date}
            {pendingMediaCount > 0 ? ` · ${pendingMediaCount} pending media` : ''}
          </div>
        </div>

        {launchInfo && (
          <Panel title="Reactor Note">{launchInfo}</Panel>
        )}

        {editingCampaign ? (
          <Panel title="Edit Campaign">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>Campaign Name</label>
                <input
                  style={inputStyle}
                  value={editData.name}
                  onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                />
              </div>
              <div>
                <label style={labelStyle}>Description</label>
                <textarea
                  style={{ ...inputStyle, minHeight: '80px' }}
                  value={editData.description}
                  onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={labelStyle}>Default brand</label>
                  <select
                    style={inputStyle}
                    value={editData.default_brand_id}
                    onChange={(e) => setEditData({ ...editData, default_brand_id: e.target.value })}
                  >
                    {BRAND_OPTIONS.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Default DemoForge template</label>
                  <select
                    style={inputStyle}
                    value={editData.default_demoforge_template_id}
                    onChange={(e) => setEditData({ ...editData, default_demoforge_template_id: e.target.value })}
                  >
                    <option value="">— channel default (Shift) —</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} ({t.format})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={labelStyle}>Destination URL</label>
                <input
                  style={inputStyle}
                  type="url"
                  placeholder="— use workspace default (Settings → Product profile) —"
                  value={editData.destination_url}
                  onChange={(e) => setEditData({ ...editData, destination_url: e.target.value })}
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--vg-text-dim, #888)', marginTop: '0.25rem' }}>
                  Every piece this campaign launches links here instead of the workspace's default product
                  URL — use this to promote a different NEXUS product from this campaign. Appended
                  automatically to inline-link channels (X, LinkedIn, Reddit, Threads, Bluesky, Facebook,
                  Email); TikTok and Instagram require a bio link instead, since captions aren't clickable.
                </p>
              </div>

              {renderChannelMixEditor(editData.channel_mix, (channel_mix) =>
                setEditData({ ...editData, channel_mix }),
              )}

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>Messaging Pillars</label>
                  <Button label="+ Add Pillar" variant="secondary" onClick={addPillar} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {editData.messaging_pillars.map((p, idx) => (
                    <div key={p.id ?? idx} style={{ border: '1px solid var(--nx-border)', borderRadius: '0.25rem', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                        <input style={inputStyle} placeholder="Name" value={p.name ?? ''} onChange={(e) => updatePillar(idx, { name: e.target.value })} />
                        <input style={inputStyle} placeholder="Tone" value={p.tone ?? ''} onChange={(e) => updatePillar(idx, { tone: e.target.value })} />
                      </div>
                      <input style={inputStyle} placeholder="Description" value={p.description ?? ''} onChange={(e) => updatePillar(idx, { description: e.target.value })} />
                      <input style={inputStyle} placeholder="Target audience" value={p.targetAudience ?? ''} onChange={(e) => updatePillar(idx, { targetAudience: e.target.value })} />
                      <input
                        style={inputStyle}
                        placeholder="Key messages (comma-separated)"
                        value={Array.isArray(p.keyMessages) ? p.keyMessages.join(', ') : ''}
                        onChange={(e) => updatePillar(idx, { keyMessages: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                      />
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Button label="Remove" variant="secondary" onClick={() => removePillar(idx)} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <Button label="Cancel" variant="secondary" onClick={() => setEditingCampaign(false)} />
                <Button label={busy === 'campaign' ? 'Saving…' : 'Save'} variant="primary" onClick={handleSaveCampaign} disabled={busy !== null} />
              </div>
            </div>
          </Panel>
        ) : (
          selectedCampaign.description && (
            <Panel title="Overview">
              {selectedCampaign.description}
            </Panel>
          )
        )}

        <div>
          <div className="nx-mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--nx-text-4)', marginBottom: 10 }}>KPI BAND · LIVE</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            {[
              { label: 'IMPRESSIONS', value: kpiSummary.impressions.toLocaleString(), sub: targets.impressions ? `${impressionProgress}% of target` : 'no target' },
              { label: 'ENGAGEMENTS', value: kpiSummary.engagements.toLocaleString(), sub: targets.engagements ? `target ${targets.engagements}` : '—' },
              { label: 'ENG RATE', value: `${engagementRate}%`, sub: 'of impressions' },
              { label: 'FOLLOWS', value: kpiSummary.follows.toLocaleString(), sub: targets.follows ? `target ${targets.follows}` : '—' },
            ].map((t) => (
              <div key={t.label} className="nx-tile" style={{ padding: 12, border: '1px solid var(--nx-border)', background: 'var(--nx-surface, transparent)' }}>
                <div className="nx-label" style={{ fontSize: 9 }}>{t.label}</div>
                <div className="nx-display" style={{ fontSize: 26, marginTop: 5, letterSpacing: '0.03em' }}>{t.value}</div>
                <div className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-4)', marginTop: 6 }}>{t.sub}</div>
              </div>
            ))}
          </div>
        </div>

        <Panel title="Creation Studio Assets">
          {campaignAssets.length === 0 ? (
            <p className="nx-mono" style={{ margin: 0, fontSize: 11, color: 'var(--nx-text-4)' }}>
              No assets attached yet. Use Creation Studio’s guided workflow to add visuals, GIFs, videos, and soundtrack projects.
            </p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {campaignAssets.map((asset) => (
                <div key={asset.id} style={{ minWidth: 160, padding: 10, border: '1px solid var(--nx-border)', borderRadius: 4 }}>
                  <div className="nx-label" style={{ fontSize: 9 }}>{String(asset.asset_type).replace('_', ' ')}</div>
                  <div style={{ fontSize: 12, marginTop: 5 }}>{asset.title}</div>
                  {asset.metadata?.channel && <div className="nx-mono" style={{ fontSize: 9, color: 'var(--nx-text-4)', marginTop: 5 }}>{String(asset.metadata.channel).toUpperCase()}</div>}
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Shift Packs · Evergreen · Calendar">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <select
              className="vg-input"
              style={{ minWidth: 220, fontSize: 12 }}
              value={selectedPackId}
              onChange={(e) => setSelectedPackId(e.target.value)}
            >
              {shiftPacks.length === 0 && <option value="">No packs loaded</option>}
              {shiftPacks.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.items.length})</option>
              ))}
            </select>
            <button type="button" className="nx-btn nx-btn--secondary nx-btn--sm" disabled={busy !== null || !selectedPackId} onClick={() => void handleAddPack()}>
              {busy === 'pack' ? '…' : 'Add Pack Days'}
            </button>
            <button type="button" className="nx-btn nx-btn--ghost nx-btn--sm" disabled={busy !== null} onClick={() => void handleRefillEvergreen()}>
              {busy === 'evergreen' ? '…' : 'Refill Evergreen'}
            </button>
            <a
              href={`/calendar?campaign_id=${selectedCampaign.id}`}
              className="nx-btn nx-btn--ghost nx-btn--sm"
              style={{ textDecoration: 'none' }}
            >
              Open Calendar
            </a>
            {pendingMediaCount > 0 && (
              <span className="nx-mono" style={{ fontSize: 10, color: 'var(--nx-amber)' }}>
                {pendingMediaCount} piece(s) waiting on media
              </span>
            )}
          </div>
          {selectedPackId && shiftPacks.find((p) => p.id === selectedPackId)?.description && (
            <p className="nx-mono" style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--nx-text-3)' }}>
              {shiftPacks.find((p) => p.id === selectedPackId)?.description}
            </p>
          )}
        </Panel>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 className="nx-display" style={{ fontSize: 22, margin: 0, letterSpacing: '0.04em' }}>
              TIMELINE · {timeline.length} DAYS
            </h2>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {timeline.length > 0 && (
                <Button
                  label={busy === 'add-day' ? 'Adding…' : '+ Add Day'}
                  variant="secondary"
                  onClick={handleAddDay}
                  disabled={busy !== null}
                />
              )}
              <Button
                label={busy === 'generate' ? 'Generating…' : timeline.length ? 'Regenerate (AI)' : 'Generate Timeline (AI)'}
                variant={timeline.length ? 'secondary' : 'primary'}
                onClick={handleGenerateTimeline}
                disabled={busy !== null}
              />
            </div>
          </div>
          {timeline.length === 0 ? (
            <Panel title="No Timeline Yet">
              Click <strong>Generate Timeline (AI)</strong> to lay out your full content plan automatically, then review, tweak, and launch.
            </Panel>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {timeline.map((day) => {
                const idea = (day.content_ideas?.[0] as any) || { title: '', outline: '' }
                const publishedCount = Array.isArray(day.published_pieces) ? day.published_pieces.length : 0
                return (
                  <Panel
                    key={day.id || day.day_number}
                    title={`Day ${day.day_number + 1} — ${day.date_scheduled}`}
                    titleAccent={
                      day.primary_channel === 'x' ? 'cyan'
                        : day.primary_channel === 'linkedin' ? 'green'
                          : day.primary_channel === 'tiktok' || day.primary_channel === 'instagram' ? 'red'
                            : 'amber'
                    }
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                        <div>
                          <label style={labelStyle}>Primary channel</label>
                          <select
                            style={inputStyle}
                            value={day.primary_channel}
                            onChange={(e) => {
                              const primary_channel = e.target.value
                              const secondary_channels = (day.secondary_channels || []).filter(
                                (ch) => ch !== primary_channel,
                              )
                              updateDayLocal(day.day_number, { primary_channel, secondary_channels })
                            }}
                          >
                            {CAMPAIGN_CHANNELS.map((ch) => (
                              <option key={ch.id} value={ch.id}>{ch.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={labelStyle}>Content Type</label>
                          <select
                            style={inputStyle}
                            value={day.content_type}
                            onChange={(e) => updateDayLocal(day.day_number, { content_type: e.target.value })}
                          >
                            {['promotional', 'educational', 'engagement', 'behind_the_scenes', 'mixed'].map((t) => (
                              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={labelStyle}>Pillar</label>
                          <select
                            style={inputStyle}
                            value={day.messaging_pillar_id ?? ''}
                            onChange={(e) => updateDayLocal(day.day_number, { messaging_pillar_id: e.target.value || undefined })}
                          >
                            <option value="">— none —</option>
                            {pillars.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label style={labelStyle}>Secondary channels (cross-post)</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                          {CAMPAIGN_CHANNELS.filter((ch) => ch.id !== day.primary_channel).map((ch) => {
                            const checked = (day.secondary_channels || []).includes(ch.id)
                            return (
                              <label
                                key={ch.id}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const secondary_channels = e.target.checked
                                      ? [...(day.secondary_channels || []), ch.id]
                                      : (day.secondary_channels || []).filter((id) => id !== ch.id)
                                    updateDayLocal(day.day_number, { secondary_channels })
                                  }}
                                />
                                {ch.label}
                              </label>
                            )
                          })}
                        </div>
                      </div>
                      <div>
                        <label style={labelStyle}>Content Idea</label>
                        <input
                          style={inputStyle}
                          placeholder="Title"
                          value={idea.title ?? ''}
                          onChange={(e) => updateDayLocal(day.day_number, { content_ideas: [{ ...idea, title: e.target.value }] })}
                        />
                      </div>
                      <textarea
                        style={{ ...inputStyle, minHeight: '60px' }}
                        placeholder="Outline / brief"
                        value={idea.outline ?? ''}
                        onChange={(e) => updateDayLocal(day.day_number, { content_ideas: [{ ...idea, outline: e.target.value }] })}
                      />
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                        <div>
                          <label style={labelStyle}>Visual</label>
                          <select
                            style={inputStyle}
                            value={idea.visual_type ?? 'demo_video'}
                            onChange={(e) => updateDayLocal(day.day_number, {
                              content_ideas: [{ ...idea, visual_type: e.target.value }],
                            })}
                          >
                            {VISUAL_TYPES.map((v) => (
                              <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={labelStyle}>Template</label>
                          <select
                            style={inputStyle}
                            value={idea.demoforge_template_id ?? ''}
                            onChange={(e) => updateDayLocal(day.day_number, {
                              content_ideas: [{ ...idea, demoforge_template_id: e.target.value || undefined }],
                            })}
                            disabled={idea.visual_type === 'none' || idea.visual_type === 'social_graphic'}
                          >
                            <option value="">
                              {idea.visual_type === 'product_still'
                                ? '— product stills (Sweep hero) —'
                                : '— channel default —'}
                            </option>
                            {templates.map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={labelStyle}>Brand</label>
                          <select
                            style={inputStyle}
                            value={idea.brand_id ?? selectedCampaign?.default_brand_id ?? 'shift'}
                            onChange={(e) => updateDayLocal(day.day_number, {
                              content_ideas: [{ ...idea, brand_id: e.target.value }],
                            })}
                          >
                            {BRAND_OPTIONS.map((b) => (
                              <option key={b} value={b}>{b}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--nx-text-4)' }}>
                          {publishedCount > 0
                            ? `${publishedCount} piece(s) generated${day.published_pieces?.[0]?.media_status ? ` · media: ${day.published_pieces[0].media_status}` : ''}`
                            : 'No content generated yet'}
                        </span>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <Button
                            label="Remove"
                            variant="secondary"
                            onClick={() => handleRemoveDay(day)}
                            disabled={busy !== null}
                          />
                          <Button
                            label={busy === `day:${day.day_number}` ? 'Saving…' : 'Save Day'}
                            variant="secondary"
                            onClick={() => handleSaveDay(day)}
                            disabled={busy !== null}
                          />
                          <Button
                            label={busy === `gen-day:${day.day_number}` ? 'Generating…' : 'Generate Content'}
                            variant="primary"
                            onClick={() => handleGenerateDay(day)}
                            disabled={busy !== null || !idea.title}
                          />
                        </div>
                      </div>
                    </div>
                  </Panel>
                )
              })}
            </div>
          )}
        </div>

        {!editingCampaign && pillars.length > 0 && (
          <div style={{ marginTop: '2rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem' }}>Messaging Pillars</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {pillars.map((pillar) => (
                <Panel key={pillar.id} title={pillar.name}>
                  <div>
                    <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--nx-text-3)' }}>
                      {pillar.description}
                    </p>
                    <p style={{ margin: '0', fontSize: '0.8rem', color: 'var(--nx-text-4)' }}>
                      Tone: <strong>{pillar.tone}</strong> • Audience: <strong>{pillar.targetAudience}</strong>
                    </p>
                  </div>
                </Panel>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return null
}
