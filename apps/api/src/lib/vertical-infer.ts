/**
 * Infer a Shift career pack from a topic's text.
 *
 * `topics.vertical` was NULL on every Scripta- and campaign-sourced row, so Kuze
 * received "Vertical: general" for topics that were unambiguously CNA, EMT, or
 * pharmacy ("Catheter Care and Bowel/Bladder Assistance", "Chest Trauma,
 * Abdominal Injuries & Spinal Management"). Thirteen career packs' worth of
 * targeting was being discarded at the point it mattered most.
 *
 * Slugs match the values already present in `topics.vertical` from the Shift
 * ingestion path (`pharmacy-tech`, `phlebotomy`, `hvac`, `cna`, …), which in turn
 * follow the pack ids in RxBlitz `src/lib/contentPacks.js`.
 *
 * This is a heuristic and deliberately conservative: it returns null rather than
 * guess. A wrong vertical is worse than none, because the generator will happily
 * write pharmacy framing onto an HVAC topic.
 */

/** Ordered — the first pack whose pattern matches wins, so put distinctive terms first. */
const VERTICAL_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['phlebotomy', /\b(phlebotom|venipunctur|capillary punctur|order of draw|evacuated tube|tourniquet|centrifugation|aliquot|hemolys)/i],
  ['medical-billing', /\b(hcpcs|cpt cod|icd-10|icd-9|medical cod|medical billing|claim scrub|superbill|modifier \d|revenue cycle|clearinghouse)/i],
  ['dental-assistant', /\b(dental|operatory|amalgam|dentition|periodont|prophylaxis|coronal polish|oral radiograph)/i],
  ['emt', /\b(emt|nremt|prehospital|paramedic|ems operations|trauma assessment|spinal management|ambulance|triage|hazmat)/i],
  ['cna', /\b(cna|nurse aide|nursing assistant|nnaap|adls?|activities of daily living|catheter care|perineal care|bed bath|transfers and assistive|bathing, grooming|ambulation)/i],
  ['medical-assistant', /\b(medical assistant|cma\b|rma\b|vital signs|phlebotomy tray|clinical rooming|body systems overview)/i],
  ['cdl', /\b(cdl\b|commercial driv|pre-?trip|air brake|walkaround|hours of service|cargo securement|tractor|trailer)/i],
  ['hvac', /\b(hvac|epa 608|refrigerant|refrigeration|superheat|subcool|condenser|evaporator coil|btu\/h|charging a system)/i],
  ['electrician', /\b(electrician|journeyman|\bnec\b|national electrical code|conduit|box fill|conductor amp|panelboard|one-?line diagram)/i],
  ['cybersecurity', /\b(cybersecurity|comptia|security\+|siem|threat hunt|phishing|incident response|zero trust|vulnerability scan)/i],
  ['architecture', /\b(\bare 5\.0\b|ncarb|\bpcm\b|\bpjm\b|\bppd\b|\bpdd\b|architectural practice|project management for architect)/i],
  ['ube', /\b(\bube\b|bar exam|\bmbe\b|\bmee\b|\bmpt\b|civil procedure|constitutional law|torts|contracts and sales)/i],
  // Pharmacy last: its vocabulary (drug, dose, patient) is broad enough to
  // false-positive on other clinical packs, so let those claim their topics first.
  // Note the dash class: real lesson titles use an en-dash ("Schedule I–V"), so a
  // plain hyphen in the pattern silently misses them.
  ['pharmacy-tech', /\b(pharmac|ptce|excpt|ptcb|sterile compound|cleanroom|usp 797|usp 800|hazardous drug|dispens|prescription|\bdaw\b|adjudicat|schedule i{1,3}[-–—]?v\b|controlled substance|high-?alert medication|drug naming|medication error|npta|formulary)/i],
];

/**
 * Best-effort pack slug for a topic, or null when nothing matches confidently.
 * Never throws — callers treat null as "unknown", which is the prior behaviour.
 */
export function inferVertical(topicText: string | null | undefined): string | null {
  if (!topicText) return null;
  const text = topicText.slice(0, 2000);
  for (const [slug, pattern] of VERTICAL_PATTERNS) {
    if (pattern.test(text)) return slug;
  }
  return null;
}

/** All slugs this module can produce — used by the backfill and by tests. */
export const INFERABLE_VERTICALS: readonly string[] = VERTICAL_PATTERNS.map(([slug]) => slug);
