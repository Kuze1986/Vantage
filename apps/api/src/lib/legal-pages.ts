import { getSupabaseAdmin } from "./supabase.js";

export type LegalSlug = "terms" | "privacy";
const VALID_SLUGS: readonly LegalSlug[] = ["terms", "privacy"];

export function isLegalSlug(slug: string): slug is LegalSlug {
  return (VALID_SLUGS as readonly string[]).includes(slug);
}

export type LegalPage = {
  slug: LegalSlug;
  title: string;
  content: string;
  updated_at: string;
};

export async function getLegalPage(slug: LegalSlug): Promise<LegalPage | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("legal_pages").select("*").eq("slug", slug).single();
  if (error || !data) return null;
  return data as LegalPage;
}

export async function updateLegalPage(
  slug: LegalSlug,
  patch: { title?: string; content?: string },
  userId: string,
): Promise<LegalPage> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("legal_pages")
    .update({ ...patch, updated_by: userId })
    .eq("slug", slug)
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to update legal page");
  return data as LegalPage;
}
