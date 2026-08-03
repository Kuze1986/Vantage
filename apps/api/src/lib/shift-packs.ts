/**
 * Curated Shift content packs — seed timeline days for campaigns.
 */

export type ShiftPackItem = {
  id: string;
  title: string;
  outline: string;
  visual_type: "demo_video" | "product_still" | "social_graphic" | "none";
  demoforge_template_id?: string;
  primary_channel?: string;
};

export type ShiftPack = {
  id: string;
  name: string;
  description: string;
  items: ShiftPackItem[];
};

export const SHIFT_PACKS: ShiftPack[] = [
  {
    id: "shift-launch-week",
    name: "Shift Launch Week",
    description:
      "Seven-day mode showcase for The Shift, now live — one card per day, " +
      "matching exactly the modes on the public landing page and in the live Queue " +
      "(Matrix, Blueprints, The Sweep, Minefield, The Drop, The Callback, Polarity). " +
      "Ascending pressure order per queueModes.ts, closing on Polarity.",
    items: [
      {
        id: "lw-1",
        title: "THE MATRIX — structure the setup",
        outline: "The Shift is live. First mode of the week: every tile has a home — lock the clean structure before the volley resets it.",
        visual_type: "demo_video",
        demoforge_template_id: "shift-queue-modes",
        primary_channel: "x",
      },
      {
        id: "lw-2",
        title: "BLUEPRINTS — rebuild the procedure",
        outline: "A real workflow, scrambled into steps. Rebuild it in the correct order or the sequence breaks.",
        visual_type: "demo_video",
        demoforge_template_id: "shift-queue-modes",
        primary_channel: "linkedin",
      },
      {
        id: "lw-3",
        title: "THE SWEEP — zone-by-zone defect hunt",
        outline: "The ladder's prestige close. Walk the full schematic, flag the fault before the shift ends.",
        visual_type: "demo_video",
        demoforge_template_id: "shift-queue-modes",
        primary_channel: "linkedin",
      },
      {
        id: "lw-4",
        title: "MINEFIELD — clear the grid",
        outline: "A full grid, one wrong cell and the breach fails. Navigate it clean.",
        visual_type: "demo_video",
        demoforge_template_id: "shift-queue-modes",
        primary_channel: "instagram",
      },
      {
        id: "lw-5",
        title: "THE DROP — react before it fades",
        outline: "The term is already falling. Match it before it crosses the line. Highest-pressure mode in the ladder.",
        visual_type: "demo_video",
        demoforge_template_id: "shift-queue-modes",
        primary_channel: "tiktok",
      },
      {
        id: "lw-6",
        title: "THE CALLBACK — delayed consequences",
        outline: "The call comes in after the shift's already moved on. Commit to a decision, then live with how it lands.",
        visual_type: "demo_video",
        demoforge_template_id: "shift-queue-modes",
        primary_channel: "bluesky",
      },
      {
        id: "lw-7",
        title: "POLARITY — secure the network",
        outline: "Node by node, answer the volley or the link drops. Closing mode of the week — The Shift is live now, deploy your first Queue.",
        visual_type: "demo_video",
        demoforge_template_id: "shift-queue-modes",
        primary_channel: "reddit",
      },
    ],
  },
  {
    id: "shift-evergreen-core",
    name: "Shift Evergreen Core",
    description:
      "Recyclable always-on pillars: scenario training over flashcards, vertical breadth, " +
      "and a zero-barrier free tier.",
    items: [
      {
        id: "eg-1",
        title: "Scenario training beats flashcards",
        outline: "Argue that decision-based Queue missions build real recall where static flashcards don't.",
        visual_type: "demo_video",
        demoforge_template_id: "shift-queue-modes",
        primary_channel: "linkedin",
      },
      {
        id: "eg-2",
        title: "13 credentials, one engine",
        outline: "Mode-rotation stills across verticals — same engine, different exam.",
        visual_type: "product_still",
        demoforge_template_id: "shift-product-stills",
        primary_channel: "x",
      },
      {
        id: "eg-3",
        title: "Operator tier: free, no card",
        outline: "Zero-barrier entry point — three deploys a day, no credit card, upgrade only when ready.",
        visual_type: "none",
        primary_channel: "threads",
      },
      {
        id: "eg-4",
        title: "Deploys build the habit",
        outline: "Daily-deploy framing — the habit compounds faster than a weekend cram.",
        visual_type: "none",
        primary_channel: "bluesky",
      },
    ],
  },
  {
    id: "shift-social-proof",
    name: "Shift Social Proof",
    description: "Short proof-oriented posts for social amplification.",
    items: [
      {
        id: "sp-1",
        title: "30-second Sweep",
        outline: "Micro-demo of The Sweep — zone-by-zone defect hunt, straight through to the schematic close.",
        visual_type: "demo_video",
        demoforge_template_id: "shift-queue-reel",
        primary_channel: "tiktok",
      },
      {
        id: "sp-2",
        title: "Quote from the Queue",
        outline: "Operator quote graphic on staying clear-headed under exam pressure.",
        visual_type: "social_graphic",
        primary_channel: "instagram",
      },
      {
        id: "sp-3",
        title: "Numbers that matter",
        outline: "Mastery-readiness stat callout — time-to-confidence, not vanity streaks.",
        visual_type: "none",
        primary_channel: "x",
      },
    ],
  },
];

export function listShiftPacks(): ShiftPack[] {
  return SHIFT_PACKS;
}

export function getShiftPack(packId: string): ShiftPack | undefined {
  return SHIFT_PACKS.find((p) => p.id === packId);
}
