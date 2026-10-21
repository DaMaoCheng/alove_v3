import { publicProductCandidateFields } from "../shared/product-candidate-fields.js";
import { normalizePaymentMethods } from "../shared/payment-methods.js";

const PRODUCT_SCALAR_FIELDS = Object.freeze([
  "id", "productId", "sku", "name", "title", "subtitle", "price", "priceNow", "priceWas", "currency",
  "stock", "available", "url", "imageUrl", "code", "discountCode", "tag", "summary",
  "siteId", "siteSlug", "campaignId", "fetchedAt", "livePriceFetchedAt", "sizeChartResolved", "purchaseMode",
]);
const SIZE_SCALAR_FIELDS = Object.freeze([
  "label", "name", "title", "available", "sku", "price", "priceWas", "currency", "variantId", "buyUrl",
]);
const SIZE_CHART_SCALAR_FIELDS = Object.freeze(["title", "fitTip", "unit"]);
const CUSTOMIZATION_SCALAR_FIELDS = Object.freeze([
  "id", "name", "type", "required", "placeholder", "price",
]);
const CUSTOMIZATION_VALUE_FIELDS = Object.freeze([
  "id", "label", "price", "imageUrl",
]);
const SEARCH_INTENT_SCALAR_FIELDS = Object.freeze([
  "query", "intent", "requestedTeam", "requestedVariant", "requestedProductType", "requestedAudience", "requestedColor",
  "requestedAgeRange", "requestedSizeProfile", "requestedSeason", "requestedPrintNumber", "searchState",
  "isCorrection", "contextSource", "explicitProductTrigger", "shouldLoadProductContext",
]);
const ANALYTICS_SCALAR_FIELDS = Object.freeze([
  "productName", "productUrl", "siteId", "siteSlug", "siteName", "position", "searchReceipt", "catalogReceipt",
]);
const DISCOUNT_OFFER_FIELDS = Object.freeze([
  "id", "code", "offerDescription", "ownershipType", "endsAt",
]);
const DISCOUNT_PRICING_PREVIEW_FIELDS = Object.freeze([
  "type", "value", "currencyCode", "marketValue", "marketCurrencyCode", "appliesOnEachItem", "eligible",
]);

export function toClientProductSearchResult(result = {}) {
  return {
    ...result,
    items: Array.isArray(result.items) ? result.items.map(toClientProductObject) : [],
  };
}

export function toClientResolvedProduct(result = {}) {
  const { sourceItem: _sourceItem, ...safeResult } = result;
  return {
    ...safeResult,
    item: toClientProductObject(result.item),
  };
}

export function toClientProduct(product = null) {
  return product && typeof product === "object" && !Array.isArray(product)
    ? toClientProductObject(product)
    : null;
}

export function toClientKitshopResult(result = {}) {
  const { adminWarning: _adminWarning, ...safeResult } = result;
  return {
    ...safeResult,
    shelves: Array.isArray(result.shelves)
      ? result.shelves.map((shelf) => ({
          ...shelf,
          items: Array.isArray(shelf?.items) ? shelf.items.map(toClientProductObject) : [],
        }))
      : [],
  };
}

