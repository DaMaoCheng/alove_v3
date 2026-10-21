import { bindProductPanel, productPanelHtml, productSizeChartModalHtml } from "../chat/chat-product-panel.js";
import { productCartHtml } from "../chat/chat-product-cart.js";
import { ttmallAccountBindingHtml } from "../chat/chat-ttmall-binding-panel.js";
import { ttmallCheckoutPanelHtml } from "../chat/chat-ttmall-checkout-panel.js";
import { createSearchProductState } from "./search-product-state.js";
import { renderSearchResults } from "./search-results-renderer.js";
import { createSearchTopbar } from "./search-topbar.js";
import { showDialog } from "../shared-ui/dialog.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export function createSearchPage({ characters = [], query = "", recent = [], siteSlug = "", pageLanguage = "English", guestMode = false, guestMascotCharacterId = "", onQueryChange, onClearRecent, onCancel, onNavigate }) {
  const copy = createSiteCopy(pageLanguage);
  const searchState = createSearchProductState({
    siteSlug,
    pageLanguage,
    characters,
    recent,
    guestMode,
    guestMascotCharacterId,
    onQueryChange,
    onClearRecent,
    onNavigate,
    renderSearchResults,
  });

  searchState.syncQuery(query);

  const fragment = document.createDocumentFragment();
  const page = document.createElement("div");
  page.className = "page search-page";
  page.innerHTML = `
    <div class="search-shell">
      <div class="search-main" data-search-results></div>
    </div>
    <div class="search-detail-shell">
      <div class="prod-scrim"></div>
      <aside class="prod-panel search-prod-panel">${productPanelHtml({ includeSizeChartModal: false, pageLanguage })}</aside>
      ${productCartHtml({ pageLanguage })}
      ${ttmallAccountBindingHtml()}
      ${ttmallCheckoutPanelHtml()}
    </div>
    ${productSizeChartModalHtml({ pageLanguage })}`;

  const renderPage = () => {
    searchState.renderInto(page, { onQueryChange: handleTermSelect });
  };

  const runProductSearch = () => {
    searchState.scheduleProductSearch(page, { onQueryChange: handleTermSelect });
  };

  const handleTermSelect = (term) => {
    searchState.handleTermSelect(term);
    syncTopbarValue(topbar, term);
    runProductSearch();
  };

  const topbar = createSearchTopbar({
    query,
    pageLanguage,
    onQueryChange: (nextQuery) => {
      searchState.setQuery(nextQuery);
      runProductSearch();
    },
    onCancel,
  });
  fragment.append(topbar);

  bindProductPanel(page, {
    initialProduct: searchState.getOpenProductPanel(),
    language: pageLanguage,
    siteSlug,
    clickEventType: "product_search_result_click",
    clickSource: "search_product_result",
    recordAnalytics: !guestMode,
    guestMode,
    recordDetailEvents: !guestMode,
    requireAuthForCheckout: guestMode,
    onRestrictedCheckout: () => showDialog({
      type: "info",
      title: copy.t("common.checkoutTitle"),
      message: copy.t("common.checkoutMessage"),
      confirmText: copy.t("common.createAccount"),
      cancelText: copy.t("common.notNow"),
      onConfirm: () => onNavigate?.("register"),
    }),
    onProductChange: (product) => {
      searchState.setOpenProductPanel(product);
    },
  });

  if (String(query || "").trim()) {
    runProductSearch();
  } else {
    renderPage();
  }

  fragment.append(page);
  window.requestAnimationFrame(() => document.getElementById("searchInput")?.focus());
  return fragment;
}

function syncTopbarValue(root, value) {
  const normalizedValue = String(value || "");
  const input = root.querySelector("#searchInput");
  if (input instanceof HTMLInputElement) {
    input.value = normalizedValue;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  const clearButton = root.querySelector(".search-x");
  if (clearButton instanceof HTMLButtonElement) clearButton.hidden = !normalizedValue;
}
