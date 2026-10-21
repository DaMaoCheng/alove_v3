import { ICONS } from "../../icons/icons.js";
import { normalizeProductPanelPayload } from "../chat/chat-product-panel-payload.js";
import { characterAvatarHtml, normalizeAssetUrl } from "../shared-ui/character-avatar.js";
import { showDialog } from "../shared-ui/dialog.js";
import { reportCatalogProductImpressions } from "../chat/chat-product-impressions.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export function renderSearchResults(page, { characters, query, recent, products = [], productsLoading = false, productsError = "", guestMode = false, guestMascotCharacterId = "", pageLanguage = "English", onQueryChange, onClearRecent, onNavigate }) {
  const copy = createSiteCopy(pageLanguage);
  const results = page.querySelector("[data-search-results]");
  if (!results) return;
  results.innerHTML = searchResultsHtml({ characters, query, recent, products, productsLoading, productsError, copy });
  if (!guestMode) {
    reportCatalogProductImpressions(results, {
      selector: ".search-product-row[data-product-analytics]",
      eventType: "product_search_result_impression",
      source: "search_product_result",
    });
  }
  results.querySelectorAll("[data-search-term]").forEach((button) => {
    button.addEventListener("click", () => onQueryChange?.(button.dataset.searchTerm || ""));
  });
  results.querySelector("[data-search-clear-recent]")?.addEventListener("click", () => onClearRecent?.());
  results.querySelectorAll("[data-search-character]").forEach((button) => {
    button.addEventListener("click", () => document.body.classList.remove("product-open"));
    button.addEventListener("click", () => {
      if (!guestMode || button.dataset.searchCharacter === guestMascotCharacterId) {
        onNavigate?.("chat", button.dataset.searchCharacter);
        return;
      }
      showDialog({
        type: "info",
        title: copy.t("common.checkoutTitle"),
        message: copy.t("common.checkoutMessage"),
        confirmText: copy.t("common.createAccount"),
        cancelText: copy.t("common.notNow"),
        onConfirm: () => onNavigate?.("register"),
      });
    });
  });
}

function searchResultsHtml({ characters, query, recent, products = [], productsLoading = false, productsError = "", copy }) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) {
    return `
      <section class="search-sec">
        <div class="search-sec-head">${ICONS.spark}<span>${copy.t("search.trending")}</span></div>
        <div class="search-tags">${searchTrendingTerms(copy).map((term) => `<button class="search-tag" data-search-term="${escapeAttr(term)}">${escapeHtml(term)}</button>`).join("")}</div>
      </section>
      <section class="search-sec">
        <div class="search-sec-head">${ICONS.back}<span>${copy.t("search.recent")}</span>${recent.length ? `<button class="search-clear" data-search-clear-recent>${copy.t("search.clear")}</button>` : ""}</div>
        <div class="search-recent">${recent.map((term) => `<button class="recent-row" data-search-term="${escapeAttr(term)}">${ICONS.search}<span>${escapeHtml(term)}</span></button>`).join("") || `<div class="search-muted">${copy.t("search.noRecent")}</div>`}</div>
      </section>
    `;
  }

  const filteredCharacters = characters.filter((item) => includesQuery([item.name], q));
  const total = filteredCharacters.length + products.length;
  if (!total && !productsLoading && !productsError) {
    return `<div class="search-empty">${ICONS.search}<h4>${copy.t("search.noResults", { query: escapeHtml(query) })}</h4><p>${copy.t("search.try")}</p></div>`;
  }

  return `
    <div class="search-count">${copy.t(total === 1 ? "search.result" : "search.results", { count: `${total}${productsLoading ? "+" : ""}` })}</div>
    ${filteredCharacters.length ? searchSection(copy.t("search.characters"), ICONS.spark, filteredCharacters.map((item) => `
      <button class="sr-row" data-search-character="${escapeAttr(item.id)}">
        ${characterAvatarHtml({ name: item.name, imageUrl: item.avatarUrl })}
        <span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.roleTitle || copy.t("create.aiCharacter"))}</small></span>
      </button>
    `).join("")) : ""}
    ${searchProductSectionHtml({ products, productsLoading, productsError, copy })}
  `;
}

function searchSection(title, icon, rows) {
  return `<section class="search-sec"><div class="search-sec-head">${icon}<span>${title}</span></div><div class="search-rows">${rows}</div></section>`;
}

function searchProductSectionHtml({ products = [], productsLoading = false, productsError = "", copy } = {}) {
  if (!productsLoading && !productsError && !products.length) return "";
  if (productsLoading) {
    return searchSection(copy.t("search.kits"), ICONS.shop, `<div class="search-muted search-products-muted">${copy.t("search.searching")}</div>`);
  }
  if (productsError) {
    return searchSection(copy.t("search.kits"), ICONS.shop, `<div class="search-muted search-products-muted">${copy.t("search.unavailable")}</div>`);
  }
  return searchSection(copy.t("search.kits"), ICONS.shop, products.map((item) => productResultRow(item, copy)).join(""));
}

function productResultRow(product = {}, copy) {
  const payload = escapeAttr(JSON.stringify(normalizeProductPanelPayload(product)));
  const analytics = escapeAttr(JSON.stringify(product.analytics || {}));
  const src = normalizeAssetUrl(product.imageUrl || product.imageUrls?.[0] || "/assets/jersey_product.png");
  const meta = product.subtitle || product.summary || copy.t("search.recommended");
  const price = product.price ? `<strong class="search-product-price">${escapeHtml(product.price)}</strong>` : "";
  return `<button class="sr-row search-product-row product-card-trigger" data-product="${payload}" data-product-analytics="${analytics}" type="button"><img src="${escapeAttr(src)}" alt="" /><span><b>${escapeHtml(product.name || copy.t("product.title"))}</b><small>${escapeHtml(meta)}</small></span><em class="search-product-side">${price}<i class="search-product-action">${copy.t("search.view")} ${ICONS.back}</i></em></button>`;
}

function searchTrendingTerms(copy) {
  return String(copy.t("search.trendingTerms") || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function includesQuery(values, query) {
  return values.some((value) => String(value || "").toLowerCase().includes(query));
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
