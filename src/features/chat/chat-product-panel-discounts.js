import { ICONS } from "../../icons/icons.js";
import { areShopifyDiscountsPairwiseCombinable } from "../../../shared/shopify-discount-combination.js";
import { formatProductDisplayPrice, formatProductPriceForQuantity, parseProductDisplayPrice } from "./chat-product-price-format.js";

const DEFAULT_COPY = Object.freeze({
  copy: "Copy",
  copyOffer: "Copy discount code",
  selectedOffer: "Selected",
  useOffer: "Use this offer",
  estimatedDiscount: "Estimated",
  priceNote: "Final price is shown at checkout.",
  estimatedPriceNote: "Estimated discounted price. Final price is shown at checkout.",
});

export function normalizeDiscountOffers(value = []) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .filter((offer) => offer && typeof offer === "object" && !Array.isArray(offer))
    .map((offer) => ({
      id: String(offer.id || "").trim(),
      code: String(offer.code || "").trim(),
      offerDescription: String(offer.offerDescription || "").trim(),
      ownershipType: String(offer.ownershipType || "").trim(),
      endsAt: String(offer.endsAt || "").trim(),
      combination: normalizeDiscountCombination(offer.combination),
      pricingPreview: normalizeDiscountPricingPreview(offer.pricingPreview),
    }))
    .filter((offer) => offer.id && offer.code && offer.offerDescription)
    .filter((offer) => {
      const key = offer.code.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

export function normalizeProductDiscountOffers(product = {}) {
  const source = product && typeof product === "object" ? product : {};
  const offers = Array.isArray(source.discountOffers) ? [...source.discountOffers] : [];
  const legacyCode = String(source.code || source.discountCode || "").trim();
  if (legacyCode) {
    offers.push({
      id: `legacy:${legacyCode.toLowerCase()}`,
      code: legacyCode,
      offerDescription: "Product offer",
    });
  }
  return normalizeDiscountOffers(offers);
}

export function resolveSelectedDiscountOfferIds(currentIds = [], requestedId = "", offers = []) {
  return resolveDiscountOfferSelection(currentIds, requestedId, offers).ids;
}

export function resolveDiscountOfferSelection(currentIds = [], requestedId = "", offers = []) {
  const current = normalizeSelectedDiscountOfferIds(currentIds);
  const requested = String(requestedId || "").trim();
  const normalizedOffers = normalizeDiscountOffers(offers);
  if (!requested || !normalizedOffers.some((offer) => offer.id === requested)) return { ids: current, replaced: false };
  if (current.includes(requested)) return { ids: current.filter((id) => id !== requested), replaced: false };
  const next = [...current, requested].sort().slice(0, 5);
  if (isDiscountOfferSelectionCombinable(current, requested, normalizedOffers)) return { ids: next, replaced: false };
  const compatibleExisting = current.filter((id) => isDiscountOfferSelectionCombinable(
    current.filter((candidate) => candidate === id), requested, normalizedOffers,
  ));
  const replacement = [requested, ...compatibleExisting].sort().slice(0, 5);
  return { ids: replacement, replaced: true };
}

export function isDiscountOfferSelectionCombinable(currentIds = [], requestedId = "", offers = []) {
  const current = normalizeSelectedDiscountOfferIds(currentIds);
  const requested = String(requestedId || "").trim();
  const normalizedOffers = normalizeDiscountOffers(offers);
  if (!requested || current.includes(requested) || current.length >= 5) return true;
  const selected = [...current, requested]
    .map((id) => normalizedOffers.find((offer) => offer.id === id))
    .filter(Boolean);
  return selected.length === current.length + 1 && areShopifyDiscountsPairwiseCombinable(selected);
}

export function resolveSelectedDiscountOfferId(currentId = "", requestedId = "", offers = []) {
  const requested = String(requestedId || "").trim();
  if (!requested || !normalizeDiscountOffers(offers).some((offer) => offer.id === requested)) return String(currentId || "").trim();
  return String(currentId || "").trim() === requested ? "" : requested;
}

export function normalizeSelectedDiscountOfferIds(value = [], legacyValue = "") {
  const values = Array.isArray(value) && value.length
    ? value
    : value && !Array.isArray(value)
      ? [value]
      : legacyValue ? [legacyValue] : [];
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))].sort().slice(0, 5);
}

export function retainAvailableDiscountOfferIds(selectedIds = [], offers = [], legacyValue = "") {
  const available = new Set(normalizeDiscountOffers(offers).map((offer) => offer.id));
  return normalizeSelectedDiscountOfferIds(selectedIds, legacyValue).filter((id) => available.has(id));
}

export function retainAvailableDiscountOffer(selectedId = "", offers = []) {
  return retainAvailableDiscountOfferIds(selectedId ? [selectedId] : [], offers)[0] || "";
}

