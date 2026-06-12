import { describe, it, expect } from "vitest";
import { engagementKind } from "./growth.js";

describe("engagementKind", () => {
  it.each(["reply", "quote", "mention", "comment"])(
    "maps interaction-class event '%s' to reply",
    (t) => expect(engagementKind(t)).toBe("reply"),
  );

  it("is case-insensitive", () => {
    expect(engagementKind("REPLY_created")).toBe("reply");
    expect(engagementKind("PostComment")).toBe("reply");
  });

  it.each(["like", "favorite", "impression", "retweet", "view"])(
    "maps impression-class event '%s' to impression",
    (t) => expect(engagementKind(t)).toBe("impression"),
  );
});
