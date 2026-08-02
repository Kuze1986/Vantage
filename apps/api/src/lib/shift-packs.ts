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
    description: "Seven-day product launch cadence for The Shift workforce OS.",
    items: [
      {
        id: "lw-1",
        title: "Queue chaos → calm",
        outline: "Hook on pharmacy queue overwhelm; show Mode switch to Sweep.",
        visual_type: "product_still",
        demoforge_template_id: "shift-product-stills",
        primary_channel: "x",
      },
      {
        id: "lw-2",
        title: "UBE demo reel",
        outline: "60s narrated walkthrough of Unified Business Environment.",
        visual_type: "demo_video",
        demoforge_template_id: "shift-ube-university-demo",
        primary_channel: "linkedin",
      },
      {
        id: "lw-3",
        title: "Before / after ops",
        outline: "Contrast spreadsheet chaos vs Shift live board.",
        visual_type: "social_graphic",
        primary_channel: "instagram",
      },
      {
        id: "lw-4",
        title: "Manager POV",
        outline: "How supervisors see coverage gaps before they become callouts.",
        visual_type: "demo_video",
        demoforge_template_id: "shift-queue-modes",
        primary_channel: "linkedin",
      },
      {
        id: "lw-5",
        title: "Reddit AMA teaser",
        outline: "Honest take on retail pharmacy tech — invite questions.",
        visual_type: "none",
        primary_channel: "reddit",
      },
      {
        id: "lw-6",
        title: "Mode rotation stills",
        outline: "Labeled stills across Queue / Sweep / Focus modes.",
        visual_type: "product_still",
        demoforge_template_id: "shift-product-stills",
        primary_channel: "x",
      },
      {
        id: "lw-7",
        title: "CTA: book a pilot",
        outline: "Close the week with a direct pilot CTA for operators.",
        visual_type: "social_graphic",
        primary_channel: "linkedin",
      },
    ],
  },
  {
    id: "shift-evergreen-core",
    name: "Shift Evergreen Core",
    description: "Recyclable always-on pillars: reliability, coverage, and clarity.",
    items: [
      {
        id: "eg-1",
        title: "Reliability > hustle",
        outline: "Argue that schedule reliability beats heroic overtime.",
        visual_type: "demo_video",
        demoforge_template_id: "shift-queue-modes",
        primary_channel: "linkedin",
      },
      {
        id: "eg-2",
        title: "Coverage as a product",
        outline: "Frame coverage as a product surface, not a spreadsheet.",
        visual_type: "product_still",
        demoforge_template_id: "shift-product-stills",
        primary_channel: "x",
      },
      {
        id: "eg-3",
        title: "One board for the floor",
        outline: "Single source of truth for floor leads mid-shift.",
        visual_type: "demo_video",
        demoforge_template_id: "shift-ube-university-demo",
        primary_channel: "threads",
      },
      {
        id: "eg-4",
        title: "Callout recovery",
        outline: "How Shift shortens the loop from callout to covered shift.",
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
        outline: "Micro-demo of Sweep clearing a jammed queue.",
        visual_type: "demo_video",
        demoforge_template_id: "shift-queue-reel",
        primary_channel: "tiktok",
      },
      {
        id: "sp-2",
        title: "Quote the floor",
        outline: "Operator quote graphic on clarity during rush.",
        visual_type: "social_graphic",
        primary_channel: "instagram",
      },
      {
        id: "sp-3",
        title: "Numbers that matter",
        outline: "Time-to-cover metric story without vanity vanity.",
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
