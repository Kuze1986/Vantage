import { useState, useEffect } from 'react'
import { vantageApi } from '../api/vantage'
import { Panel, Button, Badge } from '../ds'

interface Insight {
  id: string
  insight_type: string
  title: string
  description: string
  confidence_score: number
  recommended_actions: Array<{ action: string; expected_impact: string; priority: string }>
  expected_impact: Record<string, number>
}

interface Trend {
  id: string
  trend_name: string
  trend_category: string
  trend_status: 'emerging' | 'peak' | 'declining' | 'sustained'
  total_mentions: number
  unique_sources: number
  average_engagement_rate: number
  key_messaging: string[]
  recommended_use_cases: string[]
}

interface CompetitivePost {
  id: string
  source_platform: 'x' | 'linkedin' | 'reddit'
  source_account_name: string
  post_content: string
  posted_at: string
  impressions: number
  engagements: number
  content_themes: string[]
  sentiment: string
}

interface Benchmark {
  id: string
  period_start: string
  period_end: string
  our_average_engagement_rate: number
  competitor_avg_engagement_rate: number
  gaps: Record<string, any>
  recommendations: Array<{ area: string; current_vs_competitor: string; suggested_tactic: string; priority: string }>
}

type ViewTab = 'insights' | 'trends' | 'posts' | 'benchmarks'

const INSIGHT_TYPE_LABELS: Record<string, string> = {
  competitive_gap: 'Competitive Gap',
  opportunity: 'Opportunity',
  benchmark: 'Benchmark',
  optimization: 'Optimization',
  audience_insight: 'Audience Insight',
  format_recommendation: 'Format',
  timing_recommendation: 'Timing',
}

const INSIGHT_TYPE_COLORS: Record<string, 'active' | 'pending' | 'critical' | 'new' | 'core' | 'soon' | 'default'> = {
  competitive_gap: 'critical',
  opportunity: 'new',
  benchmark: 'default',
  optimization: 'pending',
  audience_insight: 'core',
  format_recommendation: 'default',
  timing_recommendation: 'default',
}

const TREND_STATUS_COLORS: Record<string, 'active' | 'pending' | 'critical' | 'new' | 'core' | 'soon' | 'default'> = {
  emerging: 'new',
  peak: 'active',
  declining: 'pending',
  sustained: 'core',
}

