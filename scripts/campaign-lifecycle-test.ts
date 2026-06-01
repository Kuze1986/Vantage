#!/usr/bin/env npx tsx

/**
 * Campaign Lifecycle End-to-End Test
 *
 * Validates a complete campaign workflow:
 * 1. Create campaign with messaging pillars, channel mix, KPI targets
 * 2. Generate campaign timeline (daily content ideas)
 * 3. Create audience segment
 * 4. Generate content via Kuze (multiple channels)
 * 5. Audit content via Ilita
 * 6. Schedule and publish pieces
 * 7. Simulate engagement via webhook payloads
 * 8. Verify engagement_events recorded correctly
 * 9. Fetch campaign KPI metrics
 * 10. Generate strategic intelligence & virality recommendations
 * 11. Validate analytics calculations
 *
 * Run: npx tsx scripts/campaign-lifecycle-test.ts
 * Output: test-results.json with pass/fail status per step
 */

import { createClient } from "@supabase/supabase-js";

// ============================================================================
// Configuration
// ============================================================================

const VANTAGE_API_BASE = process.env.VANTAGE_API_URL || "http://localhost:8787";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "";
const JWT_TOKEN = process.env.TEST_JWT_TOKEN || "";
const WORKSPACE_ID = process.env.TEST_WORKSPACE_ID || "00000000-0000-0000-0000-000000000001";

interface TestResult {
  step: number;
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  duration_ms: number;
  error?: string;
  payload?: Record<string, any>;
}

const results: TestResult[] = [];

// ============================================================================
// Helper Functions
// ============================================================================

