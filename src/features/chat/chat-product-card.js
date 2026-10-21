import { normalizeAssetUrl } from "../shared-ui/character-avatar.js";
import { normalizeProductPanelImageUrls, normalizeProductPanelPayload } from "./chat-product-panel-payload.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export function renderProductCard(product, { message = {}, character = {}, pageLanguage = "English", escapeHtml, escapeAttribute } = {}) {
  const copy = createSiteCopy(pageLanguage);
  const candidate = product.matchStatus === "candidate";
  const tagText = candidate ? copy.t("chat.productCandidate") : product.tag;
  const tag = tagText ? `<span class="pc-tag">★ ${escapeHtml(tagText)}</span>` : "";
  const imageUrl = normalizeAssetUrl(product.imageUrl || "/assets/jersey_product.png");
  const subtitle = product.subtitle ? `<div class="pc-sub">${escapeHtml(product.subtitle)}</div>` : "";
  const priceNow = product.priceNow ? `<span class="now">${escapeHtml(product.priceNow)}</span>` : "";
  const priceWas = product.priceWas ? `<span class="was">${escapeHtml(product.priceWas)}</span>` : "";
  const price = priceNow || priceWas ? `<div class="pc-price">${priceNow}${priceWas}</div>` : "";
  const code = product.code ? `<div class="pc-code">${copy.t("chat.useCode")} <b>${escapeHtml(product.code)}</b><span class="copy">${copy.t("chat.copy")}</span></div>` : "";
  const activityNotice = product.giveaway === true ? `<div class="pc-sub">${escapeHtml(copy.t("chat.productGiveaway"))}</div>` : "";
  const buttonText = candidate ? copy.t("chat.viewDetails") : product.buttonText || (product.url ? `${copy.t("chat.viewBuy")} →` : copy.t("chat.viewDetails"));
  const panelProduct = productPanelPayload(product, imageUrl, { message, character });
  const analytics = productAnalyticsPayload(product, { message, character });
  return `
    <div class="product-card" role="button" tabindex="0" data-product="${escapeAttribute(JSON.stringify(panelProduct))}" data-product-analytics="${escapeAttribute(JSON.stringify(analytics))}" data-product-message-id="${escapeAttribute(message.id || "")}" data-product-character-id="${escapeAttribute(character.id || message.characterId || "")}">
      <div class="pc-img">${tag}<img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(product.name || copy.t("chat.product"))}" /></div>
      <div class="pc-body">
        <div class="pc-name">${escapeHtml(product.name || copy.t("chat.product"))}</div>
        ${subtitle}
        ${price}
        ${activityNotice}
        ${code}
        <button class="btn btn-primary">${escapeHtml(buttonText)}</button>
      </div>
    </div>
  `;
}

export function productPanelPayload(product = {}, normalizedImageUrl = "", { message = {}, character = {} } = {}) {
  return normalizeProductPanelPayload(product, {
    normalizedImageUrl,
    chatContext: { message, character },
  });
}

export function productAnalyticsPayload(product = {}, { message = {}, character = {} } = {}) {
  return {
    messageId: message.id || "",
    sessionId: message.sessionId || "",
    characterId: character.id || message.characterId || product.characterId || "",
    characterName: character.name || product.characterName || "",
    ownerUserId: character.ownerUserId || character.ownerUid || product.ownerUserId || "",
    siteId: product.siteId || character.siteId || "",
    siteSlug: product.siteSlug || character.siteSlug || "",
    productId: product.id || product.productId || "",
    productTitle: product.name || product.title || "",
    productUrl: product.url || "",
  };
}

export function normalizeProductImageUrls(product = {}, normalizedImageUrl = "") {
  return normalizeProductPanelImageUrls(product, normalizedImageUrl);
}