export default function IntelligencePage() {
  const [activeTab, setActiveTab] = useState<ViewTab>('insights')
  const [insights, setInsights] = useState<Insight[]>([])
  const [trends, setTrends] = useState<Trend[]>([])
  const [posts, setPosts] = useState<CompetitivePost[]>([])
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadData()
  }, [activeTab])

  const loadData = async () => {
    setLoading(true)
    try {
      if (activeTab === 'insights') {
        const data = await vantageApi.listInsights()
        setInsights(data.insights || [])
      } else if (activeTab === 'trends') {
        const data = await vantageApi.listTrends()
        setTrends(data.trends || [])
      } else if (activeTab === 'posts') {
        const data = await vantageApi.listCompetitivePosts(30)
        setPosts(data.posts || [])
      } else if (activeTab === 'benchmarks') {
        const data = await vantageApi.listBenchmarks(5)
        setBenchmarks(data.benchmarks || [])
      }
    } catch (err) {
      console.error(`Failed to load ${activeTab}:`, err)
    } finally {
      setLoading(false)
    }
  }

  const handleDetectTrends = async () => {
    setLoading(true)
    try {
      const data = await vantageApi.detectTrends(7)
      setTrends(data.trends || [])
      setActiveTab('trends')
    } catch (err) {
      console.error('Failed to detect trends:', err)
      alert('Failed to detect trends. Make sure you have recent competitive posts tracked.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '2rem' }}>Strategic Intelligence</h1>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--nx-border)', paddingBottom: '1rem' }}>
        {(['insights', 'trends', 'posts', 'benchmarks'] as const).map((tab) => (
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
            }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Insights Tab */}
      {activeTab === 'insights' && (
        <div>
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem' }}>AI-Generated Insights</h2>
            <p style={{ color: 'var(--nx-text-3)', marginBottom: '1rem' }}>
              Strategic recommendations based on competitive analysis and campaign performance
            </p>
          </div>

          {insights.length === 0 ? (
            <Panel title="No Insights Yet">
              Run competitive analysis or track more competitor posts to generate insights.
            </Panel>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {insights.map((insight) => (
                <Panel
                  key={insight.id}
                  title={insight.title}
                  titleAccent={insight.confidence_score > 80 ? 'green' : insight.confidence_score > 60 ? 'amber' : 'cyan'}
                >
                  <div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                      <Badge
                        label={INSIGHT_TYPE_LABELS[insight.insight_type]}
                        variant={INSIGHT_TYPE_COLORS[insight.insight_type]}
                      />
                      <Badge
                        label={`${insight.confidence_score}% Confidence`}
                        variant="default"
                      />
                    </div>

                    <p style={{ margin: '0 0 1rem 0', lineHeight: '1.5' }}>
                      {insight.description}
                    </p>

                    {insight.recommended_actions && insight.recommended_actions.length > 0 && (
                      <div style={{ marginBottom: '1rem' }}>
                        <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', fontWeight: 600 }}>
                          Recommended Actions:
                        </h4>
                        <ul style={{ margin: '0', paddingLeft: '1.5rem' }}>
                          {insight.recommended_actions.map((action, idx) => (
                            <li key={idx} style={{ margin: '0.25rem 0', fontSize: '0.9rem' }}>
                              <strong>{action.action}</strong> — {action.expected_impact}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {insight.expected_impact && Object.keys(insight.expected_impact).length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem' }}>
                        {Object.entries(insight.expected_impact).map(([key, value]) => (
                          <div key={key} style={{ fontSize: '0.85rem', padding: '0.5rem', backgroundColor: 'var(--nx-bg-2)', borderRadius: '0.25rem' }}>
                            <div style={{ color: 'var(--nx-text-3)' }}>{key.replace(/_/g, ' ')}</div>
                            <div style={{ fontWeight: 600, color: 'var(--nx-accent)' }}>
                              +{((value as number) * 100).toFixed(0)}%
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Trends Tab */}
      {activeTab === 'trends' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>Emerging Trends</h2>
              <p style={{ color: 'var(--nx-text-3)', margin: 0 }}>
                Trends detected across competitive posts in your industry
              </p>
            </div>
            <Button
              label={loading ? 'Detecting...' : 'Detect Trends'}
              variant="primary"
              onClick={handleDetectTrends}
              disabled={loading}
            />
          </div>

          {trends.length === 0 ? (
            <Panel title="No Trends Detected">
              Click "Detect Trends" to analyze recent competitive posts for emerging patterns and opportunities.
            </Panel>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {trends.map((trend) => (
                <Panel
                  key={trend.id}
                  title={trend.trend_name}
                  titleAccent={trend.trend_status === 'peak' ? 'amber' : trend.trend_status === 'emerging' ? 'green' : 'cyan'}
                >
                  <div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                      <Badge label={trend.trend_category} variant="default" />
                      <Badge label={trend.trend_status} variant={TREND_STATUS_COLORS[trend.trend_status]} />
                      <Badge label={`${trend.unique_sources} sources`} variant="default" />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                      <div style={{ padding: '0.75rem', backgroundColor: 'var(--nx-bg-2)', borderRadius: '0.25rem' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--nx-text-3)' }}>Mentions</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{trend.total_mentions}</div>
                      </div>
                      <div style={{ padding: '0.75rem', backgroundColor: 'var(--nx-bg-2)', borderRadius: '0.25rem' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--nx-text-3)' }}>Avg Engagement</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                          {(trend.average_engagement_rate * 100).toFixed(1)}%
                        </div>
                      </div>
                    </div>

                    {trend.key_messaging && trend.key_messaging.length > 0 && (
                      <div style={{ marginBottom: '1rem' }}>
                        <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', fontWeight: 600 }}>Key Messaging:</h4>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {trend.key_messaging.map((msg, idx) => (
                            <div
                              key={idx}
                              style={{
                                padding: '0.5rem 0.75rem',
                                backgroundColor: 'var(--nx-accent)',
                                color: '#fff',
                                borderRadius: '0.25rem',
                                fontSize: '0.85rem',
                              }}
                            >
                              {msg}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {trend.recommended_use_cases && trend.recommended_use_cases.length > 0 && (
                      <div>
                        <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', fontWeight: 600 }}>Use Cases:</h4>
                        <ul style={{ margin: '0', paddingLeft: '1.5rem', fontSize: '0.9rem' }}>
                          {trend.recommended_use_cases.map((useCase, idx) => (
                            <li key={idx}>{useCase}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Posts Tab */}
      {activeTab === 'posts' && (
        <div>
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>Competitive Posts</h2>
            <p style={{ color: 'var(--nx-text-3)', margin: 0 }}>
              High-performing posts from competitors and industry leaders
            </p>
          </div>

          {posts.length === 0 ? (
            <Panel title="No Posts Tracked">
              Start tracking competitive posts from competitors and influencers to build intelligence.
            </Panel>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {posts.map((post) => (
                <Panel
                  key={post.id}
                  title={`${post.source_account_name} on ${post.source_platform.toUpperCase()}`}
                >
                  <div>
                    <p style={{ margin: '0 0 1rem 0', lineHeight: '1.5', color: 'var(--nx-text-2)' }}>
                      {post.post_content}
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginBottom: '1rem' }}>
                      <div style={{ padding: '0.5rem', backgroundColor: 'var(--nx-bg-2)', borderRadius: '0.25rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--nx-text-3)' }}>Impressions</div>
                        <div style={{ fontWeight: 600 }}>{(post.impressions / 1000).toFixed(1)}K</div>
                      </div>
                      <div style={{ padding: '0.5rem', backgroundColor: 'var(--nx-bg-2)', borderRadius: '0.25rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--nx-text-3)' }}>Engagements</div>
                        <div style={{ fontWeight: 600 }}>{(post.engagements / 1000).toFixed(1)}K</div>
                      </div>
                      <div style={{ padding: '0.5rem', backgroundColor: 'var(--nx-bg-2)', borderRadius: '0.25rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--nx-text-3)' }}>Sentiment</div>
                        <div style={{ fontWeight: 600, color: post.sentiment === 'positive' ? '#22c55e' : post.sentiment === 'negative' ? '#ef4444' : 'var(--nx-text-2)' }}>
                          {post.sentiment}
                        </div>
                      </div>
                      <div style={{ padding: '0.5rem', backgroundColor: 'var(--nx-bg-2)', borderRadius: '0.25rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--nx-text-3)' }}>Posted</div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                          {new Date(post.posted_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    {post.content_themes && post.content_themes.length > 0 && (
                      <div>
                        <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', fontWeight: 600 }}>Themes:</h4>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {post.content_themes.map((theme, idx) => (
                            <Badge key={idx} label={theme} variant="default" />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Benchmarks Tab */}
      {activeTab === 'benchmarks' && (
        <div>
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>Competitive Benchmarks</h2>
            <p style={{ color: 'var(--nx-text-3)', margin: 0 }}>
              Compare your performance against competitor averages
            </p>
          </div>

          {benchmarks.length === 0 ? (
            <Panel title="No Benchmarks Available">
              Benchmarks will be generated as you track more competitive data and campaigns.
            </Panel>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {benchmarks.map((benchmark) => (
                <Panel
                  key={benchmark.id}
                  title={`${benchmark.period_start} to ${benchmark.period_end}`}
                >
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                      <div style={{ padding: '1rem', backgroundColor: 'var(--nx-bg-2)', borderRadius: '0.25rem' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--nx-text-3)', marginBottom: '0.5rem' }}>Our Engagement Rate</div>
                        <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--nx-accent)' }}>
                          {(benchmark.our_average_engagement_rate * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div style={{ padding: '1rem', backgroundColor: 'var(--nx-bg-2)', borderRadius: '0.25rem' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--nx-text-3)', marginBottom: '0.5rem' }}>Competitor Average</div>
                        <div style={{ fontSize: '2rem', fontWeight: 700 }}>
                          {(benchmark.competitor_avg_engagement_rate * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div style={{ padding: '1rem', backgroundColor: 'var(--nx-bg-2)', borderRadius: '0.25rem' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--nx-text-3)', marginBottom: '0.5rem' }}>Gap</div>
                        <div
                          style={{
                            fontSize: '2rem',
                            fontWeight: 700,
                            color:
                              benchmark.our_average_engagement_rate >= benchmark.competitor_avg_engagement_rate
                                ? '#22c55e'
                                : '#ef4444',
                          }}
                        >
                          {(
                            (benchmark.our_average_engagement_rate - benchmark.competitor_avg_engagement_rate) *
                            100
                          ).toFixed(1)}
                          %
                        </div>
                      </div>
                    </div>

                    {benchmark.recommendations && benchmark.recommendations.length > 0 && (
                      <div>
                        <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', fontWeight: 600 }}>Recommendations:</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {benchmark.recommendations.map((rec, idx) => (
                            <div
                              key={idx}
                              style={{
                                padding: '0.75rem',
                                backgroundColor: 'var(--nx-bg-2)',
                                borderRadius: '0.25rem',
                                borderLeft: `3px solid ${rec.priority === 'high' ? '#ef4444' : rec.priority === 'medium' ? '#f59e0b' : '#22c55e'}`,
                              }}
                            >
                              <div style={{ fontWeight: 600, marginBottom: '0.25rem', fontSize: '0.9rem' }}>
                                {rec.area}
                              </div>
                              <div style={{ fontSize: '0.85rem', color: 'var(--nx-text-3)', marginBottom: '0.25rem' }}>
                                {rec.current_vs_competitor}
                              </div>
                              <div style={{ fontSize: '0.85rem' }}>💡 {rec.suggested_tactic}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
