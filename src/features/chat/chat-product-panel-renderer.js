import { ICONS } from "../../icons/icons.js";
import { createSiteCopy } from "../../i18n/site-copy.js";
import { normalizeAssetUrl } from "../shared-ui/character-avatar.js";
import { bindSiteBrandImage } from "../shared-ui/site-branding.js";
import { getSiteBranding } from "../../services/site-branding-service.js";
import { PAYMENT_METHOD_OPTIONS, normalizePaymentMethods } from "../../../shared/payment-methods.js";
import {
  buildNoDiscountCheckoutUrl,
  calculateSelectedDiscountPrice,
  normalizeDiscountOffers,
  normalizeProductDiscountOffers,
  renderProductDiscountOffers,
  renderProductPrice,
  resolveSelectedDiscountOfferId,
  resolveSelectedDiscountOfferIds,
  normalizeSelectedDiscountOfferIds,
  retainAvailableDiscountOfferIds,
  updateProductPanelPricePreview,
} from "./chat-product-panel-discounts.js";
import {
  hasIncompleteRequiredCustomization,
  normalizeCustomizationOptions,
  normalizeCustomizationSelections,
  renderProductCustomization,
  updateCustomizationTotalNode,
} from "./chat-product-panel-customization.js";

const PAYMENT_METHOD_BY_KEY = new Map(PAYMENT_METHOD_OPTIONS.map((option) => [option.key, option]));

export {
  buildNoDiscountCheckoutUrl,
  calculateSelectedDiscountPrice,
  normalizeDiscountOffers,
  normalizeProductDiscountOffers,
};

