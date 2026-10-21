import { resolveProductCheckoutProduct, isSameResolvedProductIdentity } from "./product-checkout-resolver-service.js";
import { toGuestSafeProduct } from "./guest-product-sanitizer.js";
import { getServerProductOrigins } from "./product-source-provenance.js";
import { findRecentProductMessage } from "./product-intent-service.js";

export function selectCurrentProductForSizing({ site = {}, searchIntent = {}, recentMessages = [] } = {}) {
  if (searchIntent.unresolvedProductReference === true
    || (searchIntent.referencedSiteId && String(searchIntent.referencedSiteId) !== String(site.id))
    || (searchIntent.referencedSiteSlug && String(searchIntent.referencedSiteSlug) !== String(site.slug))) return null;
  if (!searchIntent.referencedProductId) return findRecentProductMessage(recentMessages)?.product || null;
  return recentMessages.slice(-12).reverse().map((message) => message.product).find((product) => product?.name
    && String(product.productId || product.id || "") === String(searchIntent.referencedProductId)
    && String(product.siteId || product.site_id || "") === String(site.id)
    && String(product.siteSlug || product.site_slug || "") === String(site.slug)) || null;
}

export function sanitizeProductSizingChart(chart) {
  return toGuestSafeProduct({ sizeChart: chart }).sizeChart;
}

export async function resolveTrustedCurrentProductSizing({ site = {}, product = {}, resolveProduct = resolveProductCheckoutProduct } = {}) {
  const fallback = { ...product, sizeChart: null, sizeChartResolved: false };
  if (!site?.id || !site.slug || String(product.siteId || product.site_id || "") !== String(site.id)
    || String(product.siteSlug || product.site_slug || "") !== String(site.slug)) return fallback;
  if (!isSameResolvedProductIdentity(product, product)) return fallback;
  if (product.sizeChartResolved === true) {
    const chart = sanitizeProductSizingChart(product.sizeChart);
    if (!product.sizeChart || chart) return { ...product, sizeChart: chart, sizeChartResolved: true };
  }
  if (!product.productId && !product.id && !product.url) return fallback;
  try {
    const result = await resolveProduct({ siteSlug: site.slug, product, strictSite: true, exactProduct: true });
    const source = result?.sourceItem;
    if (result?.resolvedFromSource !== true || String(result.site?.id || "") !== String(site.id)
      || String(result.site?.slug || "") !== String(site.slug) || !source || !isSameResolvedProductIdentity(product, source)) return fallback;
    // URL-only identity additionally requires a configured or server-verified
    // storefront origin; the merged/client item never grants provenance.
    if (!(product.productId || product.id) || !(source.productId || source.id)) {
      const origin = new URL(product.url).origin;
      const allowed = new Set(getServerProductOrigins(result));
      for (const url of [site.site_url, site.siteUrl, site.storefrontUrl, result.site.siteUrl, result.site.storefrontUrl]) {
        try { allowed.add(new URL(url).origin); } catch { /* absent site origin */ }
      }
      if (!allowed.has(origin)) return fallback;
    }
    const chart = sanitizeProductSizingChart(source.sizeChart);
    if (source.sizeChartResolved !== true || (source.sizeChart && !chart)) return fallback;
    return { ...product, sizes: Array.isArray(source.sizes) ? source.sizes : product.sizes, sizeChart: chart, sizeChartResolved: true };
  } catch { return fallback; }
}

export function formatTrustedProductSizingFacts(product = {}) {
  const safe = toGuestSafeProduct({ ...product, sizes: Array.isArray(product.sizes) ? product.sizes.map((size) => typeof size === "string" ? { label: size } : size) : [] });
  const labels = safe.sizes.map((size) => `${size.label} [${size.available === true ? "available" : size.available === false ? "not available" : "availability unverified"}]`).join(", ");
  const facts = [safe.name ? `Verified product: ${safe.name}.` : "", labels ? `Listed size labels: ${labels}.` : "No verified size labels supplied."];
  if (product.sizeChartResolved !== true || (product.sizeChart && !safe.sizeChart)) return [...facts, "Size chart is not verified; lookup was not completed or failed. Do not infer that this product has no chart."].filter(Boolean).join("\n");
  if (!safe.sizeChart) return [...facts, "The source lookup completed without returning a verified size chart. Do not infer measurements or guarantee fit."].filter(Boolean).join("\n");
  const chart = safe.sizeChart;
  return [...facts, `Verified size chart: ${chart.title}.`, chart.unit ? `Explicit chart units: ${chart.unit}.` : "Chart units were not supplied. Do not assume units.", chart.columns.join(" | "), ...chart.rows.map((row) => row.join(" | ")), "Use only these product-specific measurements and stated units; do not guarantee fit."].filter(Boolean).join("\n");
}
