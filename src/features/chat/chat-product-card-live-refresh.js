import { resolveProductCheckoutProduct } from "../../services/product-search-service.js";
import { parseProductPayload } from "./chat-product-impressions.js";
import { createSiteCopy } from "../../i18n/site-copy.js";
import {
  hasFreshProductSnapshot,
  PRODUCT_DYNAMIC_REFRESH_TTL_MS,
} from "./chat-product-refresh-policy.js";

const PRODUCT_CARD_REFRESH_CACHE_KEY = "aiove_product_card_live_refresh_v2";
const productCardRefreshRequests = new Map();

export function bindProductCardLiveRefresh(root, { pageLanguage = "English" } = {}) {
  const cards = [...root.querySelectorAll(".product-card[data-product]")].filter((card) => {
    const product = parseProductPayload(card.dataset.product);
    return Boolean(getProductRefreshKey(product));
  });
  if (!cards.length) return;

  if (!("IntersectionObserver" in window)) {
    cards.forEach((card) => refreshProductCard(card, pageLanguage));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      refreshProductCard(entry.target, pageLanguage);
    });
  }, {
    root: root.querySelector("#chatBody") || null,
    threshold: 0.01,
  });

  cards.forEach((card) => observer.observe(card));
  window.requestAnimationFrame(() => {
    cards.forEach((card) => {
      if (!isElementVisibleInChat(root, card)) return;
      observer.unobserve(card);
      refreshProductCard(card, pageLanguage);
    });
  });
}

function isElementVisibleInChat(root, element) {
  const container = root.querySelector("#chatBody");
  if (!container || !element) return false;
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  return elementRect.bottom >= containerRect.top && elementRect.top <= containerRect.bottom;
}

async function refreshProductCard(card, pageLanguage = "English") {
  const cardProduct = parseProductPayload(card.dataset.product);
  const analytics = parseProductPayload(card.dataset.productAnalytics);
  const product = {
    ...cardProduct,
    siteSlug: cardProduct.siteSlug || analytics.siteSlug || "",
    siteId: cardProduct.siteId || analytics.siteId || "",
    productId: cardProduct.productId || analytics.productId || "",
  };
  const refreshKey = getProductRefreshKey(product);
  if (!refreshKey) return;

  if (hasFreshProductSnapshot(product)) {
    writeCachedProduct(refreshKey, product);
    applyProductCardRefresh(card, product);
    return;
  }

  const cachedProduct = readCachedProduct(refreshKey);
  if (cachedProduct) {
    applyProductCardRefresh(card, cachedProduct);
    return;
  }

  setProductCardPriceLoading(card, pageLanguage);
  try {
    const refreshedProduct = await resolveLiveProductOnce(refreshKey, product);
    if (!refreshedProduct) {
      restoreProductCardPrice(card, product);
      return;
    }
    applyProductCardRefresh(card, refreshedProduct);
  } catch {
    restoreProductCardPrice(card, product);
  }
}

async function resolveLiveProductOnce(refreshKey, product) {
  if (productCardRefreshRequests.has(refreshKey)) {
    return productCardRefreshRequests.get(refreshKey);
  }
  const request = resolveProductCheckoutProduct({
    siteSlug: product.siteSlug || "",
    product,
  }).then((result) => {
    const item = result?.item && typeof result.item === "object" ? result.item : null;
    if (item) writeCachedProduct(refreshKey, item);
    return item;
  }).finally(() => {
    productCardRefreshRequests.delete(refreshKey);
  });
  productCardRefreshRequests.set(refreshKey, request);
  return request;
}

function applyProductCardRefresh(card, nextProduct = {}) {
  if (!nextProduct || typeof nextProduct !== "object") return;
  const currentProduct = parseProductPayload(card.dataset.product);
  const mergedProduct = {
    ...currentProduct,
    ...buildDynamicProductPatch(currentProduct, nextProduct),
  };
  card.dataset.product = JSON.stringify(mergedProduct);

  const analytics = parseProductPayload(card.dataset.productAnalytics);
  card.dataset.productAnalytics = JSON.stringify({
    ...analytics,
    productId: mergedProduct.productId || mergedProduct.id || analytics.productId || "",
    productTitle: currentProduct.name || analytics.productTitle || "",
    productUrl: currentProduct.url || analytics.productUrl || "",
  });

  updateProductCardPrice(card, mergedProduct);
  card.dispatchEvent(new CustomEvent("aiove:product-card-live-refresh", {
    bubbles: true,
    detail: {
      product: mergedProduct,
      analytics: parseProductPayload(card.dataset.productAnalytics),
    },
  }));
}