export function updateProductPanel(root, product = {}, options = {}) {
  const commerceOverride = root?.dataset?.productPanelCommerceEnabled;
  const effectiveProduct = commerceOverride === "false" ? { ...product, commerceEnabled: false } : product;
  const normalizedProduct = normalizeProductPanelProduct(effectiveProduct);
  const language = resolveProductPanelLanguage(root, normalizedProduct, options);
  const copy = getProductPanelCopy(language);
  const title = root.querySelector("[data-product-panel-title]");
  const image = root.querySelector("[data-product-panel-image]");
  const tag = root.querySelector("[data-product-panel-tag]");
  const name = root.querySelector("[data-product-panel-name]");
  const subtitle = root.querySelector("[data-product-panel-subtitle]");
  const price = root.querySelector("[data-product-panel-price]");
  const footPrice = root.querySelector("[data-product-panel-foot-price]");
  const payments = root.querySelector("[data-product-panel-payments]");
  const priceNote = root.querySelector("[data-product-panel-price-note]");
  const offers = root.querySelector("[data-product-panel-offers]");
  const offersTitle = root.querySelector("[data-product-panel-offers-title]");
  const offersList = root.querySelector("[data-product-panel-offers-list]");
  const code = root.querySelector("[data-product-panel-code]");
  const codeLabel = root.querySelector("[data-product-panel-code-label]");
  const copyLabel = root.querySelector("[data-product-panel-copy-label]");
  const sizeField = root.querySelector("[data-product-panel-size-field]");
  const sizeLabel = root.querySelector("[data-product-panel-size-label]");
  const quantityLabel = root.querySelector("[data-product-panel-quantity-label]");
  const sizeChartTrigger = root.querySelector("[data-product-size-chart-open]");
  const sizes = root.querySelector("[data-product-panel-sizes]");
  const customization = root.querySelector("[data-product-panel-customization]");
  const customizationKicker = root.querySelector("[data-product-customization-kicker]");
  const customizationTitle = root.querySelector("[data-product-customization-title]");
  const customizationTotal = root.querySelector("[data-product-customization-total]");
  const customizationFields = root.querySelector("[data-product-customization-fields]");
  const features = root.querySelector("[data-product-panel-features]");
  const buy = root.querySelector("[data-product-panel-buy]");
  const detailLink = root.querySelector("[data-product-panel-detail-link]");
  const detailLogo = root.querySelector("[data-product-panel-detail-logo]");
  const detailLogoFallback = root.querySelector("[data-product-panel-detail-logo-fallback]");
  const detailSite = root.querySelector("[data-product-panel-detail-site]");
  const detailLabel = root.querySelector("[data-product-panel-detail-label]");
  if (title) title.textContent = copy.title;
  if (codeLabel) codeLabel.textContent = copy.codeLabel;
  if (copyLabel) copyLabel.textContent = copy.copy;
  if (sizeLabel) sizeLabel.textContent = copy.size;
  if (quantityLabel) quantityLabel.textContent = copy.quantity;
  if (sizeChartTrigger) {
    const sizeChart = normalizeProductSizeChart(normalizedProduct.sizeChart);
    const sizeChartLabel = sizeChartTrigger.querySelector("span:last-child");
    if (sizeChartLabel) sizeChartLabel.textContent = copy.sizeChart;
    sizeChartTrigger.hidden = !sizeChart;
    sizeChartTrigger.dataset.productSizeChartReady = sizeChart ? "true" : "false";
    renderSizeChartModal(root, sizeChart, copy);
  }
  if (customizationKicker) customizationKicker.textContent = copy.customizationKicker;
  if (customizationTitle) customizationTitle.textContent = copy.customizationTitle;
  if (offersTitle) offersTitle.textContent = copy.offersTitle;
  root.dataset.productPanelImages = JSON.stringify(normalizeProductImages(normalizedProduct));
  root.dataset.productPanelProduct = JSON.stringify(normalizedProduct);
  root.dataset.productPanelAnalytics = JSON.stringify(normalizedProduct.analytics || {});
  root.dataset.productPanelImageIndex = String(normalizeImageIndex(product.imageIndex, parseProductPanelImages(root).length));
  renderProductPanelImages(root);
  setProductPanelImage(root);
  if (image) image.alt = normalizedProduct.name || copy.item;
  if (tag) {
    tag.textContent = normalizedProduct.tag ? `★ ${normalizedProduct.tag}` : "";
    tag.hidden = !normalizedProduct.tag;
  }
  if (name) name.textContent = normalizedProduct.name || copy.item;
  if (subtitle) subtitle.textContent = normalizedProduct.subtitle || normalizedProduct.stock || "";
  const priceView = renderProductPrice(normalizedProduct, copy, {
    quantity: root.dataset?.productPanelQuantity,
  });
  const priceHtml = priceView.html;
  if (price) price.innerHTML = priceHtml;
  if (footPrice) footPrice.innerHTML = priceHtml;
  if (priceNote) priceNote.textContent = normalizedProduct.giveaway === true ? copy.productGiveaway : priceView.discounted ? copy.estimatedPriceNote : copy.priceNote;
  renderPaymentMethods(payments, normalizedProduct.commerceEnabled === false ? [] : normalizedProduct.paymentMethods);
  renderProductDiscountOffers(offers, offersList, normalizedProduct.commerceEnabled === false ? [] : normalizedProduct.discountOffers, normalizedProduct.selectedDiscountOfferIds, copy);
  if (code) {
    const codeText = normalizedProduct.code || normalizedProduct.discountCode || "";
    code.hidden = !codeText || normalizeDiscountOffers(normalizedProduct.discountOffers).length > 0;
    const codeValue = code.querySelector("b");
    if (codeValue) codeValue.textContent = codeText;
  }
  const renderedSizes = renderSizes(normalizedProduct.sizes, normalizedProduct.selectedSizeIndex, language);
  if (sizes) sizes.innerHTML = renderedSizes;
  if (sizeField) sizeField.hidden = !renderedSizes;
  renderProductCustomization(customization, customizationTotal, customizationFields, normalizedProduct, copy);
  if (customization) customization.hidden = normalizedProduct.commerceEnabled === false;
  if (features) features.innerHTML = renderFeatures(normalizedProduct, copy);
  if (detailLink) {
    const productUrl = String(normalizedProduct.url || "");
    detailLink.hidden = !productUrl;
    detailLink.href = productUrl || "#";
  }
  if (detailSite) detailSite.textContent = resolveStoreLabel(normalizedProduct, copy);
  if (detailLabel) detailLabel.textContent = copy.viewDetails;
  updateDetailLogo(detailLogo, detailLogoFallback, normalizedProduct);
  if (buy) {
    const purchaseState = buildProductPurchaseState(normalizedProduct, copy);
    renderProductPanelPrimaryAction(root, buy, purchaseState);
  }
}