export function renderProductDiscountOffers(container, list, value = [], selectedIds = [], copy = DEFAULT_COPY) {
  const offers = normalizeDiscountOffers(value);
  const selected = new Set(normalizeSelectedDiscountOfferIds(selectedIds));
  if (!container || !list) return;
  container.hidden = !offers.length;
  list.innerHTML = offers.map((offer) => {
    const isSelected = selected.has(offer.id);
    return `
      <article class="pp-offer${isSelected ? " is-selected" : ""}" data-product-discount-offer-id="${escapeHtml(offer.id)}">
        <div class="pp-offer-main">
          <strong>${escapeHtml(offer.code)}</strong>
          <span>${escapeHtml(offer.offerDescription === "Product offer" ? (copy.offerDefault || offer.offerDescription) : offer.offerDescription)}</span>
        </div>
        <div class="pp-offer-actions">
          <button type="button" class="pp-offer-copy" data-product-discount-copy="${escapeHtml(offer.code)}" aria-label="${escapeHtml(copy.copyOffer || DEFAULT_COPY.copyOffer)}" data-copy-label="${escapeHtml(copy.copyOffer || DEFAULT_COPY.copyOffer)}" data-copied-label="${escapeHtml(copy.copied || DEFAULT_COPY.selectedOffer)}"><span class="pp-offer-copy-icon pp-offer-copy-default">${ICONS.copy}</span><span class="pp-offer-copy-icon pp-offer-copy-done">${ICONS.check}</span></button>
          <button type="button" class="pp-offer-use" data-product-discount-use="${escapeHtml(offer.id)}" aria-pressed="${isSelected ? "true" : "false"}">${escapeHtml(isSelected ? (copy.selectedOffer || DEFAULT_COPY.selectedOffer) : (copy.useOffer || DEFAULT_COPY.useOffer))}</button>
        </div>
      </article>`;
  }).join("");
}

export function renderProductPrice(product = {}, copy = DEFAULT_COPY, { quantity = 1 } = {}) {
  const displayQuantity = normalizeDisplayQuantity(quantity);
  const discounted = calculateSelectedDiscountPrice(product, { quantity: displayQuantity });
  if (discounted) {
    return {
      discounted: true,
      html: `<span class="now">${escapeHtml(discounted.formatted)}</span><span class="was">${escapeHtml(discounted.baseFormatted)}</span><span class="estimate">${escapeHtml(copy.estimatedDiscount || DEFAULT_COPY.estimatedDiscount)}</span>`,
    };
  }
  const now = product.priceNow ? `<span class="now">${escapeHtml(formatProductPriceForQuantity(product.priceNow, displayQuantity))}</span>` : "";
  const was = product.priceWas ? `<span class="was">${escapeHtml(formatProductPriceForQuantity(product.priceWas, displayQuantity))}</span>` : "";
  return { discounted: false, html: `${now}${was}` };
}

export function updateProductPanelPricePreview(root, product = {}, copy = DEFAULT_COPY) {
  if (!root) return;
  const priceView = renderProductPrice(product, copy, {
    quantity: root.dataset?.productPanelQuantity,
  });
  const price = root.querySelector("[data-product-panel-price]");
  const footPrice = root.querySelector("[data-product-panel-foot-price]");
  const priceNote = root.querySelector("[data-product-panel-price-note]");
  if (price) price.innerHTML = priceView.html;
  if (footPrice) footPrice.innerHTML = priceView.html;
  if (priceNote) priceNote.textContent = product.giveaway === true
    ? (copy.productGiveaway || "Activity conditions apply; eligibility is unverified.")
    : priceView.discounted
    ? (copy.estimatedPriceNote || DEFAULT_COPY.estimatedPriceNote)
    : (copy.priceNote || DEFAULT_COPY.priceNote);
}

export function calculateSelectedDiscountPrice(product = {}, options = {}) {
  return calculateSelectedDiscountPriceWithOptions(product, options);
}

export function calculateSelectedProductDiscountPrice(product = {}) {
  return calculateSelectedDiscountPriceWithOptions(product, { productOnly: true });
}

function calculateSelectedDiscountPriceWithOptions(product = {}, { productOnly = false, quantity = 1 } = {}) {
  const selectedIds = normalizeSelectedDiscountOfferIds(product.selectedDiscountOfferIds, product.selectedDiscountOfferId);
  const offer = resolveDetailPricePreviewOffer(product.discountOffers, selectedIds, { productOnly });
  const preview = offer?.pricingPreview;
  if (!preview?.eligible) return null;
  const selectedSizeIndex = normalizeSelectedSizeIndex(product.selectedSizeIndex, product.sizes);
  const selectedSize = selectedSizeIndex >= 0 ? product.sizes[selectedSizeIndex] : null;
  const baseFormatted = String(selectedSize?.price || product.priceNow || product.price || "").trim();
  const parsed = parseProductDisplayPrice(baseFormatted);
  if (!parsed || parsed.value <= 0) return null;
  const displayQuantity = normalizeDisplayQuantity(quantity);
  const baseValue = parsed.value * displayQuantity;
  let nextValue = 0;
  if (preview.type === "percentage") {
    nextValue = baseValue * (1 - Math.min(100, preview.value) / 100);
  } else if (preview.type === "fixed_amount") {
    const fixedAmount = resolveFixedDiscountAmountForPrice(preview, parsed, product.currency);
    if (fixedAmount == null) return null;
    nextValue = baseValue - (fixedAmount * (preview.appliesOnEachItem ? displayQuantity : 1));
  } else {
    return null;
  }
  return {
    value: Math.max(0, Math.round(nextValue * 100) / 100),
    formatted: formatProductDisplayPrice(parsed, Math.max(0, nextValue)),
    baseFormatted: formatProductDisplayPrice(parsed, baseValue),
  };
}

