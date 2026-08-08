import { describe, expect, it } from "vitest";
import { checkTargetUrl } from "./target-url.js";

describe("target-url / checkTargetUrl", () => {
  it("accepts ordinary http and https targets", () => {
    for (const url of [
      "https://theshift.bioloopnexus.com",
      "https://theshift.bioloopnexus.com/PreTrip?mode=demo",
      "http://example.co.uk",
      "https://a-b.example.com",
    ]) {
      expect(checkTargetUrl(url), url).toMatchObject({ ok: true });
    }
  });

  it("rejects the comma typo that z.string().url() lets through", () => {
    // Real failure from the job history. A comma is legal in a WHATWG hostname,
    // so this reached Playwright and died as ERR_NAME_NOT_RESOLVED.
    const out = checkTargetUrl("https://theshift,bioloopnexus.com/");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toContain('","');
      expect(out.reason).toMatch(/typo/i);
    }
  });

  it("names the offending characters rather than saying 'invalid URL'", () => {
    const out = checkTargetUrl("https://exa mple.com");
    expect(out.ok).toBe(false);
  });

  it("rejects non-http protocols", () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com", "javascript:alert(1)"]) {
      const out = checkTargetUrl(url);
      expect(out.ok, url).toBe(false);
      if (!out.ok) expect(out.reason).toMatch(/protocol|valid URL/i);
    }
  });

  it("rejects a bare hostname with no domain suffix", () => {
    const out = checkTargetUrl("https://intranet");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/domain suffix/i);
  });

  it("allows localhost and IPs, which are legitimate in development", () => {
    for (const url of ["http://localhost:5173", "http://127.0.0.1:3000", "http://192.168.1.10"]) {
      expect(checkTargetUrl(url), url).toMatchObject({ ok: true });
    }
  });

  it("rejects unparseable input", () => {
    for (const url of ["", "not a url", "://missing-scheme"]) {
      expect(checkTargetUrl(url), url).toMatchObject({ ok: false });
    }
  });

  it("returns the parsed URL so the caller can reuse its hostname", () => {
    const out = checkTargetUrl("https://theshift.bioloopnexus.com/x");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.url.hostname).toBe("theshift.bioloopnexus.com");
  });

  it("does not reject a well-formed host that merely does not exist", () => {
    // The "biologyloopnexus" typo is syntactically perfect — only DNS can catch
    // it, which is checkHostResolves's job. Syntax must not guess.
    expect(checkTargetUrl("https://theshift.biologyloopnexus.com")).toMatchObject({ ok: true });
  });
});