export function setProductPanelAddPending(root, pending = false) {
  if (!root) return;
  if (pending) root.dataset.productPanelAddPending = "true";
  else delete root.dataset.productPanelAddPending;
  const buy = root.querySelector?.("[data-product-panel-buy]");
  if (!buy) return;
  const product = normalizeProductPanelProduct(parseProductPayload(root.dataset.productPanelProduct));
  const copy = getProductPanelCopy(resolveProductPanelLanguage(root, product));
  renderProductPanelPrimaryAction(root, buy, buildProductPurchaseState(product, copy));
}

function renderProductPanelPrimaryAction(root, button, purchaseState = {}) {
  const pending = root?.dataset?.productPanelAddPending === "true";
  button.dataset.productUrl = purchaseState.url || "";
  button.disabled = Boolean(purchaseState.disabled || pending);
  if (pending) {
    button.setAttribute("aria-busy", "true");
    button.innerHTML = `<span class="pp-action-spinner" aria-hidden="true"></span> ${escapeHtml(purchaseState.label)}`;
    return;
  }
  button.removeAttribute("aria-busy");
  button.innerHTML = `${ICONS.shop} ${escapeHtml(purchaseState.label)}`;
}

export function setProductPanelImage(root) {
  const images = parseProductPanelImages(root);
  const index = Math.min(Math.max(Number(root.dataset.productPanelImageIndex || 0), 0), Math.max(images.length - 1, 0));
  const prev = root.querySelector("[data-product-panel-prev]");
  const next = root.querySelector("[data-product-panel-next]");
  const count = root.querySelector("[data-product-panel-count]");
  const hasGallery = images.length > 1;
  setProductPanelTrackOffset(root);
  if (prev) prev.hidden = !hasGallery;
  if (next) next.hidden = !hasGallery;
  if (count) {
    count.hidden = !hasGallery;
    count.textContent = hasGallery ? `${index + 1}/${images.length}` : "";
  }
}

export function renderProductPanelImages(root) {
  const images = parseProductPanelImages(root);
  const track = root.querySelector("[data-product-panel-track]");
  if (!track) return;
  track.innerHTML = images.length ? images.map((src, imageIndex) => {
    const imageUrl = normalizeAssetUrl(src || "/assets/jersey_product.png");
    return `<div class="pp-gallery-slide"><img src="${escapeHtml(imageUrl)}" alt="Product image ${imageIndex + 1}" data-product-panel-image /></div>`;
  }).join("") : `<div class="pp-gallery-slide"><img src="/assets/jersey_product.png" alt="Product" data-product-panel-image /></div>`;
}

export function setProductPanelTrackOffset(root, { dragDeltaX = 0 } = {}) {
  const track = root.querySelector("[data-product-panel-track]");
  if (!track) return;
  const index = Number(root.dataset.productPanelImageIndex || 0);
  track.style.transform = `translateX(calc(${-index * 100}% + ${Math.round(dragDeltaX)}px))`;
}

export function normalizeProductImages(product = {}) {
  const images = [
    product.imageUrl,
    ...(Array.isArray(product.imageUrls) ? product.imageUrls : []),
  ].map((url) => normalizeAssetUrl(url || "")).filter(Boolean);
  return [...new Set(images)].slice(0, 8);
}

export function parseProductPanelImages(root) {
  try {
    const rows = JSON.parse(root.dataset.productPanelImages || "[]");
    return Array.isArray(rows) ? rows.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function normalizeImageIndex(value, imageCount) {
  const count = Math.max(Number(imageCount || 0), 0);
  if (!count) return 0;
  const index = Number(value || 0);
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), count - 1);
}

