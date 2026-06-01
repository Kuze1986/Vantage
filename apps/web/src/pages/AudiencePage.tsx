import { useState, useEffect } from 'react'
import { vantageApi } from '../api/vantage'
import { Panel, Button, Badge } from '../ds'

interface Segment {
  id: string
  name: string
  description?: string
  segment_type: string
  member_count: number
  engagement_pattern?: Record<string, any>
  ltv_metrics?: Record<string, any>
  is_active: boolean
  created_at: string
}

interface SegmentMember {
  id: string
  external_id: string
  source_platform: string
  member_handle?: string
  lifetime_value: number
  engagement_score: number
  predicted_churn_risk: number
}

interface SegmentAnalytics {
  date_tracked: string
  active_members: number
  new_members: number
  churned_members: number
  average_engagement_rate: number
}

type ViewTab = 'segments' | 'create' | 'details'

const SEGMENT_TYPE_COLORS: Record<string, 'active' | 'pending' | 'critical' | 'new' | 'core' | 'soon' | 'default'> = {
  behavioral: 'active',
  demographic: 'pending',
  technographic: 'core',
  geographic: 'new',
  custom: 'default',
}

const CHURN_RISK_COLOR = (risk: number): 'active' | 'pending' | 'critical' | 'new' | 'core' | 'soon' | 'default' => {
  if (risk > 0.7) return 'critical'
  if (risk > 0.4) return 'pending'
  return 'active'
}

