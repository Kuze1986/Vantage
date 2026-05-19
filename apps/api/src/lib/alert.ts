/**
 * 3B-1: Pipeline Failure Alerting
 *
 * Sends an alert via the first configured channel:
 *   1. Slack  — ALERT_SLACK_WEBHOOK  (incoming webhook URL)
 *   2. Email  — ALERT_EMAIL + RESEND_API_KEY + RESEND_FROM_ADDRESS
 *   3. Console — always as fallback
 *
 * Throttled to max one alert per channel-key per hour to prevent spam.
 */

const lastAlertSent = new Map<string, number>(); // key → epoch ms
const THROTTLE_MS   = 60 * 60_000;               // 1 hour

export async function sendAlert(subject: string, body: string, key = "default"): Promise<void> {
  // Throttle: skip if we already alerted on this key within the window
  const last = lastAlertSent.get(key) ?? 0;
  if (Date.now() - last < THROTTLE_MS) {
    console.log(`[alert] throttled (${key}): ${subject}`);
    return;
  }
  lastAlertSent.set(key, Date.now());

  const slackUrl  = process.env.ALERT_SLACK_WEBHOOK;
  const alertEmail = process.env.ALERT_EMAIL;
  const resendKey  = process.env.RESEND_API_KEY;
  const fromAddr   = process.env.RESEND_FROM_ADDRESS;

  // Try Slack first
  if (slackUrl) {
    try {
      const res = await fetch(slackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `*${subject}*\n\`\`\`${body.slice(0, 2000)}\`\`\``,
        }),
      });
      if (res.ok) {
        console.log(`[alert] Slack sent: ${subject}`);
        return;
      }
      console.warn(`[alert] Slack failed: ${res.status}`);
    } catch (e) {
      console.warn("[alert] Slack error:", e);
    }
  }

  // Try Resend email second
  if (alertEmail && resendKey && fromAddr) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from:    fromAddr,
          to:      alertEmail,
          subject: `[Vantage Alert] ${subject}`,
          html:    `<pre style="font-family:monospace;font-size:12px">${body.replace(/</g, "&lt;")}</pre>`,
        }),
      });
      if (res.ok) {
        console.log(`[alert] Email sent to ${alertEmail}: ${subject}`);
        return;
      }
      console.warn(`[alert] Email failed: ${res.status}`);
    } catch (e) {
      console.warn("[alert] Email error:", e);
    }
  }

  // Fallback: console
  console.error(`[ALERT] ${subject}\n${body}`);
}