export function parseProductPayload(value = "") {
  if (!value) return {};
  try {
    const payload = JSON.parse(value);
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}

export function updateSelectedProductSize(root, selectedSizeIndex, options = {}) {
  const product = normalizeProductPanelProduct(parseProductPayload(root.dataset.productPanelProduct));
  const nextProduct = {
    ...product,
    selectedSizeIndex,
  };
  updateProductPanel(root, nextProduct, options);
  return parseProductPayload(root.dataset.productPanelProduct);
}

export function updateProductCustomization(root, optionId = "", value = "", options = {}) {
  const currentProduct = normalizeProductPanelProduct(parseProductPayload(root?.dataset?.productPanelProduct));
  const normalizedOptionId = String(optionId || "").trim();
  if (!normalizedOptionId) return currentProduct;
  const selections = { ...(currentProduct.customizationSelections || {}) };
  selections[normalizedOptionId] = String(value || "");
  const nextProduct = { ...currentProduct, customizationSelections: selections };
  if (options.render !== false) updateProductPanel(root, nextProduct, options);
  else if (root) root.dataset.productPanelProduct = JSON.stringify(nextProduct);
  return parseProductPayload(root.dataset.productPanelProduct);
}

export function updateProductCustomizationTotal(root, product = null) {
  if (!root) return;
  const normalizedProduct = normalizeProductPanelProduct(product || parseProductPayload(root.dataset.productPanelProduct));
  const total = root.querySelector("[data-product-customization-total]");
  const options = normalizeCustomizationOptions(normalizedProduct.customizationOptions);
  updateCustomizationTotalNode(total, {
    options,
    selections: normalizedProduct.customizationSelections,
    currency: normalizedProduct.currency,
  });
}

export function updateProductPanelPaymentMethods(root, paymentMethods = []) {
  if (!root) return {};
  const product = normalizeProductPanelProduct(parseProductPayload(root.dataset.productPanelProduct));
  const nextProduct = {
    ...product,
    paymentMethods: normalizePaymentMethods(paymentMethods),
  };
  root.dataset.productPanelProduct = JSON.stringify(nextProduct);
  renderPaymentMethods(root.querySelector("[data-product-panel-payments]"), nextProduct.paymentMethods);
  return nextProduct;
}

export function updateProductPanelDiscountOffers(root, discountOffers = []) {
  const currentProduct = parseProductPayload(root?.dataset?.productPanelProduct);
  const normalizedOffers = normalizeProductDiscountOffers({ ...currentProduct, discountOffers });
  const selectedDiscountOfferIds = retainAvailableDiscountOfferIds(currentProduct.selectedDiscountOfferIds, normalizedOffers, currentProduct.selectedDiscountOfferId);
  const nextProduct = { ...currentProduct, discountOffers: normalizedOffers, selectedDiscountOfferIds, selectedDiscountOfferId: selectedDiscountOfferIds[0] || "" };
  if (root) root.dataset.productPanelProduct = JSON.stringify(nextProduct);
  renderProductDiscountOffers(
    root?.querySelector?.("[data-product-panel-offers]"),
    root?.querySelector?.("[data-product-panel-offers-list]"),
    normalizedOffers,
    selectedDiscountOfferIds,
    getProductPanelCopy(root?.dataset?.productPanelLanguage || ""),
  );
  const legacyCode = root?.querySelector?.("[data-product-panel-code]");
  if (legacyCode) legacyCode.hidden = Boolean(normalizedOffers.length) || !String(nextProduct.code || nextProduct.discountCode || "").trim();
  updateProductPanelPricePreview(
    root,
    nextProduct,
    getProductPanelCopy(root?.dataset?.productPanelLanguage || ""),
  );
  return nextProduct;
}

export function updateSelectedDiscountOffer(root, discountOfferId = "") {
  const currentProduct = parseProductPayload(root?.dataset?.productPanelProduct);
  const offers = normalizeDiscountOffers(currentProduct.discountOffers);
  const selectedDiscountOfferIds = resolveSelectedDiscountOfferIds(
    currentProduct.selectedDiscountOfferIds,
    discountOfferId,
    offers,
  );
  const nextProduct = { ...currentProduct, selectedDiscountOfferIds, selectedDiscountOfferId: selectedDiscountOfferIds[0] || "" };
  if (root) root.dataset.productPanelProduct = JSON.stringify(nextProduct);
  renderProductDiscountOffers(
    root?.querySelector?.("[data-product-panel-offers]"),
    root?.querySelector?.("[data-product-panel-offers-list]"),
    offers,
    selectedDiscountOfferIds,
    getProductPanelCopy(root?.dataset?.productPanelLanguage || ""),
  );
  updateProductPanelPricePreview(
    root,
    nextProduct,
    getProductPanelCopy(root?.dataset?.productPanelLanguage || ""),
  );
  return nextProduct;
}

export function renderPaymentMethods(target, paymentMethods = []) {
  if (!target) return;
  const methods = normalizePaymentMethods(paymentMethods);
  target.hidden = !methods.length;
  target.classList.remove("is-overflowing", "is-dragging");
  target.scrollLeft = 0;
  target.innerHTML = methods.map((key) => {
    const option = PAYMENT_METHOD_BY_KEY.get(key);
    if (!option) return "";
    return `
      <span class="pp-payment-method" title="${escapeHtml(option.label)}">
        <img src="${escapeHtml(option.icon)}" alt="${escapeHtml(option.label)}" loading="lazy" />
      </span>`;
  }).join("");
  queuePaymentRailLayout(target);
}

function queuePaymentRailLayout(target) {
  if (!target || target.hidden) return;
  window.requestAnimationFrame?.(() => {
    window.requestAnimationFrame?.(() => updatePaymentRailLayout(target));
  });
}

function updatePaymentRailLayout(target) {
  if (!target || target.hidden) return;
  const overflowing = target.scrollWidth > target.clientWidth + 1;
  target.classList.toggle("is-overflowing", overflowing);
  if (!overflowing) target.scrollLeft = 0;
}

function renderSizes(sizes = [], selectedSizeIndex = -1, language = "") {
  if (!Array.isArray(sizes)) return "";
  const soldOutText = getSoldOutSizeMessage(language);
  return sizes.map((size, index) => {
    const label = typeof size === "string" ? size : size?.label;
    if (!label) return "";
    const available = typeof size === "object" ? size.available !== false : true;
    const active = selectedSizeIndex === index && available;
    const stateClass = [
      active ? "on" : "",
      available ? "" : "is-sold-out",
    ].filter(Boolean).join(" ");
    const soldOutAttrs = available
      ? ""
      : ` aria-disabled="true" aria-label="${escapeHtml(soldOutText)}" data-product-panel-sold-out="true" data-sold-out-message="${escapeHtml(soldOutText)}"`;
    return `<button class="pp-size ${stateClass}" data-product-panel-size-index="${index}" type="button"${soldOutAttrs}>${escapeHtml(label)}</button>`;
  }).join("");
}

function renderFeatures(product = {}, copy = getProductPanelCopy("")) {
  const rows = resolveProductBenefitRows(product, copy);
  return rows.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeProductPanelProduct(product = {}) {
  const sizes = Array.isArray(product.sizes) ? product.sizes : [];
  const selectedSizeIndex = normalizeSelectedSizeIndex(product.selectedSizeIndex, sizes);
  const customizationOptions = normalizeCustomizationOptions(product.customizationOptions);
  return {
    ...product,
    sizes,
    sizeChart: normalizeProductSizeChart(product.sizeChart),
    selectedSizeIndex,
    customizationOptions,
    customizationSelections: normalizeCustomizationSelections(product.customizationSelections),
    discountOffers: normalizeProductDiscountOffers(product),
    selectedDiscountOfferIds: normalizeSelectedDiscountOfferIds(product.selectedDiscountOfferIds, product.selectedDiscountOfferId),
    selectedDiscountOfferId: normalizeSelectedDiscountOfferIds(product.selectedDiscountOfferIds, product.selectedDiscountOfferId)[0] || "",
    paymentMethods: normalizePaymentMethods(product.paymentMethods || product.payment_methods),
  };
}

function normalizeProductSizeChart(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const columns = (Array.isArray(value.columns) ? value.columns : []).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8);
  const rows = (Array.isArray(value.rows) ? value.rows : [])
    .map((row) => Array.isArray(row) ? row.map((item) => String(item || "").trim()).slice(0, columns.length) : [])
    .filter((row) => row.length >= 2)
    .slice(0, 24);
  if (columns.length < 2 || !rows.length) return null;
  return { title: String(value.title || "Size Chart"), fitTip: String(value.fitTip || ""), unit: String(value.unit || ""), columns, rows };
}

function renderSizeChartModal(root, chart, copy = getProductPanelCopy("")) {
  const modal = root.querySelector("[data-product-size-chart-modal]");
  const title = root.querySelector("[data-product-size-chart-title]");
  const fitTip = root.querySelector("[data-product-size-chart-fit-tip]");
  const head = root.querySelector("[data-product-size-chart-head]");
  const body = root.querySelector("[data-product-size-chart-body]");
  if (!modal || !title || !fitTip || !head || !body) return;
  modal.hidden = true;
  title.textContent = !chart?.title || chart.title === "Size Chart" ? copy.sizeChart : chart.title;
  fitTip.textContent = chart?.fitTip || "";
  fitTip.hidden = !chart?.fitTip;
  head.innerHTML = chart ? `<tr>${chart.columns.map((column) => `<th scope="col">${escapeHtml(column)}</th>`).join("")}</tr>` : "";
  body.innerHTML = chart ? chart.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("") : "";
}

function normalizeSelectedSizeIndex(value, sizes = []) {
  const index = Number(value);
  if (!Number.isInteger(index)) return -1;
  if (index < 0 || index >= sizes.length) return -1;
  if (sizes[index]?.available === false) return -1;
  return index;
}

function buildProductPurchaseState(product = {}, copy = getProductPanelCopy("")) {
  const sizes = Array.isArray(product.sizes) ? product.sizes : [];
  if (product.commerceEnabled === false) {
    return { disabled: !String(product.url || "").trim(), label: copy.viewMore, url: String(product.url || "").trim() };
  }
  const selectedSizeIndex = normalizeSelectedSizeIndex(product.selectedSizeIndex, sizes);
  const selectedSize = selectedSizeIndex >= 0 ? sizes[selectedSizeIndex] : null;
  const hasVariantCheckout = sizes.some((size) => size?.variantId && size?.buyUrl);
  const hasAvailableVariantCheckout = sizes.some((size) => size?.available !== false && size?.variantId && size?.buyUrl);
  const hasIncompleteCustomization = hasIncompleteRequiredCustomization(product.customizationOptions, product.customizationSelections);
  if (!hasVariantCheckout && product.checkoutResolutionStatus === "loading") {
    return { disabled: true, label: copy.loadingCheckout, url: "" };
  }
  if (!hasVariantCheckout && product.checkoutResolutionStatus === "failed") {
    return { disabled: false, label: copy.retryCheckout, url: "" };
  }
  if (hasVariantCheckout) {
    if (!hasAvailableVariantCheckout) {
      return { disabled: true, label: copy.soldOut, url: "" };
    }
    if (!selectedSize?.buyUrl) {
      return { disabled: true, label: copy.selectSize, url: "" };
    }
    if (hasIncompleteCustomization) return { disabled: true, label: copy.completeCustomization, url: "" };
    return { disabled: false, label: copy.addToCart, url: buildNoDiscountCheckoutUrl(selectedSize.buyUrl) };
  }
  if (product.purchaseMode === "product_detail" && String(product.url || "").trim()) {
    if (sizes.length && !selectedSize) return { disabled: true, label: copy.selectSize, url: "" };
    if (hasIncompleteCustomization) return { disabled: true, label: copy.completeCustomization, url: "" };
    return { disabled: false, label: copy.addToCart, url: String(product.url).trim() };
  }
  return { disabled: true, label: copy.loadingCheckout, url: "" };
}

function resolveProductPanelLanguage(root, product = {}, options = {}) {
  return [
    options.language,
    root?.dataset?.productPanelLanguage,
    product.languageCode,
    product.language,
    product.languageLabel,
  ].find(Boolean) || "";
}

function getSoldOutSizeMessage(language = "") {
  return createSiteCopy(language).t("product.soldOutSize");
}

export function getProductPanelCopy(language = "") {
  const copy = createSiteCopy(language);
  return Object.fromEntries([
    "title", "item", "codeLabel", "copy", "size", "sizeChart", "customizationKicker", "customizationTitle",
    "customizationField", "customizationPlaceholder", "customizationRequired", "soldOut", "selectSize",
    "buyNow", "addToCart", "quantity", "completeCustomization", "loadingCheckout", "retryCheckout", "priceNote", "estimatedPriceNote", "estimatedDiscount",
    "offersTitle", "offerDefault", "useOffer", "selectedOffer", "copyOffer", "copied", "viewDetails", "store",
    "available", "unavailable", "shipping", "returns",
  ].map((key) => [key, copy.t(`product.${key}`)]).concat([["viewMore", copy.t("kitshop.viewMore")], ["productGiveaway", copy.t("chat.productGiveaway")]]));
}

function resolveProductBenefitRows(product = {}, copy = getProductPanelCopy("")) {
  const rows = [];
  const sourceRows = normalizeFeatureRows(product.features);
  rows.push(...sourceRows);
  const summaryBenefits = extractBenefitsFromText(product.summary || product.description || "", copy);
  rows.push(...summaryBenefits);
  if (!rows.length && product.subtitle) rows.push(product.subtitle);
  if (!rows.length && product.stock) rows.push(normalizeStockText(product.stock, copy));
  if (!rows.length && product.available === true) rows.push(copy.available);
  if (!rows.length && product.available === false) rows.push(copy.unavailable);
  return [...new Set(rows.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 4);
}

function normalizeFeatureRows(value = []) {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      return item.label || item.name || item.value || item.text || "";
    })
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function extractBenefitsFromText(value = "", copy = getProductPanelCopy("")) {
  const text = String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const lower = text.toLowerCase();
  const rows = [];
  if (/\b(fast|quick|express|tracked)\s+(shipping|delivery|dispatch)\b|\b(shipping|delivery|dispatch)\b/.test(lower)) {
    rows.push(copy.shipping);
  }
  if (/\b(return|returns|refund|exchange|退换|退款|换货)\b/.test(lower)) {
    rows.push(copy.returns);
  }
  return rows;
}

function normalizeStockText(value = "", copy = getProductPanelCopy("")) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/available|in stock|有货|现货/i.test(text)) return copy.available;
  if (/sold out|out of stock|已售罄|缺货/i.test(text)) return copy.unavailable;
  return text;
}

