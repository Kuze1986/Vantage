import { describe, it, expect } from "vitest";
import { toRedditPostId } from "./reddit-engagement.js";

// Reddit became a manual channel, so external_post_id is now whatever permalink
// the human pasted rather than the bare id the automated path stored. Both
// shapes have to keep resolving or engagement polling silently stops.
describe("toRedditPostId", () => {
  it("extracts the id from a full permalink", () => {
    expect(
      toRedditPostId("https://www.reddit.com/r/bioinformatics/comments/1a2b3c/some_title_slug/"),
    ).toBe("1a2b3c");
  });

  it("handles permalinks without a trailing slug or slash", () => {
    expect(toRedditPostId("https://reddit.com/r/test/comments/xyz789")).toBe("xyz789");
  });

  it("handles old.reddit.com and share links with query strings", () => {
    expect(toRedditPostId("https://old.reddit.com/r/test/comments/abc123/t/?utm_source=share")).toBe("abc123");
  });

  it("passes through a bare id unchanged", () => {
    expect(toRedditPostId("1a2b3c")).toBe("1a2b3c");
  });

  it("strips the t3_ fullname prefix", () => {
    expect(toRedditPostId("t3_1a2b3c")).toBe("1a2b3c");
  });

  it("trims surrounding whitespace from a pasted value", () => {
    expect(toRedditPostId("  t3_1a2b3c  ")).toBe("1a2b3c");
  });

  it("returns null for empty input", () => {
    expect(toRedditPostId("")).toBeNull();
    expect(toRedditPostId("   ")).toBeNull();
  });

  it("returns null for a non-Reddit URL rather than polling garbage", () => {
    expect(toRedditPostId("https://example.com/some/post")).toBeNull();
  });
});