function toClientProductObject(product = {}) {
  if (!product || typeof product !== "object" || Array.isArray(product)) return {};
  const safe = { ...pickScalarFields(product, PRODUCT_SCALAR_FIELDS), ...publicProductCandidateFields(product) };
  safe.imageUrls = sanitizeScalarArray(product.imageUrls, 8);
  safe.sizes = Array.isArray(product.sizes)
    ? product.sizes
        .filter((size) => size && typeof size === "object" && !Array.isArray(size))
        .map((size) => pickScalarFields(size, SIZE_SCALAR_FIELDS))
        .filter((size) => Object.keys(size).length > 0)
        .slice(0, 12)
    : [];
  safe.sizeChart = sanitizeSizeChart(product.sizeChart);
  safe.customizationOptions = Array.isArray(product.customizationOptions)
    ? product.customizationOptions
        .filter((option) => option && typeof option === "object" && !Array.isArray(option))
        .map((option) => ({
          ...pickScalarFields(option, CUSTOMIZATION_SCALAR_FIELDS),
          values: Array.isArray(option.values)
            ? option.values.map((value) => pickScalarFields(value, CUSTOMIZATION_VALUE_FIELDS)).filter((value) => value.id && value.label).slice(0, 100)
            : [],
        }))
        .filter((option) => option.id && option.name && (option.values.length || ["text", "number", "date", "email", "phone", "file"].includes(option.type)))
        .slice(0, 24)
    : [];
  safe.features = sanitizeScalarArray(product.features, 12);
  safe.paymentMethods = normalizePaymentMethods(product.paymentMethods);
  safe.discountOffers = Array.isArray(product.discountOffers)
    ? product.discountOffers
        .filter((offer) => offer && typeof offer === "object" && !Array.isArray(offer))
        .map((offer) => {
          const pricingPreview = sanitizeNestedObject(offer.pricingPreview, DISCOUNT_PRICING_PREVIEW_FIELDS);
          const combination = sanitizeDiscountCombination(offer.combination);
          return {
            ...pickScalarFields(offer, DISCOUNT_OFFER_FIELDS),
            ...(pricingPreview ? { pricingPreview } : {}),
            ...(combination ? { combination } : {}),
          };
        })
        .filter((offer) => offer.id && offer.code && offer.offerDescription)
        .slice(0, 20)
    : [];
  const searchIntent = sanitizeNestedObject(product.searchIntent, SEARCH_INTENT_SCALAR_FIELDS, {
    excludeTeams: sanitizeScalarArray(product.searchIntent?.excludeTeams, 12),
    requestedVariants: sanitizeScalarArray(product.searchIntent?.requestedVariants, 8),
    requestedFeatures: sanitizeScalarArray(product.searchIntent?.requestedFeatures, 8),
    requestedKeywords: sanitizeScalarArray(product.searchIntent?.requestedKeywords, 12),
  });
  if (searchIntent) safe.searchIntent = searchIntent;
  const analytics = sanitizeNestedObject(product.analytics, ANALYTICS_SCALAR_FIELDS);
  if (analytics) safe.analytics = analytics;
  return safe;
}

function sanitizeDiscountCombination(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const discountClasses = sanitizeScalarArray(value.discountClasses, 3)
    .map((item) => String(item || "").trim().toUpperCase())
    .filter((item) => ["PRODUCT", "ORDER", "SHIPPING"].includes(item));
  const combinesWith = value.combinesWith && typeof value.combinesWith === "object" && !Array.isArray(value.combinesWith)
    ? {
        productDiscounts: value.combinesWith.productDiscounts === true,
        orderDiscounts: value.combinesWith.orderDiscounts === true,
        shippingDiscounts: value.combinesWith.shippingDiscounts === true,
      }
    : null;
  return discountClasses.length && combinesWith ? { discountClasses, combinesWith } : null;
}

function sanitizeSizeChart(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const columns = Array.isArray(value.columns) ? value.columns.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8) : [];
  const rows = Array.isArray(value.rows)
    ? value.rows.map((row) => Array.isArray(row) ? row.map((item) => String(item || "").trim()).slice(0, columns.length) : []).filter((row) => row.length >= 2).slice(0, 24)
    : [];
  if (columns.length < 2 || !rows.length) return null;
  return { ...pickScalarFields(value, SIZE_CHART_SCALAR_FIELDS), columns, rows };
}

function sanitizeNestedObject(value, scalarFields, extra = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const safe = { ...pickScalarFields(value, scalarFields) };
  for (const [key, item] of Object.entries(extra)) {
    if (Array.isArray(item) && item.length) safe[key] = item;
  }
  return Object.keys(safe).length ? safe : null;
}

function pickScalarFields(source, fields) {
  const safe = {};
  for (const field of fields) {
    const value = source?.[field];
    if (["string", "number", "boolean"].includes(typeof value) || value === null) safe[field] = value;
  }
  return safe;
}

function sanitizeScalarArray(value, limit) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => ["string", "number", "boolean"].includes(typeof item))
    .slice(0, limit);
}
