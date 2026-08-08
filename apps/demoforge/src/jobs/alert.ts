/**
 * Failure alerting for the DemoForge worker.
 *
 * Mirrors `apps/api/src/lib/alert.ts` — same channels, same precedence, same
 * throttle — but lives here because DemoForge is a **separate Railway service**
 * and cannot import from `@vantage/api`. Without this, a render could fail
 * silently: the API's `sendAlert` is only ever reached from the publish
 * scheduler, so job failures reached nobody despite the feature being
 * documented.
 *
 * Deliberately alerts only when a job is tied to a content piece. An untethered
 * job is usually an operator experimenting in the DemoForge page, where the
 * failure is already on screen; a job with a piece behind it is a campaign asset
 * that will silently miss its slot.
 */

const lastAlertSent = new Map<string, number>();
const THROTTLE_MS = 60 * 60_000; // one hour per key, matching the API helper

/** Reset between tests. Not used in production. */
export function __resetAlertThrottle(): void {
  lastAlertSent.clear();
}

export async function sendJobFailureAlert(opts: {
  jobId: string;
  contentPieceId?: string;
  workspaceId?: string;
  targetFormat?: string;
  error: string;
}): Promise<void> {
  // A job with no piece behind it is an operator's own experiment — the error is
  // already visible in the UI, and alerting on it would train people to ignore
  // the channel.
  if (!opts.contentPieceId) return;

  // Throttle per workspace, not per job: a broken template fails every job in a
  // campaign launch, and one alert about that is useful where forty is noise.
  const key = `demoforge:${opts.workspaceId ?? "unknown"}`;
  const last = lastAlertSent.get(key) ?? 0;
  if (Date.now() - last < THROTTLE_MS) {
    console.log(`[alert] throttled (${key}): job ${opts.jobId} failed`);
    return;
  }
  lastAlertSent.set(key, Date.now());

  const subject = `DemoForge job failed (${opts.jobId.slice(0, 8)}…)`;
  const body = [
    `job:       ${opts.jobId}`,
    `piece:     ${opts.contentPieceId}`,
    `workspace: ${opts.workspaceId ?? "unknown"}`,
    `format:    ${opts.targetFormat ?? "unknown"}`,
    "",
    opts.error.slice(0, 800),
  ].join("\n");

  const slackUrl = process.env.ALERT_SLACK_WEBHOOK?.trim();
  const alertEmail = process.env.ALERT_EMAIL?.trim();
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const fromAddr = process.env.RESEND_FROM_ADDRESS?.trim();

  if (slackUrl) {
    try {
      const res = await fetch(slackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `*${subject}*\n\`\`\`${body.slice(0, 2000)}\`\`\`` }),
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

  if (alertEmail && resendKey && fromAddr) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: fromAddr,
          to: alertEmail,
          subject: `[Vantage Alert] ${subject}`,
          html: `<pre style="font-family:monospace;font-size:12px">${body.replace(/</g, "&lt;")}</pre>`,
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

  console.error(`[ALERT] ${subject}\n${body}`);
}