export default function AudiencePage() {
  const [activeTab, setActiveTab] = useState<ViewTab>('segments')
  const [segments, setSegments] = useState<Segment[]>([])
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null)
  const [segmentMembers, setSegmentMembers] = useState<SegmentMember[]>([])
  const [segmentAnalytics, setSegmentAnalytics] = useState<SegmentAnalytics[]>([])
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    segment_type: 'behavioral' as const,
  })

  useEffect(() => {
    if (activeTab === 'segments') {
      loadSegments()
    }
  }, [activeTab])

  const loadSegments = async () => {
    setLoading(true)
    try {
      const data = await vantageApi.listSegments()
      setSegments(data.segments || [])
    } catch (err) {
      console.error('Failed to load segments:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadSegmentDetails = async (segment: Segment) => {
    setLoading(true)
    try {
      const [members, analytics] = await Promise.all([
        vantageApi.getSegmentMembers(segment.id, 20),
        vantageApi.getSegmentAnalytics(segment.id),
      ])
      setSelectedSegment(segment)
      setSegmentMembers(members.members || [])
      setSegmentAnalytics(analytics.analytics || [])
      setActiveTab('details')
    } catch (err) {
      console.error('Failed to load segment details:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateSegment = async () => {
    if (!formData.name) {
      alert('Segment name is required')
      return
    }
    setLoading(true)
    try {
      await vantageApi.createSegment({
        ...formData,
        definition: { match_type: 'all', rules: [] },
      })
      await loadSegments()
      setFormData({ name: '', description: '', segment_type: 'behavioral' })
      setActiveTab('segments')
    } catch (err) {
      console.error('Failed to create segment:', err)
      alert('Failed to create segment')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '2rem' }}>Audience Model</h1>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--nx-border)', paddingBottom: '1rem' }}>
        {(['segments', 'create', 'details'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: activeTab === tab ? 'var(--nx-accent)' : 'transparent',
              color: activeTab === tab ? '#fff' : 'var(--nx-text-2)',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer',
              fontWeight: 500,
              display: tab === 'details' && !selectedSegment ? 'none' : 'block',
            }}
          >
            {tab === 'segments' && 'Segments'}
            {tab === 'create' && 'Create Segment'}
            {tab === 'details' && selectedSegment?.name}
          </button>
        ))}
      </div>

      {/* Segments Tab */}
      {activeTab === 'segments' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>Audience Segments</h2>
              <p style={{ color: 'var(--nx-text-3)', margin: 0 }}>
                Define and manage audience segments for targeted campaigns
              </p>
            </div>
            <Button label="+ New Segment" variant="primary" onClick={() => setActiveTab('create')} />
          </div>

          {segments.length === 0 ? (
            <Panel title="No Segments Yet">
              Create your first segment to start building audience-specific campaigns and personalization strategies.
            </Panel>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {segments.map((segment) => {
                const avgLTV = (segment.ltv_metrics as any)?.avg_lifetime_value || 0;
                const churnRate = (segment.ltv_metrics as any)?.churn_rate || 0;

                return (
                  <Panel
                    key={segment.id}
                    title={segment.name}
                    titleAccent={segment.is_active ? 'green' : 'amber'}
                    action={{
                      label: 'View',
                      onClick: () => loadSegmentDetails(segment),
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        {segment.description && (
                          <p style={{ margin: '0 0 1rem 0', color: 'var(--nx-text-3)' }}>
                            {segment.description}
                          </p>
                        )}
                        <div style={{ display: 'flex', gap: '2rem', fontSize: '0.9rem' }}>
                          <div>
                            <div style={{ color: 'var(--nx-text-4)', marginBottom: '0.25rem' }}>Members</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                              {segment.member_count.toLocaleString()}
                            </div>
                          </div>
                          {avgLTV > 0 && (
                            <div>
                              <div style={{ color: 'var(--nx-text-4)', marginBottom: '0.25rem' }}>Avg LTV</div>
                              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                                ${avgLTV.toFixed(2)}
                              </div>
                            </div>
                          )}
                          {churnRate > 0 && (
                            <div>
                              <div style={{ color: 'var(--nx-text-4)', marginBottom: '0.25rem' }}>Churn Rate</div>
                              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                                {(churnRate * 100).toFixed(1)}%
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <Badge
                        label={segment.segment_type}
                        variant={SEGMENT_TYPE_COLORS[segment.segment_type] || 'default'}
                      />
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Create Segment Tab */}
      {activeTab === 'create' && (
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '2rem' }}>Create New Segment</h2>

          <Panel title="Segment Definition">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <label style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>
                  Segment Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., High-Value Enterprise Buyers"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid var(--nx-border)',
                    borderRadius: '0.25rem',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Who is in this segment? What characteristics define them?"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid var(--nx-border)',
                    borderRadius: '0.25rem',
                    fontFamily: 'inherit',
                    minHeight: '120px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>
                  Segment Type
                </label>
                <select
                  value={formData.segment_type}
                  onChange={(e) => setFormData({ ...formData, segment_type: e.target.value as any })}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid var(--nx-border)',
                    borderRadius: '0.25rem',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="behavioral">Behavioral (engagement patterns)</option>
                  <option value="demographic">Demographic (size, location)</option>
                  <option value="technographic">Technographic (tools used)</option>
                  <option value="geographic">Geographic (regions)</option>
                  <option value="custom">Custom (other criteria)</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <Button label="Cancel" variant="secondary" onClick={() => setActiveTab('segments')} />
                <Button
                  label={loading ? 'Creating...' : 'Create Segment'}
                  variant="primary"
                  onClick={handleCreateSegment}
                  disabled={!formData.name || loading}
                />
              </div>
            </div>
          </Panel>
        </div>
      )}

      {/* Details Tab */}
      {activeTab === 'details' && selectedSegment && (
        <div>
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              {selectedSegment.name}
            </h2>
            {selectedSegment.description && (
              <p style={{ color: 'var(--nx-text-3)', margin: 0 }}>{selectedSegment.description}</p>
            )}
          </div>

          {/* Overview Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            <Panel title={`${selectedSegment.member_count.toLocaleString()} Members`}>
              Active members in this segment
            </Panel>
            <Panel title={`${(segmentAnalytics[0]?.average_engagement_rate ?? 0 * 100).toFixed(1)}% Engagement`}>
              Average engagement rate
            </Panel>
            <Panel title={`${((selectedSegment.ltv_metrics as any)?.churn_rate ?? 0 * 100).toFixed(1)}% Churn`}>
              Monthly churn rate
            </Panel>
          </div>

          {/* Members Section */}
          <div style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Top Members</h3>
            {segmentMembers.length === 0 ? (
              <Panel title="No Members Yet">
                Members will appear once you add them to this segment.
              </Panel>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {segmentMembers.slice(0, 10).map((member) => (
                  <Panel key={member.id} title={member.member_handle || member.external_id}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--nx-text-3)' }}>LTV</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                          ${member.lifetime_value.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--nx-text-3)' }}>Engagement</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                          {(member.engagement_score * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--nx-text-3)', marginBottom: '0.25rem' }}>
                          Churn Risk
                        </div>
                        <Badge
                          label={`${(member.predicted_churn_risk * 100).toFixed(0)}%`}
                          variant={CHURN_RISK_COLOR(member.predicted_churn_risk)}
                        />
                      </div>
                    </div>
                  </Panel>
                ))}
              </div>
            )}
          </div>

          {/* Analytics Trend */}
          <div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Recent Activity</h3>
            {segmentAnalytics.length === 0 ? (
              <Panel title="No Analytics Yet">
                Analytics will be populated as members engage with content.
              </Panel>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {segmentAnalytics.slice(0, 7).map((analytics) => (
                  <Panel key={analytics.date_tracked} title={analytics.date_tracked}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--nx-text-3)' }}>Active</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                          {analytics.active_members}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--nx-text-3)' }}>New</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#22c55e' }}>
                          +{analytics.new_members}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--nx-text-3)' }}>Churned</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ef4444' }}>
                          -{analytics.churned_members}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--nx-text-3)' }}>Engagement</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                          {(analytics.average_engagement_rate * 100).toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  </Panel>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
