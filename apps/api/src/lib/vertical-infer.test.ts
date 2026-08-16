import { describe, it, expect } from "vitest";
import { inferVertical, INFERABLE_VERTICALS } from "./vertical-infer.js";

describe("inferVertical", () => {
  it("returns null for empty or unrecognised input", () => {
    expect(inferVertical(null)).toBeNull();
    expect(inferVertical("")).toBeNull();
    expect(inferVertical("Quarterly revenue review")).toBeNull();
  });

  // The real Scripta lesson titles that shipped as untargeted "Vertical: general"
  // copy in the 2026-08-15 launch.
  it.each([
    ["Catheter Care and Bowel/Bladder Assistance", "cna"],
    ["Bathing, Grooming, and Oral Care", "cna"],
    ["Transfers and Assistive Devices", "cna"],
    ["Centrifugation and Aliquoting", "phlebotomy"],
    ["HCPCS Level II Codes", "medical-billing"],
    ["Chest Trauma, Abdominal Injuries & Spinal Management", "emt"],
    ["Hazmat, Special Rescue & EMS Operations", "emt"],
    ["Sterile Compounding, Cleanrooms, and Hazardous Drugs", "pharmacy-tech"],
    ["Schedule I–V Criteria & Drug Examples", "pharmacy-tech"],
    ["Adjudication, Rejects, DAW Overrides, and COB", "pharmacy-tech"],
    ["Medication Errors, Near Misses, and Reporting", "pharmacy-tech"],
    ["OSHA Bloodborne Pathogens Standard & Sterilization", null],
  ])("maps %j to %s", (text, expected) => {
    expect(inferVertical(text)).toBe(expected);
  });

  it("prefers the more specific pack when clinical vocabulary overlaps", () => {
    // "drug" alone would match pharmacy; the EMT terms must win.
    expect(inferVertical("Prehospital drug administration and triage")).toBe("emt");
    // Phlebotomy's order-of-draw is not a pharmacy dispensing topic.
    expect(inferVertical("Order of draw and tourniquet technique")).toBe("phlebotomy");
  });

  it("only ever returns a slug it declares", () => {
    const result = inferVertical("EPA 608 refrigerant recovery and superheat");
    expect(result).toBe("hvac");
    expect(INFERABLE_VERTICALS).toContain(result);
  });
});
