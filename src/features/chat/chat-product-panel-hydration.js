import { resolveProductCheckoutProduct } from "../../services/product-search-service.js";
import { normalizePaymentMethods } from "../../../shared/payment-methods.js";
import { parseProductPayload, updateProductPanel } from "./chat-product-panel-renderer.js";
import { retainAvailableDiscountOfferIds } from "./chat-product-panel-discounts.js";
import { applyProductPanelDiscountSelections } from "./chat-product-panel-discount-selection-state.js";
import { hasFreshSizeChartResolution } from "./chat-product-refresh-policy.js";

export async function hydrateProductPanelCheckout(root, product = {}, onProductChange, {
  language = "",
  openClass = "product-open",
  siteSlug = "",
  guestMode = false,
} = {}) {
  const currentSiteSlug = normalizeSiteSlug(siteSlug || root?.dataset?.productPanelSiteSlug);
  if (!currentSiteSlug || !shouldHydrateProductCheckout(product, currentSiteSlug, guestMode)) return;
  const requestedCharacterId = guestMode ? "" : String(product.characterId || "").trim();
  const requestedMessageId = guestMode ? "" : String(product.messageId || "").trim();
  const hasDiscountContext = Boolean(requestedCharacterId && requestedMessageId);
  const characterId = hasDiscountContext ? requestedCharacterId : "";
  const messageId = hasDiscountContext ? requestedMessageId : "";
  const productHydrationKey = buildProductHydrationKey(product, currentSiteSlug);
  if (!productHydrationKey) return;
  const hydrationKey = `${productHydrationKey}:${characterId}:${messageId}`;
  root.dataset.productPanelCheckoutHydrationKey = hydrationKey;
  const shouldHydrate = shouldHydrateProductCheckout(product, currentSiteSlug, guestMode);
  const isRetryingFailedCheckout = product.checkoutResolutionStatus === "failed";
  if (shouldHydrate || isRetryingFailedCheckout) {
    const loadingProduct = { ...parseProductPayload(root.dataset.productPanelProduct), checkoutResolutionStatus: "loading" };
    updateProductPanel(root, loadingProduct, { language });
    onProductChange?.(loadingProduct);
  }
  try {
    const result = await resolveProductCheckoutProduct({
      siteSlug: currentSiteSlug,
      characterId,
      messageId,
      product: { ...product, siteSlug: currentSiteSlug },
    });
    if (!document.body.classList.contains(openClass)) return;
    if (root.dataset.productPanelCheckoutHydrationKey !== hydrationKey) return;
    const currentProduct = parseProductPayload(root.dataset.productPanelProduct);
    if (buildProductHydrationKey(currentProduct, currentSiteSlug) !== productHydrationKey) return;
    const item = result?.item && typeof result.item === "object" ? result.item : {};
    const paymentMethods = normalizePaymentMethods(item.paymentMethods || item.payment_methods);
    const checkoutState = buildResolvedCheckoutState(currentProduct, item);
    const resolvedSizes = checkoutState.sizes;
    const resolvedOffers = guestMode
      ? []
      : Array.isArray(item.discountOffers) ? item.discountOffers : currentProduct.discountOffers;
    const nextProduct = applyProductPanelDiscountSelections(root, prepareProductForGuest({
      ...currentProduct,
      sizes: resolvedSizes.length ? resolvedSizes : currentProduct.sizes,
      purchaseMode: checkoutState.purchaseMode,
      url: checkoutState.url,
      paymentMethods,
      customizationOptions: Array.isArray(item.customizationOptions) && item.customizationOptions.length
        ? item.customizationOptions
        : currentProduct.customizationOptions || [],
      sizeChart: item.sizeChart || currentProduct.sizeChart || null,
      sizeChartResolved: item.sizeChartResolved === true || currentProduct.sizeChartResolved === true,
      discountOffers: resolvedOffers,
      selectedDiscountOfferIds: retainAvailableDiscountOfferIds(currentProduct.selectedDiscountOfferIds, resolvedOffers, currentProduct.selectedDiscountOfferId),
      selectedDiscountOfferId: "",
      checkoutResolutionStatus: checkoutState.checkoutReady ? "ready" : "failed",
    }, guestMode), currentSiteSlug);
    updateProductPanel(root, nextProduct, { language });
    onProductChange?.(nextProduct);
  } catch {
    if ((!shouldHydrate && !isRetryingFailedCheckout) || !document.body.classList.contains(openClass)) return;
    if (root.dataset.productPanelCheckoutHydrationKey !== hydrationKey) return;
    const failedProduct = { ...parseProductPayload(root.dataset.productPanelProduct), checkoutResolutionStatus: "failed" };
    updateProductPanel(root, failedProduct, { language });
    onProductChange?.(failedProduct);
  }
}