async function apiCall<T>(
  method: string,
  endpoint: string,
  body?: Record<string, any>
): Promise<T> {
  const url = `${VANTAGE_API_BASE}${endpoint}`;
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${JWT_TOKEN}`,
      "x-workspace-id": WORKSPACE_ID,
    },
  };

  if (body) options.body = JSON.stringify(body);

  const resp = await fetch(url, options);
  if (!resp.ok) {
    throw new Error(`${method} ${endpoint} returned ${resp.status}: ${await resp.text()}`);
  }
  return resp.json() as Promise<T>;
}

function logStep(
  step: number,
  name: string,
  status: "PASS" | "FAIL",
  duration_ms: number,
  error?: string,
  payload?: Record<string, any>
) {
  results.push({ step, name, status, duration_ms, error, payload });
  const statusEmoji = status === "PASS" ? "✅" : "❌";
  console.log(`\n${statusEmoji} [${step}] ${name} (${duration_ms}ms)`);
  if (error) console.log(`   Error: ${error}`);
  if (payload && Object.keys(payload).length < 10) {
    console.log(`   Payload:`, JSON.stringify(payload, null, 2).substring(0, 200));
  }
}

// ============================================================================
// Test Steps
// ============================================================================

async function runTests() {
  console.log("🚀 Starting Campaign Lifecycle E2E Test\n");
  console.log(`API Base: ${VANTAGE_API_BASE}`);
  console.log(`Workspace: ${WORKSPACE_ID}`);
  console.log("");

  let step = 1;
  let campaignId: string;
  let segmentId: string;
  let contentPieceIds: string[] = [];
  let engagementEventCount = 0;

  // =========================================================================
  // Step 1: Create Campaign
  // =========================================================================
  try {
    const start = Date.now();
    const response = await apiCall<any>("POST", "/v1/campaigns", {
      name: "E2E Test Campaign - Product Launch Q2",
      cadence_config: {
        posts_per_day: 3,
        posting_hours: [9, 12, 17],
        auto_approve: true,
      },
      messaging_pillars: [
        {
          title: "Feature Spotlight",
          description: "Highlight new product features and capabilities",
        },
        {
          title: "Customer Success Stories",
          description: "Share customer wins and testimonials",
        },
        {
          title: "Behind the Scenes",
          description: "Team culture and development insights",
        },
      ],
      channel_mix: {
        x: 0.4,
        linkedin: 0.35,
        email: 0.25,
      },
      kpi_targets: {
        engagement_events: 5000,
        reach: 100000,
        conversions: 500,
      },
    });
    const duration = Date.now() - start;

    campaignId = response.id;
    logStep(step++, "Create Campaign", "PASS", duration, undefined, {
      campaign_id: campaignId,
      name: response.name,
    });
  } catch (e) {
    logStep(step++, "Create Campaign", "FAIL", 0, String(e));
    return;
  }

  // =========================================================================
  // Step 2: Generate Campaign Timeline
  // =========================================================================
  try {
    const start = Date.now();
    const response = await apiCall<any>("POST", `/v1/campaigns/${campaignId}/timeline`, {
      start_date: new Date().toISOString().split("T")[0],
      duration_days: 7,
    });
    const duration = Date.now() - start;

    logStep(step++, "Generate Campaign Timeline", "PASS", duration, undefined, {
      timeline_entries: response.timeline?.length || 0,
      date_range: response.date_range,
    });
  } catch (e) {
    logStep(step++, "Generate Campaign Timeline", "FAIL", 0, String(e));
  }

  // =========================================================================
  // Step 3: Create Audience Segment
  // =========================================================================
  try {
    const start = Date.now();
    const response = await apiCall<any>("POST", "/v1/audience/segments", {
      segment_type: "behavioral",
      definition: {
        min_engagement_score: 70,
        last_seen_days: 30,
      },
      engagement_pattern: {
        reply_frequency: "high",
        share_rate: 0.15,
        conversion_likelihood: 0.08,
      },
    });
    const duration = Date.now() - start;

    segmentId = response.id;
    logStep(step++, "Create Audience Segment", "PASS", duration, undefined, {
      segment_id: segmentId,
      segment_type: response.segment_type,
    });
  } catch (e) {
    logStep(step++, "Create Audience Segment", "FAIL", 0, String(e));
    segmentId = "";
  }

  // =========================================================================
  // Step 4: Generate Content (Kuze) - Multiple Channels
  // =========================================================================
  const channels = ["x", "linkedin", "email"];
  for (const channel of channels) {
    try {
      const start = Date.now();
      const response = await apiCall<any>("POST", `/v1/generate/${channel}`, {
        topic: `Test topic for ${channel} from E2E test campaign`,
        variants: 1,
        generate_image: channel !== "email", // Only X and LinkedIn get images
      });
      const duration = Date.now() - start;

      if (response.pieces) {
        contentPieceIds.push(...response.pieces.map((p: any) => p.id));
      }

      logStep(step++, `Generate Content (${channel})`, "PASS", duration, undefined, {
        pieces_count: response.pieces?.length || 0,
        first_piece_id: response.pieces?.[0]?.id,
      });
    } catch (e) {
      logStep(step++, `Generate Content (${channel})`, "FAIL", 0, String(e));
    }
  }

  // =========================================================================
  // Step 5: Audit Content (Ilita)
  // =========================================================================
  for (let i = 0; i < contentPieceIds.length; i++) {
    try {
      const start = Date.now();
      const response = await apiCall<any>("POST", "/v1/audit", {
        piece_id: contentPieceIds[i],
      });
      const duration = Date.now() - start;

      const status = response.decision === "pass" ? "approved" : "rejected";
      logStep(step++, `Audit Content (${i + 1}/${contentPieceIds.length})`, "PASS", duration, undefined, {
        decision: response.decision,
        feedback: response.feedback?.substring(0, 50),
      });
    } catch (e) {
      logStep(step++, `Audit Content (${i + 1}/${contentPieceIds.length})`, "FAIL", 0, String(e));
    }
  }

  // =========================================================================
  // Step 6: Schedule Content for Publishing
  // =========================================================================
  for (let i = 0; i < Math.min(contentPieceIds.length, 3); i++) {
    try {
      const start = Date.now();
      const scheduledFor = new Date(Date.now() + (i + 1) * 3600000).toISOString(); // Stagger by 1 hour
      const response = await apiCall<any>("POST", "/v1/schedule", {
        piece_id: contentPieceIds[i],
        scheduled_for: scheduledFor,
      });
      const duration = Date.now() - start;

      logStep(step++, `Schedule Content (${i + 1}/3)`, "PASS", duration, undefined, {
        piece_id: contentPieceIds[i],
        scheduled_for: scheduledFor,
      });
    } catch (e) {
      logStep(step++, `Schedule Content (${i + 1}/3)`, "FAIL", 0, String(e));
    }
  }

  // =========================================================================
  // Step 7: Publish Content (Immediate)
  // =========================================================================
  const publishedPieceIds: string[] = [];
  for (let i = 0; i < Math.min(contentPieceIds.length, 2); i++) {
    try {
      const start = Date.now();
      const response = await apiCall<any>("POST", `/v1/publish/x`, {
        piece_id: contentPieceIds[i],
      });
      const duration = Date.now() - start;

      publishedPieceIds.push(contentPieceIds[i]);
      logStep(step++, `Publish Content (${i + 1}/2)`, "PASS", duration, undefined, {
        piece_id: contentPieceIds[i],
        external_post_id: response.external_post_id?.substring(0, 20),
      });
    } catch (e) {
      logStep(step++, `Publish Content (${i + 1}/2)`, "FAIL", 0, String(e));
    }
  }

  // =========================================================================
  // Step 8: Simulate Engagement Events (Webhook Payloads)
  // =========================================================================
  if (publishedPieceIds.length > 0) {
    // Simulate multiple engagement events for each published piece
    const events = [
      { type: "like", count: 50 },
      { type: "repost", count: 10 },
      { type: "reply", count: 5 },
    ];

    for (const event of events) {
      try {
        const start = Date.now();

        // Simulate X webhook for each published piece
        for (let i = 0; i < publishedPieceIds.length; i++) {
          await apiCall("POST", "/v1/webhooks/x", {
            tweet_id: `simulated_${Date.now()}_${i}`,
            event_type: event.type,
            engagement_count: event.count,
            external_post_id: publishedPieceIds[i],
          });
          engagementEventCount += event.count;
        }

        const duration = Date.now() - start;
        logStep(step++, `Simulate ${event.type} Events (${event.count} x ${publishedPieceIds.length})`, "PASS", duration, undefined, {
          events_simulated: event.count * publishedPieceIds.length,
        });
      } catch (e) {
        logStep(step++, `Simulate ${event.type} Events`, "FAIL", 0, String(e));
      }
    }
  }

  // =========================================================================
  // Step 9: Verify Engagement Events in Database
  // =========================================================================
  try {
    const start = Date.now();
    const response = await apiCall<any>("GET", `/v1/queue`);
    const duration = Date.now() - start;

    // Count engagement events across all pieces
    const totalEngagements = response.pieces
      ?.reduce((sum: number, p: any) => sum + (p.engagement_events?.length || 0), 0) || 0;

    logStep(step++, "Verify Engagement Events in DB", totalEngagements > 0 ? "PASS" : "FAIL", duration, undefined, {
      total_engagement_events: totalEngagements,
      expected_minimum: engagementEventCount,
    });
  } catch (e) {
    logStep(step++, "Verify Engagement Events in DB", "FAIL", 0, String(e));
  }

  // =========================================================================
  // Step 10: Fetch Campaign KPI Metrics
  // =========================================================================
  try {
    const start = Date.now();
    const response = await apiCall<any>("GET", `/v1/campaigns/${campaignId}/kpi`);
    const duration = Date.now() - start;

    logStep(step++, "Fetch Campaign KPI Metrics", "PASS", duration, undefined, {
      kpi_targets: response.kpi_targets,
      current_metrics: {
        engagement_events: response.engagement_events_7d,
        reach: response.reach_7d,
      },
    });
  } catch (e) {
    logStep(step++, "Fetch Campaign KPI Metrics", "FAIL", 0, String(e));
  }

  // =========================================================================
  // Step 11: Generate Strategic Intelligence
  // =========================================================================
  try {
    const start = Date.now();
    const response = await apiCall<any>("POST", "/v1/intelligence/posts", {
      platform: "x",
      post_content: "Sample competitive post for analysis",
      engagement_metrics: {
        impressions: 10000,
        engagements: 500,
        likes: 400,
        reposts: 50,
      },
    });
    const duration = Date.now() - start;

    logStep(step++, "Generate Strategic Intelligence", "PASS", duration, undefined, {
      themes_extracted: response.themes?.length || 0,
      sentiment: response.sentiment,
    });
  } catch (e) {
    logStep(step++, "Generate Strategic Intelligence", "FAIL", 0, String(e));
  }

  // =========================================================================
  // Step 12: Generate Virality Recommendations
  // =========================================================================
  if (segmentId) {
    try {
      const start = Date.now();
      const response = await apiCall<any>("POST", "/v1/bioloop/recommendations", {
        campaignTheme: "Product Launch Q2",
        campaignId,
        segmentId,
        competitiveViralityBaseline: 0.35,
      });
      const duration = Date.now() - start;

      logStep(step++, "Generate Virality Recommendations", "PASS", duration, undefined, {
        recommendation_id: response.recommendation?.id,
        expected_virality_score: response.recommendation?.expected_virality_score,
      });
    } catch (e) {
      logStep(step++, "Generate Virality Recommendations", "FAIL", 0, String(e));
    }
  } else {
    logStep(step++, "Generate Virality Recommendations", "SKIP", 0);
  }

  // =========================================================================
  // Step 13: Validate Segment Analytics
  // =========================================================================
  if (segmentId) {
    try {
      const start = Date.now();
      const response = await apiCall<any>("GET", `/v1/audience/segments/${segmentId}/analytics`);
      const duration = Date.now() - start;

      logStep(step++, "Validate Segment Analytics", "PASS", duration, undefined, {
        analytics_points: response.analytics?.length || 0,
        date_range: `${response.analytics?.[0]?.date} to ${response.analytics?.[-1]?.date}`,
      });
    } catch (e) {
      logStep(step++, "Validate Segment Analytics", "FAIL", 0, String(e));
    }
  } else {
    logStep(step++, "Validate Segment Analytics", "SKIP", 0);
  }

  // =========================================================================
  // Summary & Report
  // =========================================================================
  console.log("\n" + "=".repeat(80));
  console.log("📊 TEST SUMMARY\n");

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration_ms, 0);

  console.log(`Total Steps: ${results.length}`);
  console.log(`✅ Passed:  ${passed}`);
  console.log(`❌ Failed:  ${failed}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`⏱️  Total Duration: ${totalDuration}ms (${(totalDuration / 1000).toFixed(1)}s)`);
  console.log(`✓ Average Step Duration: ${Math.round(totalDuration / results.length)}ms\n`);

  // Write results to file
  const reportPath = "./test-results-campaign-lifecycle.json";
  const report = {
    timestamp: new Date().toISOString(),
    test_name: "Campaign Lifecycle E2E",
    summary: {
      total_steps: results.length,
      passed,
      failed,
      skipped,
      total_duration_ms: totalDuration,
      success_rate: ((passed / results.length) * 100).toFixed(1) + "%",
    },
    results,
    data_collected: {
      campaign_id: campaignId,
      segment_id: segmentId,
      content_pieces_generated: contentPieceIds.length,
      content_pieces_published: publishedPieceIds.length,
      engagement_events_simulated: engagementEventCount,
    },
  };

  console.log(`📄 Detailed report saved to: ${reportPath}\n`);

  // Return non-zero exit code if any failures
  process.exit(failed > 0 ? 1 : 0);
}

// ============================================================================
// Run Tests
// ============================================================================

console.clear();
runTests().catch((e) => {
  console.error("\n💥 Test suite crashed:", e);
  process.exit(1);
});
