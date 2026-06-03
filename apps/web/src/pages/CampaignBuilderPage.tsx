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
  created_at: string
  updated_at: string
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

export default function CampaignBuilderPage() {
  const [view, setView] = useState<ViewState>('list')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [timeline, setTimeline] = useState<TimelineDay[]>([])
  const [kpiMetrics, setKpiMetrics] = useState<KPIMetrics[]>([])
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    cadence_config: { weeks: 3, periodsPerWeek: 1 },
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
    channel_mix: { x: { daily: 2 }, linkedin: { daily: 1 }, reddit: { daily: 1 } },
    kpi_targets: { impressions: 10000, engagements: 500 },
  })

  const [busy, setBusy] = useState<string | null>(null)
  const [editingCampaign, setEditingCampaign] = useState(false)
  const [editData, setEditData] = useState<{ name: string; description: string; messaging_pillars: any[] }>({
    name: '',
    description: '',
    messaging_pillars: [],
  })
  const [launchInfo, setLaunchInfo] = useState<string | null>(null)

  useEffect(() => {
    fetchCampaigns()
  }, [])

  const fetchCampaigns = async () => {
    try {
      const data = await vantageApi.listCampaigns()
      setCampaigns(data.campaigns || [])
    } catch (err) {
      console.error('Failed to fetch campaigns:', err)
    }
  }

  const fetchCampaignDetails = async (campaignId: string) => {
    try {
      const [campaignData, timelineData, kpiData] = await Promise.all([
        vantageApi.getCampaign(campaignId),
        vantageApi.getCampaignTimeline(campaignId),
        vantageApi.getCampaignKPI(campaignId),
      ])
      setSelectedCampaign(campaignData)
      setTimeline(timelineData.timeline || [])
      setKpiMetrics(kpiData.kpi_tracking || [])
    } catch (err) {
      console.error('Failed to fetch campaign details:', err)
    }
  }

  const handleSelectCampaign = async (campaign: Campaign) => {
    await fetchCampaignDetails(campaign.id)
    setView('details')
  }

  const handleCreateCampaign = async () => {
    if (!formData.name) {
      alert('Campaign name is required')
      return
    }
    try {
      await vantageApi.createCampaign(formData)
      await fetchCampaigns()
      setView('list')
      setFormData({
        name: '',
        description: '',
        start_date: new Date().toISOString().split('T')[0],
        end_date: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        cadence_config: { weeks: 3, periodsPerWeek: 1 },
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
        channel_mix: { x: { daily: 2 }, linkedin: { daily: 1 }, reddit: { daily: 1 } },
        kpi_targets: { impressions: 10000, engagements: 500 },
      })
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
    if (!confirm(`Generate content for all ${timeline.length} timeline day(s)? Pieces are created as approved drafts for you to review on the Queue page before they post.`)) return
    setBusy('launch')
    setLaunchInfo(null)
    try {
      const res = await vantageApi.launchCampaign(selectedCampaign.id)
      setLaunchInfo(
        `Created ${res.launched} content piece(s) as approved drafts${res.failed ? `, ${res.failed} failed` : ''}. Review and schedule them on the Queue page.`,
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

  const handleGenerateDay = async (day: TimelineDay) => {
    if (!selectedCampaign) return
    setBusy(`gen-day:${day.day_number}`)
    setLaunchInfo(null)
    try {
      const res = await vantageApi.launchCampaign(selectedCampaign.id, [day.day_number])
      if (res.failed) {
        alert(`Generation failed: ${res.failures[0]?.error ?? 'Unknown error'}`)
      } else {
        setLaunchInfo(`Generated ${res.launched} piece for day ${day.day_number + 1}. Review it on the Queue page.`)
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
    setEditData({
      name: selectedCampaign.name,
      description: selectedCampaign.description || '',
      messaging_pillars: JSON.parse(JSON.stringify(selectedCampaign.messaging_pillars || [])),
    })
    setEditingCampaign(true)
  }

  const handleSaveCampaign = async () => {
    if (!selectedCampaign) return
    setBusy('campaign')
    try {
      const updated = await vantageApi.updateCampaign(selectedCampaign.id, {
        name: editData.name,
        description: editData.description,
        messaging_pillars: editData.messaging_pillars,
      })
      setSelectedCampaign(updated)
      setEditingCampaign(false)
    } catch (err) {
      alert('Failed to save campaign: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setBusy(null)
    }
  }

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
      <div style={{ padding: '2rem', maxWidth: '1200px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 700 }}>Campaigns</h1>
          <Button
            label="+ New Campaign"
            variant="primary"
            onClick={() => setView('create')}
          />
        </div>

        {campaigns.length === 0 ? (
          <Panel title="No Campaigns Yet">
            Create your first campaign to get started with multi-week social media planning.
          </Panel>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {campaigns.map((campaign) => (
              <Panel
                key={campaign.id}
                title={campaign.name}
                action={{
                  label: 'Delete',
                  onClick: () => handleDeleteCampaign(campaign.id),
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    {campaign.description && (
                      <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--nx-text-3)' }}>
                        {campaign.description}
                      </p>
                    )}
                    <p style={{ margin: '0', fontSize: '0.85rem', color: 'var(--nx-text-4)' }}>
                      {campaign.start_date} → {campaign.end_date}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <Badge
                      label={campaign.status}
                      variant={STATUS_VARIANTS[campaign.status] || 'default'}
                    />
                    <Button
                      label="Open"
                      variant="secondary"
                      onClick={() => handleSelectCampaign(campaign)}
                    />
                  </div>
                </div>
              </Panel>
            ))}
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
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
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

            <div>
              <label style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>Duration (weeks)</label>
              <input
                type="number"
                value={formData.cadence_config.weeks}
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
                disabled={!formData.name}
              />
            </div>
          </div>
        </Panel>
      </div>
    )
  }

  if (view === 'details' && selectedCampaign) {
    const kpiSummary = kpiMetrics.reduce(
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

    return (
      <div style={{ padding: '2rem', maxWidth: '1200px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <Button label="← Back to Campaigns" variant="secondary" onClick={() => setView('list')} />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {!editingCampaign && (
              <Button label="Edit" variant="secondary" onClick={startEditCampaign} />
            )}
            <Button
              label={busy === 'launch' ? 'Launching…' : 'Launch Campaign'}
              variant="primary"
              onClick={handleLaunch}
              disabled={busy !== null || timeline.length === 0}
            />
          </div>
        </div>

        <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          {selectedCampaign.name}
        </h1>
        <div style={{ marginBottom: '2rem' }}>
          <Badge
            label={selectedCampaign.status}
            variant={STATUS_VARIANTS[selectedCampaign.status] || 'default'}
          />
        </div>

        {launchInfo && (
          <div style={{ marginBottom: '1.5rem' }}>
            <Panel title="Campaign Launched">{launchInfo}</Panel>
          </div>
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

        <div style={{ marginTop: '2rem', marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem' }}>Performance</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <Panel title={`${kpiSummary.impressions.toLocaleString()} Impressions`}>
              Total impressions across all campaign posts.
            </Panel>
            <Panel title={`${kpiSummary.engagements.toLocaleString()} Engagements`}>
              Total likes, comments, shares, and replies.
            </Panel>
            <Panel title={`${engagementRate}% Engagement Rate`}>
              Engagement as a percentage of impressions.
            </Panel>
            <Panel title={`${kpiSummary.follows.toLocaleString()} New Follows`}>
              New followers gained during campaign.
            </Panel>
          </div>
        </div>

        <div style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>
              Timeline ({timeline.length} days)
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
                      day.primary_channel === 'x' ? 'cyan' : day.primary_channel === 'linkedin' ? 'green' : 'amber'
                    }
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                        <div>
                          <label style={labelStyle}>Channel</label>
                          <select
                            style={inputStyle}
                            value={day.primary_channel}
                            onChange={(e) => updateDayLocal(day.day_number, { primary_channel: e.target.value })}
                          >
                            <option value="x">X</option>
                            <option value="linkedin">LinkedIn</option>
                            <option value="reddit">Reddit</option>
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
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--nx-text-4)' }}>
                          {publishedCount > 0 ? `${publishedCount} piece(s) generated` : 'No content generated yet'}
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
