import { normalizeAssetUrl } from "../shared-ui/character-avatar.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export const FALLBACK_DAILY_QUICK_REPLIES = Object.freeze([
  Object.freeze({ text: "How was your day", productTrigger: "" }),
  Object.freeze({ text: "Any match thoughts today", productTrigger: "" }),
  Object.freeze({ text: "Tell me something fun", productTrigger: "" }),
  Object.freeze({ text: "Give me your take", productTrigger: "" }),
  Object.freeze({ text: "Need a quick chat", productTrigger: "" }),
  Object.freeze({ text: "What are we thinking", productTrigger: "" }),
  Object.freeze({ text: "Got a bold opinion", productTrigger: "" }),
  Object.freeze({ text: "Talk me through it", productTrigger: "" }),
]);

export const FALLBACK_PRODUCT_QUICK_REPLIES = Object.freeze([
  Object.freeze({ text: "Show me fresh kits", productTrigger: "quick_product" }),
  Object.freeze({ text: "Find a matchday shirt", productTrigger: "quick_product" }),
  Object.freeze({ text: "Any new football shirts", productTrigger: "quick_product" }),
  Object.freeze({ text: "Help me pick jerseys", productTrigger: "quick_product" }),
  Object.freeze({ text: "Show me Messi shirts", productTrigger: "quick_product" }),
  Object.freeze({ text: "Find AC Milan kits", productTrigger: "quick_product" }),
  Object.freeze({ text: "Got any retro kits", productTrigger: "quick_product" }),
  Object.freeze({ text: "Show me best sellers", productTrigger: "quick_product" }),
  Object.freeze({ text: "Show me away kits", productTrigger: "quick_product" }),
  Object.freeze({ text: "Need a football look", productTrigger: "quick_product" }),
]);

export const QUICK_REPLY_EMOJIS = Object.freeze(["⚽", "✨", "🔥"]);
const fallbackQuickRepliesByCharacterId = new Map();

export function renderQuickReplies(quickReplies = [], { character = {}, pageLanguage = "English", disabled = false, escapeAttribute, escapeHtml } = {}) {
  const rows = Array.isArray(quickReplies) ? quickReplies.filter((reply) => String(reply?.text || "").trim()).slice(0, 3) : [];
  const visibleRows = rows.length ? rows : getFallbackQuickRepliesForCharacter(character, pageLanguage);
  const disabledAttr = disabled ? "disabled" : "";
  return visibleRows.map((reply, index) => {
    const text = String(reply.text || "").trim();
    const productTrigger = String(reply.productTrigger || "").trim();
    const triggerAttr = productTrigger ? ` data-product-trigger="${escapeAttribute(productTrigger)}"` : "";
    const emoji = QUICK_REPLY_EMOJIS[index % QUICK_REPLY_EMOJIS.length];
    return `<button class="suggest" data-quick="${escapeAttribute(text)}"${triggerAttr} ${disabledAttr}><span class="suggest-emoji" aria-hidden="true">${emoji}</span><span>${escapeHtml(text)}</span></button>`;
  }).join("");
}

export function getFallbackQuickRepliesForCharacter(character = {}, pageLanguage = "English") {
  const languageCode = createSiteCopy(pageLanguage).language.code;
  const key = `${String(character.id || "fallback-character").trim() || "fallback-character"}:${languageCode}`;
  if (!fallbackQuickRepliesByCharacterId.has(key)) {
    fallbackQuickRepliesByCharacterId.set(key, buildFallbackQuickReplies(character, pageLanguage));
  }
  return fallbackQuickRepliesByCharacterId.get(key);
}

export function buildFallbackQuickReplies(character = {}, pageLanguage = "English") {
  const copy = createSiteCopy(pageLanguage);
  if (canUseProductQuickReplies(character)) {
    return sampleQuickReplies(localizedFallbackReplies(copy.t("chat.quick.product"), "quick_product"), 3);
  }
  return sampleQuickReplies(localizedFallbackReplies(copy.t("chat.quick.day")), 3);
}

function localizedFallbackReplies(value = "", productTrigger = "") {
  return String(value || "").split("|").map((text) => text.trim()).filter(Boolean).map((text) => ({ text, productTrigger }));
}

export function canUseProductQuickReplies(character = {}) {
  const id = String(character.id || "").trim();
  const categoryId = String(character.category?.id || character.categoryId || character.category_id || "").trim();
  return categoryId === "creator" || categoryId === "mascot" || id === "mascot_template" || id.startsWith("mascot_");
}

export function sampleQuickReplies(replies = [], limit = 3) {
  return shuffleQuickReplies(replies).slice(0, limit);
}

export function shuffleQuickReplies(replies = []) {
  const items = [...replies];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

export function createFallbackCharacter(agent, pageLanguage = "English") {
  const copy = createSiteCopy(pageLanguage);
  return {
    id: agent || "character",
    name: copy.t("chat.character"),
    roleTitle: copy.t("chat.characterRole"),
    avatarUrl: normalizeAssetUrl("/assets/char_fan.png"),
    openingLine: copy.t("chat.fallbackOpening"),
  };
}
