/**
 * Tolerant JSON extraction for LLM output.
 *
 * Models are asked for strict JSON and mostly comply, but "mostly" fails a
 * campaign launch. Observed in production: a generation died on
 * `Expected ',' or '}' after property value in JSON at position 48` — the model
 * had simply omitted a comma between two properties. The old extractor did one
 * naive `JSON.parse` and threw the payload away, so the failure was neither
 * recoverable nor diagnosable: no log carried what the model actually said.
 *
 * Three layers, cheapest first:
 *   1. Parse as-is.
 *   2. Repair the faults models actually make, then parse again.
 *   3. Fail with the position, the surrounding characters, and the raw text —
 *      enough to tell a prompt bug from a model blip without a reproduction.
 *
 * Repairs are deliberately conservative. Every one is anchored on structure that
 * cannot occur inside a valid JSON string, so none can corrupt well-formed
 * content. Anything ambiguous is left for the caller's retry instead of guessed
 * at — silently rewriting a customer's copy would be worse than a clean error.
 */

export class LlmJsonError extends Error {
  /** The model's raw output, so callers can log or feed it back for a retry. */
  readonly raw: string;
  /** Character offset of the parse failure, when the engine reported one. */
  readonly position: number | null;
  /** The characters either side of the failure. */
  readonly context: string;

  constructor(message: string, raw: string, position: number | null, context: string) {
    super(message);
    this.name = "LlmJsonError";
    this.raw = raw;
    this.position = position;
    this.context = context;
  }
}

/** V8 reports `... at position N`; other engines may not. */
function parsePosition(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /at position (\d+)/.exec(msg);
  return m ? Number(m[1]) : null;
}

function contextAround(text: string, position: number | null, span = 60): string {
  if (position == null) return text.slice(0, 2 * span);
  const from = Math.max(0, position - span);
  const to = Math.min(text.length, position + span);
  return `${from > 0 ? "…" : ""}${text.slice(from, to)}${to < text.length ? "…" : ""}`;
}

/** Strip markdown fences and slice to the outermost braces. */
function isolate(text: string, open: "{" | "[", close: "}" | "]"): string | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = trimmed.indexOf(open);
  const end = trimmed.lastIndexOf(close);
  if (start === -1 || end === -1 || end < start) return null;
  return trimmed.slice(start, end + 1);
}

/**
 * Escape raw control characters that appear *inside* string literals.
 *
 * A literal newline in a JSON string is invalid, and models emit them whenever
 * the copy itself is multi-line. Tracking string state means we only touch
 * characters between quotes — structural whitespace is left alone.
 */
export function escapeControlCharsInStrings(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString) {
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
    }
    out += ch;
  }
  return out;
}

/**
 * Remove commas that precede a closing brace or bracket.
 *
 * Only applied outside strings, so a trailing comma inside prose survives.
 */
export function stripTrailingCommas(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === "\\") { out += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    if (!inString && ch === ",") {
      const rest = json.slice(i + 1);
      // Comma followed only by whitespace then a closer is trailing.
      if (/^\s*[}\]]/.test(rest)) continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Insert commas the model forgot between members.
 *
 * Anchored on `"…" <whitespace> "key":` — a string value, then a new key. That
 * shape is only ever legal with a comma between, so inserting one cannot change
 * the meaning of valid JSON. This is the exact fault that broke the campaign
 * launch.
 */
export function insertMissingCommas(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === "\\") { out += ch; escaped = true; continue; }
    if (ch === '"') {
      // Closing quote of a value: look ahead for a new key with no comma between.
      if (inString) {
        const ahead = json.slice(i + 1);
        if (/^\s+"(?:[^"\\]|\\.)*"\s*:/.test(ahead)) {
          out += '",';
          inString = false;
          continue;
        }
      }
      inString = !inString;
      out += ch;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Apply every safe repair, cheapest first. */
export function repairJson(json: string): string {
  return insertMissingCommas(stripTrailingCommas(escapeControlCharsInStrings(json)));
}

function attempt<T>(candidate: string): { ok: true; value: T } | { ok: false; err: unknown } {
  try {
    return { ok: true, value: JSON.parse(candidate) as T };
  } catch (err) {
    return { ok: false, err };
  }
}

/**
 * Parse a JSON object out of an LLM response, repairing what can be repaired
 * safely. Throws `LlmJsonError` with diagnostics when it cannot.
 */
export function extractJsonObject(text: string, label = "LLM"): Record<string, unknown> {
  return extract<Record<string, unknown>>(text, "{", "}", label);
}

/** As `extractJsonObject`, for responses that should be a JSON array. */
export function extractJsonArray<T = unknown>(text: string, label = "LLM"): T[] {
  return extract<T[]>(text, "[", "]", label);
}

function extract<T>(text: string, open: "{" | "[", close: "}" | "]", label: string): T {
  const isolated = isolate(text, open, close);
  if (isolated === null) {
    throw new LlmJsonError(
      `${label} returned no JSON ${open === "{" ? "object" : "array"}`,
      text,
      null,
      text.slice(0, 200),
    );
  }

  const direct = attempt<T>(isolated);
  if (direct.ok) return direct.value;

  const repaired = attempt<T>(repairJson(isolated));
  if (repaired.ok) return repaired.value;

  const position = parsePosition(repaired.err);
  const message = repaired.err instanceof Error ? repaired.err.message : String(repaired.err);
  throw new LlmJsonError(
    `${label} returned malformed JSON (${message})`,
    text,
    position,
    contextAround(isolated, position),
  );
}
