import { describe, expect, it } from "vitest";
import { applyEmailWrapper, CONTENT_MARKER } from "./email-wrapper.js";
import { tagUrls } from "./utm.js";

const BODY = "<p>Hello from Kuze</p>";
const WRAPPER = `<table><tr><td>HEADER</td></tr><tr><td>${CONTENT_MARKER}</td></tr><tr><td>FOOTER</td></tr></table>`;

describe("email-wrapper", () => {
  it("splices the body into the wrapper", () => {
    const out = applyEmailWrapper(WRAPPER, BODY);
    expect(out.wrapped).toBe(true);
    expect(out.html).toContain("HEADER");
    expect(out.html).toContain(BODY);
    expect(out.html).toContain("FOOTER");
    expect(out.html).not.toContain(CONTENT_MARKER);
  });

  it("passes the body through when no wrapper is configured", () => {
    for (const empty of ["", "   ", null, undefined]) {
      const out = applyEmailWrapper(empty, BODY);
      expect(out).toMatchObject({ html: BODY, wrapped: false });
      expect(out.skippedReason).toBeUndefined();
    }
  });

  it("reports a wrapper that is configured but has no marker", () => {
    // Worth surfacing: the operator chose a wrapper and it silently did nothing.
    const out = applyEmailWrapper("<table><tr><td>no marker here</td></tr></table>", BODY);
    expect(out).toMatchObject({ html: BODY, wrapped: false, skippedReason: "no_marker" });
  });

  it("replaces every occurrence of the marker", () => {
    const out = applyEmailWrapper(`${CONTENT_MARKER}|${CONTENT_MARKER}`, "X");
    expect(out.html).toBe("X|X");
  });

  it("does not treat $ sequences in the body as replacement patterns", () => {
    // String.replace would turn $& into the matched marker; split/join must not.
    const out = applyEmailWrapper(WRAPPER, "<p>Save $100 — that's $& off</p>");
    expect(out.html).toContain("Save $100 — that's $& off");
    expect(out.html).not.toContain(CONTENT_MARKER);
  });

  it("leaves the body's own markup intact", () => {
    const rich = '<h1>Title</h1><a href="https://x.test/a">link</a>';
    expect(applyEmailWrapper(WRAPPER, rich).html).toContain(rich);
  });

  it("wrapping before UTM tagging tags the wrapper's links too", () => {
    // The ordering the adapter depends on: wrap first, then tagUrls, so footer
    // and logo links carry attribution rather than only Kuze's links.
    const wrapper = `<a href="https://brand.test/home">logo</a>${CONTENT_MARKER}<a href="https://brand.test/unsub">unsubscribe</a>`;
    const body = '<a href="https://brand.test/post">read</a>';
    const composed = applyEmailWrapper(wrapper, body).html;
    const tagged = tagUrls(composed, "email", "piece-1");

    expect(tagged.match(/utm_source=email/g)).toHaveLength(3);
    expect(tagged).toContain("utm_content=piece-1");
  });
});
