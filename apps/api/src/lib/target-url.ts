/**
 * Target-URL validation for DemoForge jobs.
 *
 * The largest *live* class of DemoForge failures is operator typos in the
 * recording target. Real examples from the job history:
 *
 *   https://theshift,bioloopnexus.com/     (comma instead of a dot)
 *   https://theshift.biologyloopnexus.com  ("biology" for "bioloop")
 *
 * Both pass `z.string().url()`. A comma is legal in a WHATWG hostname, and the
 * second is a perfectly well-formed URL that simply does not exist. Neither
 * fails until Playwright has launched and thrown ERR_NAME_NOT_RESOLVED, roughly
 * half a minute later, leaving a failed job row for someone to interpret.
 *
 * Two cheap checks up front turn that into an immediate, legible 400.
 */
import { lookup } from "node:dns/promises";

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Hostnames are letters, digits, hyphens and dots. Anything else is a typo. */
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Syntax check. Pure, so it is fully unit-testable and safe to run anywhere.
 * Deliberately does NOT restrict which hosts are reachable — narrowing that
 * (private ranges, SSRF hardening) would change what recordings are allowed and
 * belongs in its own change.
 */
export function checkTargetUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Not a valid URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `Unsupported protocol "${url.protocol}" — use http or https` };
  }

  const host = url.hostname;
  if (!host) return { ok: false, reason: "URL has no hostname" };

  // localhost and bare IPs are legitimate recording targets in development.
  if (host === "localhost" || IPV4_RE.test(host) || host.startsWith("[")) {
    return { ok: true, url };
  }

  if (!HOSTNAME_RE.test(host)) {
    // The comma case lands here — precise, because "invalid URL" would be wrong.
    const bad = [...new Set(host.split("").filter((ch) => !/[a-z0-9.-]/i.test(ch)))];
    return {
      ok: false,
      reason: bad.length
        ? `Hostname "${host}" contains ${bad.map((c) => `"${c}"`).join(", ")} — likely a typo`
        : `Hostname "${host}" is malformed`,
    };
  }

  if (!host.includes(".")) {
    return { ok: false, reason: `Hostname "${host}" has no domain suffix` };
  }

  return { ok: true, url };
}

/**
 * DNS pre-flight. Catches the well-formed-but-nonexistent host before a browser
 * is launched for it.
 *
 * Fails **open** on anything that is not a definitive "no such host": a timeout
 * or a restricted resolver in the deploy environment must not block a job whose
 * target is fine. Only ENOTFOUND / EAI_NODATA reject.
 */
export async function checkHostResolves(hostname: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    await lookup(hostname);
    return { ok: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "EAI_NODATA") {
      return { ok: false, reason: `Hostname "${hostname}" does not resolve — check the spelling` };
    }
    // Resolver unavailable, timeout, etc. Not the operator's problem.
    return { ok: true };
  }
}
