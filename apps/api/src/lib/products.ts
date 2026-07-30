/** Portfolio product slugs — matches Social Kit BrandId. */

export const PRODUCT_SLUGS = [
  "shift",
  "keystone",
  "scripta",
  "demoforge",
  "crucible",
  "vantage",
] as const;

export type ProductSlug = (typeof PRODUCT_SLUGS)[number];

export function isProductSlug(value: unknown): value is ProductSlug {
  return typeof value === "string" && (PRODUCT_SLUGS as readonly string[]).includes(value);
}

export function parseProductSlug(value: unknown, fallback: ProductSlug = "vantage"): ProductSlug {
  return isProductSlug(value) ? value : fallback;
}
