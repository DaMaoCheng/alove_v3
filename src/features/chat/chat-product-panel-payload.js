import { publicProductCandidateFields } from "../../../shared/product-candidate-fields.js";
import { normalizeAssetUrl } from "../shared-ui/character-avatar.js";

const FALLBACK_PRODUCT_IMAGE = "/assets/jersey_product.png";
const PANEL_SCALAR_FIELDS = Object.freeze([
  "id",
  "productId",
  "handle",
  "variantId",
  "sku",
  "name",
  "title",
  "subtitle",
  "price",
  "priceNow",
  "priceWas",
  "currency",
  "stock",
  "available",
  "url",
  "code",
  "discountCode",
  "tag",
  "summary",
  "description",
  "siteId",
  "siteSlug",
  "siteUrl",
  "campaignId",
  "fetchedAt",
  "livePriceFetchedAt",
  "sizeChartResolved",
  "selectedSizeIndex",
  "selectedDiscountOfferId",
  "selectedDiscountOfferIds",
  "checkoutResolutionStatus",
  "purchaseMode",
  "commerceEnabled",
  "isResolvingPrice",
  "imageIndex",
  "language",
  "languageCode",
  "languageLabel",
]);

export function normalizeProductPanelPayload(product = {}, {
  normalizedImageUrl = "",
  site = {},
  chatContext = null,
} = {}) {
  const source = product && typeof product === "object" && !Array.isArray(product) ? product : {};
  const imageUrls = normalizeProductPanelImageUrls(source, normalizedImageUrl);
  const payload = {
    ...pickProductFields(source),
    ...publicProductCandidateFields(source),
    id: source.id || source.productId || "",
    productId: source.productId || source.id || "",
    name: source.name || source.title || "Product",
    subtitle: source.subtitle || source.summary || source.stock || "",
    imageUrl: imageUrls[0] || FALLBACK_PRODUCT_IMAGE,
    imageUrls,
    priceNow: source.priceNow || source.price || "",
    priceWas: source.priceWas || "",
    summary: source.summary || source.description || "",
    url: source.url || "",
    siteLogoUrl: source.siteLogoUrl || source.siteIconUrl || source.logoUrl || source.iconUrl || site?.logoUrl || "",
    siteUrl: source.siteUrl || site?.siteUrl || site?.storefrontUrl || "",
    siteId: source.siteId || site?.id || "",
    siteSlug: source.siteSlug || site?.slug || "",
    paymentMethods: arrayOrFallback(source.paymentMethods, site?.paymentMethods),
    commerceEnabled: source.commerceEnabled !== false && site?.commerceEnabled !== false,
    sizes: arrayOrEmpty(source.sizes),
    sizeChart: objectOrEmpty(source.sizeChart),
    customizationOptions: arrayOrEmpty(source.customizationOptions),
    customizationSelections: objectOrEmpty(source.customizationSelections),
    features: arrayOrEmpty(source.features),
    discountOffers: arrayOrEmpty(source.discountOffers),
    analytics: objectOrEmpty(source.analytics),
  };

  if (!chatContext) return payload;
  const message = objectOrEmpty(chatContext.message);
  const character = objectOrEmpty(chatContext.character);
  return {
    ...payload,
    messageId: source.messageId || message.id || "",
    characterId: source.characterId || message.characterId || character.id || "",
    characterName: source.characterName || character.name || "",
    ownerUserId: source.ownerUserId || character.ownerUserId || character.ownerUid || "",
  };
}

export function normalizeProductPanelImageUrls(product = {}, normalizedImageUrl = "") {
  const rows = Array.isArray(product?.imageUrls) ? product.imageUrls : [];
  const images = [
    normalizedImageUrl,
    product?.imageUrl,
    ...rows,
  ].map((url) => normalizeAssetUrl(url || "")).filter(Boolean);
  return [...new Set(images)];
}

function arrayOrFallback(primary, fallback) {
  if (Array.isArray(primary)) return primary;
  return Array.isArray(fallback) ? fallback : [];
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function pickProductFields(source = {}) {
  const payload = {};
  for (const field of PANEL_SCALAR_FIELDS) {
    const value = source[field];
    if (["string", "number", "boolean"].includes(typeof value) || value === null) {
      payload[field] = value;
    }
  }
  return payload;
}
