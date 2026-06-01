import { useState, useEffect } from 'react'
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

    return (
      <div style={{ padding: '2rem', maxWidth: '1200px' }}>
        <div style={{ marginBottom: '2rem' }}>
          <Button
            label="← Back to Campaigns"
            variant="secondary"
            onClick={() => setView('list')}
          />
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

        {selectedCampaign.description && (
          <Panel title="Overview">
            {selectedCampaign.description}
          </Panel>
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
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem' }}>
            Timeline ({timeline.length} days)
          </h2>
          {timeline.length === 0 ? (
            <Panel title="No Timeline Yet">
              Generate a timeline using AI to get started with your campaign scheduling.
            </Panel>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {timeline.map((day) => (
                <Panel
                  key={day.id}
                  title={`Day ${day.day_number + 1} - ${day.date_scheduled}`}
                  titleAccent={
                    day.primary_channel === 'x'
                      ? 'cyan'
                      : day.primary_channel === 'linkedin'
                        ? 'green'
                        : 'amber'
                  }
                >
                  <div>
                    <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>
                      <strong>Type:</strong> {day.content_type}
                    </p>
                    <p style={{ margin: '0', fontSize: '0.9rem' }}>
                      <strong>Primary Channel:</strong> {day.primary_channel}
                      {day.secondary_channels.length > 0 && ` (+ ${day.secondary_channels.join(', ')})`}
                    </p>
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </div>

        {selectedCampaign.messaging_pillars && selectedCampaign.messaging_pillars.length > 0 && (
          <div style={{ marginTop: '2rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem' }}>Messaging Pillars</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {selectedCampaign.messaging_pillars.map((pillar) => (
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
