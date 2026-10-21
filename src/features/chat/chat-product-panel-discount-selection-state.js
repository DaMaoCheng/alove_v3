import { normalizeSelectedDiscountOfferIds } from "./chat-product-panel-discounts.js";

const DATA_KEY = "productPanelDiscountSelections";

export function readProductPanelDiscountSelections(root, siteSlug = "") {
  const expectedSiteSlug = normalizeSiteSlug(siteSlug);
  try {
    const value = JSON.parse(String(root?.dataset?.[DATA_KEY] || "{}"));
    if (!value || normalizeSiteSlug(value.siteSlug) !== expectedSiteSlug) return [];
    return normalizeSelectedDiscountOfferIds(value.offerIds);
  } catch {
    return [];
  }
}

export function writeProductPanelDiscountSelections(root, siteSlug = "", offerIds = []) {
  if (!root?.dataset) return [];
  const normalized = normalizeSelectedDiscountOfferIds(offerIds);
  root.dataset[DATA_KEY] = JSON.stringify({ siteSlug: normalizeSiteSlug(siteSlug), offerIds: normalized });
  return normalized;
}

export function applyProductPanelDiscountSelections(root, product = {}, siteSlug = "") {
  const selectedIds = readProductPanelDiscountSelections(root, siteSlug);
  const availableIds = new Set((Array.isArray(product?.discountOffers) ? product.discountOffers : [])
    .map((offer) => String(offer?.id || "").trim())
    .filter(Boolean));
  const matchingIds = selectedIds.filter((id) => availableIds.has(id));
  return {
    ...product,
    selectedDiscountOfferIds: matchingIds,
    selectedDiscountOfferId: matchingIds[0] || "",
  };
}

export function updateProductPanelDiscountSelections(root, siteSlug = "", product = {}, selectedIds = []) {
  const current = readProductPanelDiscountSelections(root, siteSlug);
  const availableIds = new Set((Array.isArray(product?.discountOffers) ? product.discountOffers : [])
    .map((offer) => String(offer?.id || "").trim())
    .filter(Boolean));
  const preserved = current.filter((id) => !availableIds.has(id));
  return writeProductPanelDiscountSelections(root, siteSlug, [...preserved, ...selectedIds]);
}

function normalizeSiteSlug(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 96);
}