export function buildDynamicProductPatch(currentProduct = {}, nextProduct = {}) {
  return {
    priceNow: nextProduct.priceNow || nextProduct.price || currentProduct.priceNow || currentProduct.price || "",
    price: nextProduct.price || currentProduct.price || "",
    priceWas: nextProduct.priceWas || currentProduct.priceWas || "",
    paymentMethods: Array.isArray(nextProduct.paymentMethods)
      ? nextProduct.paymentMethods
      : (Array.isArray(currentProduct.paymentMethods) ? currentProduct.paymentMethods : []),
    sizeChart: Object.prototype.hasOwnProperty.call(nextProduct, "sizeChart")
      ? nextProduct.sizeChart
      : currentProduct.sizeChart || null,
    sizeChartResolved: nextProduct.sizeChartResolved === true || currentProduct.sizeChartResolved === true,
    livePriceFetchedAt: nextProduct.livePriceFetchedAt || currentProduct.livePriceFetchedAt || "",
  };
}

function setProductCardPriceLoading(card, pageLanguage = "English") {
  const price = ensureProductCardPriceNode(card);
  if (!price) return;
  const copy = createSiteCopy(pageLanguage);
  price.innerHTML = `<span class="pc-price-loading" aria-label="${escapeAttribute(copy.t("product.updatingPrice"))}"><i></i></span>`;
}

function restoreProductCardPrice(card, product = {}) {
  updateProductCardPrice(card, product);
}

function updateProductCardPrice(card, product = {}) {
  const price = ensureProductCardPriceNode(card);
  if (!price) return;
  const hasPrice = Boolean(product.priceNow || product.priceWas);
  if (!hasPrice) {
    price.remove();
    return;
  }
  price.textContent = "";
  if (product.priceNow) {
    const now = document.createElement("span");
    now.className = "now";
    now.textContent = product.priceNow;
    price.append(now);
  }
  if (product.priceWas) {
    const was = document.createElement("span");
    was.className = "was";
    was.textContent = product.priceWas;
    price.append(was);
  }
}

function ensureProductCardPriceNode(card) {
  const body = card.querySelector(".pc-body");
  if (!body) return null;
  let price = body.querySelector(".pc-price");
  if (!price) {
    price = document.createElement("div");
    price.className = "pc-price";
    const code = body.querySelector(".pc-code");
    if (code) {
      body.insertBefore(price, code);
    } else {
      const button = body.querySelector(".btn");
      body.insertBefore(price, button || null);
    }
  }
  return price;
}

function getProductRefreshKey(product = {}) {
  const siteSlug = String(product.siteSlug || product.siteId || "").trim().toLowerCase();
  const productId = String(product.productId || product.id || "").trim().toLowerCase();
  const url = String(product.url || "").trim().toLowerCase();
  const name = String(product.name || "").trim().toLowerCase();
  const identity = productId || url || name;
  if (!siteSlug || !identity) return "";
  return `${siteSlug}:${identity}`;
}

function readCachedProduct(key) {
  const cache = readRefreshCache();
  const entry = cache[key];
  if (!entry || Number(entry.expiresAt || 0) <= Date.now()) return null;
  return entry.product && typeof entry.product === "object" ? entry.product : null;
}

function writeCachedProduct(key, product) {
  if (!key || !product || typeof product !== "object") return;
  const cache = pruneRefreshCache(readRefreshCache());
  cache[key] = {
    expiresAt: Date.now() + PRODUCT_DYNAMIC_REFRESH_TTL_MS,
    product,
  };
  writeRefreshCache(cache);
}

function readRefreshCache() {
  try {
    const raw = window.localStorage?.getItem(PRODUCT_CARD_REFRESH_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    return cache && typeof cache === "object" ? cache : {};
  } catch {
    return {};
  }
}

function writeRefreshCache(cache) {
  try {
    window.localStorage?.setItem(PRODUCT_CARD_REFRESH_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cache failures should not block chat rendering.
  }
}

function pruneRefreshCache(cache) {
  const now = Date.now();
  return Object.fromEntries(Object.entries(cache || {}).filter(([, entry]) => Number(entry?.expiresAt || 0) > now).slice(-50));
}

function escapeAttribute(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