/**
 * A product detail only knows one product and one selected variant. Prefer one
 * product-level preview, ignore order-level or threshold codes, and never
 * invent Shopify's multi-product stacking/rounding result in the browser.
 */
function resolveDetailPricePreviewOffer(value = [], selectedIds = [], { productOnly = false } = {}) {
  const selected = new Set(normalizeSelectedDiscountOfferIds(selectedIds));
  const previewOffers = normalizeDiscountOffers(value)
    .filter((offer) => selected.has(offer.id) && offer.pricingPreview?.eligible);
  const productOffers = previewOffers.filter((offer) => offer.combination?.discountClasses?.includes("PRODUCT"));
  if (productOffers.length === 1) return productOffers[0];
  if (productOffers.length > 1) return null;
  if (productOnly) {
    return previewOffers.length === 1 && !previewOffers[0].combination ? previewOffers[0] : null;
  }
  const orderOffers = previewOffers.filter((offer) => offer.combination?.discountClasses?.includes("ORDER"));
  if (orderOffers.length === 1) return orderOffers[0];
  return previewOffers.length === 1 ? previewOffers[0] : null;
}

/**
 * Keep cross-currency amounts opt-in. The server only adds marketValue after it
 * has resolved the active Shopify market; the browser never guesses a rate.
 */
export function resolveFixedDiscountAmountForPrice(preview = {}, parsed = null, productCurrency = "") {
  if (!parsed || preview?.type !== "fixed_amount") return null;
  if (isMatchingPriceCurrency(preview.currencyCode, parsed, productCurrency)) {
    return Number.isFinite(Number(preview.value)) ? Number(preview.value) : null;
  }
  if (isMatchingPriceCurrency(preview.marketCurrencyCode, parsed, productCurrency)) {
    return Number.isFinite(Number(preview.marketValue)) ? Number(preview.marketValue) : null;
  }
  return null;
}

export function buildNoDiscountCheckoutUrl(value = "") {
  try {
    const url = new URL(String(value || ""));
    url.searchParams.set("discount", "");
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeDiscountPricingPreview(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.eligible !== true) return null;
  const type = String(value.type || "").trim();
  const numeric = Number(value.value);
  if (!["percentage", "fixed_amount"].includes(type) || !Number.isFinite(numeric) || numeric <= 0) return null;
  const marketValue = Number(value.marketValue);
  const marketCurrencyCode = String(value.marketCurrencyCode || "").trim().toUpperCase();
  return {
    type,
    value: numeric,
    currencyCode: String(value.currencyCode || "").trim().toUpperCase(),
    ...(Number.isFinite(marketValue) && marketValue > 0 && marketCurrencyCode ? { marketValue, marketCurrencyCode } : {}),
    appliesOnEachItem: value.appliesOnEachItem === true,
    eligible: true,
  };
}

function normalizeDiscountCombination(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const discountClasses = [...new Set((Array.isArray(value.discountClasses) ? value.discountClasses : [])
    .map((item) => String(item || "").trim().toUpperCase())
    .filter((item) => ["PRODUCT", "ORDER", "SHIPPING"].includes(item)))];
  const combinesWith = value.combinesWith && typeof value.combinesWith === "object" && !Array.isArray(value.combinesWith)
    ? {
        productDiscounts: value.combinesWith.productDiscounts === true,
        orderDiscounts: value.combinesWith.orderDiscounts === true,
        shippingDiscounts: value.combinesWith.shippingDiscounts === true,
      }
    : null;
  return discountClasses.length && combinesWith ? { discountClasses, combinesWith } : null;
}

function normalizeDisplayQuantity(value) {
  return Math.min(99, Math.max(1, Math.trunc(Number(value) || 1)));
}

function isMatchingPriceCurrency(currencyCode, parsed, productCurrency = "") {
  const expected = normalizeCurrencyCode(currencyCode);
  if (!expected) return false;
  const explicit = normalizeCurrencyCode(productCurrency);
  if (explicit) return explicit === expected;
  const symbol = String(parsed.currency || parsed.prefix || "").trim();
  const inferred = {
    HUF: "HUF",
    MAD: "MAD",
    "£": "GBP",
    "$": "USD",
    "€": "EUR",
    "HK$": "HKD",
    "A$": "AUD",
    "C$": "CAD",
  }[symbol] || "";
  return Boolean(inferred && inferred === expected);
}

function normalizeCurrencyCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return code === "RMB" ? "CNY" : code;
}

function normalizeSelectedSizeIndex(value, sizes = []) {
  const rows = Array.isArray(sizes) ? sizes : [];
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) return -1;
  return rows[index]?.available === false ? -1 : index;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
