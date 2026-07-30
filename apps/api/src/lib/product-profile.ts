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
}

const DEFAULTS: ProductProfile = {
  default_product_id: "shift",
  product_base_url: process.env.SHIFT_BASE_URL?.trim() || "https://theshift.bioloopnexus.com",
  default_brand_id: DEFAULT_BRAND_ID,
  default_demoforge_template_id: "",
  default_brand_kit_id: "",
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
