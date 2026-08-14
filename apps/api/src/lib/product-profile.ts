/**
 * Workspace product profile — defaults for campaign/DemoForge (Shift-first).
 */

import { getSupabaseAdmin } from "./supabase.js";
import { DEFAULT_BRAND_ID } from "./demoforge-templates.js";

export interface ProductProfile {
  default_product_id: string;
  product_base_url: string;
  default_brand_id: string;
  default_demoforge_template_id: string;
  default_brand_kit_id: string;
  /**
   * The link currently set in the workspace's TikTok/Instagram account bio.
   * Those platforms don't render clickable links in captions, so a resolved
   * destination (see lib/destination.ts) can't be appended to the piece the
   * way it is on every other channel — it has to already be live in the bio.
   * This is standing config the operator maintains, not a per-piece field,
   * and it exists so the UI can warn when a bio-policy channel has content
   * to promote but no configured bio link to send it to.
   */
  bio_link_url: string;
}

const DEFAULTS: ProductProfile = {
  default_product_id: "shift",
  product_base_url: process.env.SHIFT_BASE_URL?.trim() || "https://theshift.bioloopnexus.com",
  default_brand_id: DEFAULT_BRAND_ID,
  default_demoforge_template_id: "",
  default_brand_kit_id: "",
  bio_link_url: "",
};

export async function loadProductProfile(workspaceId: string): Promise<ProductProfile> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb.from("settings").select("key, value").eq("workspace_id", workspaceId);
    const map: Record<string, unknown> = {};
    for (const row of data ?? []) map[row.key as string] = row.value;

    const str = (k: keyof ProductProfile) =>
      typeof map[k] === "string" ? (map[k] as string) : DEFAULTS[k];

    return {
      default_product_id: str("default_product_id") || DEFAULTS.default_product_id,
      product_base_url: (str("product_base_url") || DEFAULTS.product_base_url).replace(/\/$/, ""),
      default_brand_id: str("default_brand_id") || DEFAULTS.default_brand_id,
      default_demoforge_template_id: str("default_demoforge_template_id"),
      default_brand_kit_id: str("default_brand_kit_id"),
      bio_link_url: str("bio_link_url"),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function patchProductProfile(
  workspaceId: string,
  patch: Partial<ProductProfile>,
): Promise<ProductProfile> {
  const sb = getSupabaseAdmin();
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    await sb.from("settings").upsert(
      {
        workspace_id: workspaceId,
        key,
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,key" },
    );
  }
  return loadProductProfile(workspaceId);
}