function resolveStoreLabel(product = {}, copy = getProductPanelCopy("")) {
  const fromUrl = product.url ? hostLabelFromUrl(product.url) : "";
  return fromUrl || product.siteSlug || copy.store;
}

function updateDetailLogo(image, fallback, product = {}) {
  if (!image || !fallback) return;
  const explicitLogo = [
    product.siteLogoUrl,
    product.siteIconUrl,
    product.logoUrl,
    product.iconUrl,
  ].map((value) => String(value || "").trim()).find(Boolean);
  bindSiteBrandImage(image, fallback, {
    logoUrl: explicitLogo ? normalizeAssetUrl(explicitLogo) : "",
    siteUrl: product.siteUrl || "",
    productUrl: product.url || "",
  });

  const siteSlug = String(product.siteSlug || "").trim().toLowerCase();
  const requestKey = `${siteSlug}:${String(product.siteId || "").trim()}`;
  image.dataset.siteBrandRequest = requestKey;
  if (!siteSlug) return;
  getSiteBranding(siteSlug).then((branding) => {
    if (!branding || image.dataset.siteBrandRequest !== requestKey) return;
    bindSiteBrandImage(image, fallback, {
      logoUrl: branding.logoUrl,
      siteUrl: branding.siteUrl,
      productUrl: product.url || "",
    });
  }).catch(() => {});
}

function hostLabelFromUrl(value = "") {
  try {
    const url = new URL(String(value || ""));
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
