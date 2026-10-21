import { searchSiteProducts } from "../../services/product-search-service.js";
import { getUserFacingErrorMessage } from "../../utils/user-facing-error.js";

export const PRODUCT_SEARCH_DEBOUNCE_MS = 500;

export function createSearchProductState({ siteSlug = "", pageLanguage = "English", characters = [], recent = [], guestMode = false, guestMascotCharacterId = "", onQueryChange, onClearRecent, onNavigate, renderSearchResults }) {
  let currentQuery = "";
  let currentProducts = [];
  let productsLoading = false;
  let productsError = "";
  let openProductPanel = null;
  let debounceTimer = 0;
  let latestRequestId = 0;

  function getRenderPayload(overrides = {}) {
    return {
      characters,
      query: currentQuery,
      recent,
      products: currentProducts,
      productsLoading,
      productsError,
      onClearRecent,
      onNavigate,
      guestMode,
      guestMascotCharacterId,
      pageLanguage,
      ...overrides,
    };
  }

  function renderInto(page, overrides = {}) {
    renderSearchResults(page, getRenderPayload(overrides));
  }

  function setOpenProductPanel(product) {
    openProductPanel = product || null;
  }

  function getOpenProductPanel() {
    return openProductPanel;
  }

  function closeSearchProductPanel() {
    openProductPanel = null;
    document.body.classList.remove("product-open");
  }

  function setQuery(nextQuery = "") {
    currentQuery = String(nextQuery || "");
    closeSearchProductPanel();
    onQueryChange?.(currentQuery);
  }

  function syncQuery(nextQuery = "") {
    currentQuery = String(nextQuery || "");
  }

  function handleTermSelect(term) {
    currentQuery = String(term || "");
    closeSearchProductPanel();
    onQueryChange?.(currentQuery);
  }

  function scheduleProductSearch(page, overrides = {}) {
    const normalizedQuery = String(currentQuery || "").trim();
    window.clearTimeout(debounceTimer);
    latestRequestId += 1;
    const requestId = latestRequestId;

    if (!normalizedQuery) {
      currentProducts = [];
      productsLoading = false;
      productsError = "";
      renderInto(page, overrides);
      return;
    }

    productsLoading = true;
    productsError = "";
    renderInto(page, overrides);

    debounceTimer = window.setTimeout(async () => {
      try {
        const productLimit = hasMatchingCharacter(normalizedQuery) ? 2 : 10;
        const result = await searchSiteProducts({ siteSlug, query: normalizedQuery, limit: productLimit, guestMode });
        if (requestId !== latestRequestId) return;
        currentProducts = Array.isArray(result.items) ? result.items : [];
        productsError = "";
      } catch (error) {
        if (requestId !== latestRequestId) return;
        currentProducts = [];
        productsError = getUserFacingErrorMessage(error, {
          pageLanguage,
          fallbackType: "generic",
          allowKnownValidation: false,
        });
      } finally {
        if (requestId !== latestRequestId) return;
        productsLoading = false;
        renderInto(page, overrides);
      }
    }, PRODUCT_SEARCH_DEBOUNCE_MS);
  }

  function hasMatchingCharacter(query = "") {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    return Boolean(normalizedQuery) && characters.some((character) => (
      String(character?.name || "").trim().toLowerCase().includes(normalizedQuery)
    ));
  }

  return {
    getOpenProductPanel,
    handleTermSelect,
    renderInto,
    scheduleProductSearch,
    setOpenProductPanel,
    setQuery,
    syncQuery,
  };
}
