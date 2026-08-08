import { describe, expect, it } from "vitest";
import {
  escapeControlCharsInStrings,
  extractJsonArray,
  extractJsonObject,
  insertMissingCommas,
  LlmJsonError,
  repairJson,
  stripTrailingCommas,
} from "./llm-json.js";

describe("llm-json / the production failure", () => {
  it("recovers the missing comma that killed a campaign launch", () => {
    // Verbatim shape of the failure: `Expected ',' or '}' after property value
    // in JSON at position 48` — the model omitted the comma after the hook.
    const raw = `{"hook": "The Shift Is Live — Meet the Queue"\n "script": "One deploy. Seven mini-games."}`;
    expect(() => JSON.parse(raw)).toThrow(/Expected ',' or '}'/);
    const out = extractJsonObject(raw, "Kuze");
    expect(out.hook).toBe("The Shift Is Live — Meet the Queue");
    expect(out.script).toBe("One deploy. Seven mini-games.");
  });
});

describe("llm-json / extraction", () => {
  it("parses clean JSON untouched", () => {
    expect(extractJsonObject('{"body":"hello"}')).toEqual({ body: "hello" });
  });

  it("strips markdown fences", () => {
    expect(extractJsonObject('```json\n{"body":"hi"}\n```')).toEqual({ body: "hi" });
    expect(extractJsonObject('```\n{"body":"hi"}\n```')).toEqual({ body: "hi" });
  });

  it("ignores prose either side of the object", () => {
    expect(extractJsonObject('Sure! Here you go:\n{"body":"hi"}\nHope that helps.')).toEqual({ body: "hi" });
  });

  it("handles arrays for the caption path", () => {
    expect(extractJsonArray<string>('["a","b"]')).toEqual(["a", "b"]);
    expect(extractJsonArray<string>('```json\n["a","b"]\n```')).toEqual(["a", "b"]);
  });
});

describe("llm-json / repairs are safe", () => {
  it("escapes raw newlines inside strings but not structural whitespace", () => {
    const out = extractJsonObject('{\n  "body": "line one\nline two"\n}');
    expect(out.body).toBe("line one\nline two");
  });

  it("drops trailing commas before a closer", () => {
    expect(extractJsonObject('{"a":"1","b":"2",}')).toEqual({ a: "1", b: "2" });
    expect(extractJsonArray('["a","b",]')).toEqual(["a", "b"]);
  });

  it("leaves commas that live inside prose alone", () => {
    const out = extractJsonObject('{"body":"one, two, three"}');
    expect(out.body).toBe("one, two, three");
  });

  it("does not invent a comma inside a sentence containing a quoted phrase", () => {
    // The missing-comma repair anchors on `"…" "key":`. A quoted phrase mid-value
    // must not trigger it.
    const json = '{"body":"we call it \\"the queue\\" internally","tag":"x"}';
    expect(extractJsonObject(json)).toEqual({ body: 'we call it "the queue" internally', tag: "x" });
  });

  it("is a no-op on already-valid JSON", () => {
    const clean = '{"a":"1","b":["x","y"],"c":{"d":"2"}}';
    expect(repairJson(clean)).toBe(clean);
  });

  it("escapes tabs and carriage returns too", () => {
    expect(escapeControlCharsInStrings('{"a":"x\ty"}')).toBe('{"a":"x\\ty"}');
    expect(escapeControlCharsInStrings('{"a":"x\ry"}')).toBe('{"a":"x\\ry"}');
  });

  it("respects escape sequences when tracking string boundaries", () => {
    // A trailing backslash-escaped quote must not be read as closing the string.
    const json = '{"a":"ends with a quote \\"","b":"2"}';
    expect(extractJsonObject(json)).toEqual({ a: 'ends with a quote "', b: "2" });
  });

  it("stripTrailingCommas ignores commas before a closer inside a string", () => {
    expect(stripTrailingCommas('{"a":"x,}"}')).toBe('{"a":"x,}"}');
  });

  it("insertMissingCommas only fires between a value and a following key", () => {
    expect(insertMissingCommas('{"a":"1" "b":"2"}')).toBe('{"a":"1", "b":"2"}');
    // No following key — nothing inserted.
    expect(insertMissingCommas('{"a":"1"}')).toBe('{"a":"1"}');
  });
});

describe("llm-json / diagnosability", () => {
  it("carries the raw payload so the failure can be logged or retried", () => {
    const raw = "not json at all";
    try {
      extractJsonObject(raw, "Kuze");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LlmJsonError);
      expect((err as LlmJsonError).raw).toBe(raw);
      expect((err as LlmJsonError).message).toMatch(/Kuze returned no JSON object/);
    }
  });

  it("reports position and surrounding context for an unrepairable payload", () => {
    // Unterminated string: nothing safe can fix this.
    const raw = '{"a": "unterminated, "b": 3, "c": }';
    try {
      extractJsonObject(raw, "Ilita");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LlmJsonError);
      const e = err as LlmJsonError;
      expect(e.message).toMatch(/Ilita returned malformed JSON/);
      expect(e.context.length).toBeGreaterThan(0);
      expect(e.raw).toBe(raw);
    }
  });
});