export function mergeProductDynamicRefresh(currentProduct = {}, refreshedProduct = {}, { analytics = {} } = {}) {
  return {
    ...currentProduct,
    priceNow: refreshedProduct.priceNow || refreshedProduct.price || currentProduct.priceNow || currentProduct.price || "",
    price: refreshedProduct.price || currentProduct.price || "",
    priceWas: refreshedProduct.priceWas || currentProduct.priceWas || "",
    paymentMethods: normalizePaymentMethods(refreshedProduct.paymentMethods || refreshedProduct.payment_methods || currentProduct.paymentMethods),
    customizationOptions: Array.isArray(refreshedProduct.customizationOptions)
      ? refreshedProduct.customizationOptions
      : currentProduct.customizationOptions || [],
    sizeChart: refreshedProduct.sizeChart || currentProduct.sizeChart || null,
    sizeChartResolved: refreshedProduct.sizeChartResolved === true || currentProduct.sizeChartResolved === true,
    livePriceFetchedAt: refreshedProduct.livePriceFetchedAt || currentProduct.livePriceFetchedAt || "",
    analytics,
    selectedSizeIndex: currentProduct.selectedSizeIndex,
    isResolvingPrice: false,
  };
}

export function prepareProductForCurrentSite(product = {}, siteSlug = "") {
  const currentSiteSlug = normalizeSiteSlug(siteSlug);
  const productSiteSlug = normalizeSiteSlug(product.siteSlug);
  if (!currentSiteSlug || !productSiteSlug || productSiteSlug === currentSiteSlug) return product;
  const next = {
    ...product,
    paymentMethods: [],
    discountOffers: [],
    selectedDiscountOfferId: "",
  };
  if (Object.prototype.hasOwnProperty.call(product, "selectedDiscountOfferIds")) next.selectedDiscountOfferIds = [];
  return next;
}

export function prepareProductForGuest(product = {}, guestMode = false) {
  if (!guestMode) return product;
  const next = {
    ...product,
    code: "",
    discountCode: "",
    discountOffers: [],
    selectedDiscountOfferId: "",
  };
  if (Object.prototype.hasOwnProperty.call(product, "selectedDiscountOfferIds")) next.selectedDiscountOfferIds = [];
  return next;
}

export function isSameProductPayload(left = {}, right = {}) {
  const leftScope = normalizeProductScope(left);
  const rightScope = normalizeProductScope(right);
  if (leftScope && rightScope && leftScope !== rightScope) return false;

  const leftId = normalizeProductIdentity(left.productId || left.id);
  const rightId = normalizeProductIdentity(right.productId || right.id);
  if (leftId && rightId) return leftId === rightId;

  const leftUrl = normalizeProductIdentity(left.url);
  const rightUrl = normalizeProductIdentity(right.url);
  if (leftUrl && rightUrl) return leftUrl === rightUrl;

  const leftName = normalizeProductIdentity(left.name);
  const rightName = normalizeProductIdentity(right.name);
  return Boolean(leftName && rightName && leftName === rightName);
}

export function normalizeSiteSlug(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 96);
}

export function shouldHydrateProductCheckout(product = {}, siteSlug = "", guestMode = false) {
  const currentSiteSlug = normalizeSiteSlug(siteSlug);
  if (!currentSiteSlug) return false;
  const productSiteSlug = normalizeSiteSlug(product.siteSlug);
  if (productSiteSlug && productSiteSlug !== currentSiteSlug) return true;
  if (product.checkoutResolutionStatus === "failed") return true;
  const needsDiscountOffers = !guestMode && Boolean(String(product.characterId || "").trim() && String(product.messageId || "").trim());
  return needsVariantCheckout(product)
    || needsDiscountOffers
    || !hasFreshSizeChartResolution(product)
    || normalizePaymentMethods(product.paymentMethods || product.payment_methods).length === 0;
}

export function buildResolvedCheckoutState(currentProduct = {}, resolvedProduct = {}) {
  const resolvedSizes = Array.isArray(resolvedProduct.sizes) ? resolvedProduct.sizes : [];
  const sizes = resolvedSizes.length ? resolvedSizes : (Array.isArray(currentProduct.sizes) ? currentProduct.sizes : []);
  const purchaseMode = String(resolvedProduct.purchaseMode || currentProduct.purchaseMode || "").trim();
  const url = String(resolvedProduct.url || currentProduct.url || "").trim();
  const effectiveProduct = { ...currentProduct, sizes, purchaseMode, url };
  const requiresVariantCheckout = needsVariantCheckout(effectiveProduct);
  const checkoutReady = !requiresVariantCheckout || (
    sizes.length > 0
    && sizes.every((size) => size?.variantId && size?.buyUrl)
  );
  return { sizes, purchaseMode, url, checkoutReady };
}

function needsVariantCheckout(product = {}) {
  if (product.purchaseMode === "product_detail" && String(product.url || "").trim()) return false;
  const sizes = Array.isArray(product.sizes) ? product.sizes : [];
  return sizes.length === 0 || sizes.some((size) => !size?.variantId || !size?.buyUrl);
}

function buildProductHydrationKey(product = {}, siteSlug = "") {
  const currentSiteSlug = normalizeSiteSlug(siteSlug);
  const identity = normalizeProductIdentity(product.productId || product.id)
    || normalizeProductIdentity(product.url)
    || normalizeProductIdentity(product.name);
  return currentSiteSlug && identity ? `${currentSiteSlug}:${identity}` : "";
}

function normalizeProductScope(product = {}) {
  return normalizeProductIdentity(product.siteSlug || product.siteId);
}

function normalizeProductIdentity(value = "") {
  return String(value || "").trim().toLowerCase();
}
