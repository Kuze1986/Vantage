import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { tagUrls } from "../lib/utm.js";

const RESEND_BASE = "https://api.resend.com";

function requireEnv(): { apiKey: string; fromAddress: string } {
  const apiKey      = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM_ADDRESS;
  if (!apiKey || !fromAddress) {
    throw new Error("Email channel not configured: set RESEND_API_KEY and RESEND_FROM_ADDRESS");
  }
  return { apiKey, fromAddress };
}

export async function sendEmail(workspaceId: string, params: {
  subject: string;
  html: string;
  to?: string[];      // if omitted, sends to all active subscribers
  pieceId?: string;  // when set, UTM-tags all links in the HTML body
}): Promise<{ id: string; recipient_count: number }> {
  const { apiKey, fromAddress } = requireEnv();
  const sb = getSupabaseAdmin();

  let recipients = params.to ?? [];
  if (recipients.length === 0) {
    // Pull this workspace's active subscribers from newsletter_subscribers
    const { data, error } = await sb
      .from("newsletter_subscribers")
      .select("email")
      .eq("workspace_id", workspaceId)
      .is("unsubscribed_at", null);
    if (error) throw new Error(`Failed to load subscribers: ${error.message}`);
    recipients = (data ?? []).map((r: { email: string }) => r.email);
  }

  if (recipients.length === 0) {
    throw new Error("No active email subscribers — add subscribers to vantage.newsletter_subscribers");
  }

  // 3A-2: Apply UTM tags to all links in the HTML body if a pieceId is provided
  const html = params.pieceId
    ? tagUrls(params.html, "email", params.pieceId)
    : params.html;

  // Resend supports batch sends via /emails/batch or individual sends.
  // For lists < 100 we'll use the batch endpoint.
  const payload = recipients.map((to) => ({
    from: fromAddress,
    to,
    subject: params.subject,
    html,
  }));

  const res = await fetch(`${RESEND_BASE}/emails/batch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const detail = JSON.stringify(json).slice(0, 300);
    await logActivity({ source: "adapter:email", source_type: "adapter", event_type: "send_failed", summary: detail, payload: json });
    throw new Error(`Resend batch failed: ${res.status} ${detail}`);
  }

  const data = (json.data as { id?: string }[] | undefined) ?? [];
  const firstId = data[0]?.id ?? "batch";
  await logActivity({
    source: "adapter:email",
    source_type: "adapter",
    event_type: "send_success",
    summary: `Email batch sent to ${recipients.length} recipients`,
    payload: { recipient_count: recipients.length, first_id: firstId },
  });

  return { id: firstId, recipient_count: recipients.length };
}

export async function subscriberCount(workspaceId: string): Promise<number> {
  const sb = getSupabaseAdmin();
  const { count } = await sb.from("newsletter_subscribers").select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("unsubscribed_at", null);
  return count ?? 0;
}
