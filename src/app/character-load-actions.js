import { trackEvent } from "../analytics/track.js";
import { getCharacterDetail, listCharacters } from "../services/character-service.js";
import { listHomeCarouselItems } from "../services/home-carousel-service.js";
import { getUserFacingErrorMessage } from "../utils/user-facing-error.js";

export function createCharacterLoadActions({ appState, mountApp, loadChatMessages } = {}) {
  async function loadCarousel({ force = false } = {}) {
    if (appState.carousel.loading || (appState.carousel.loaded && !force)) return;

    appState.carousel.loading = true;
    appState.carousel.error = "";
    mountApp();

    try {
      const result = await listHomeCarouselItems({ siteSlug: appState.site.currentSlug || appState.site.defaultSlug || "gogoalshop" });
      appState.carousel.items = Array.isArray(result.items) ? result.items : [];
      appState.carousel.loaded = true;
      appState.carousel.error = "";
    } catch (error) {
      appState.carousel.error = getUserFacingErrorMessage(error, {
        pageLanguage: appState.site?.pageLanguage,
        fallbackType: "generic",
        allowKnownValidation: false,
      });
      trackEvent("home_carousel_load_failed", {
        reason: error.message,
        status: error.status || 0,
      });
    } finally {
      appState.carousel.loading = false;
      mountApp();
    }
  }

  async function loadCharacters({ force = false } = {}) {
    const siteSlug = appState.site.currentSlug || appState.site.defaultSlug || "gogoalshop";
    const siteChanged = appState.characters.siteSlug && appState.characters.siteSlug !== siteSlug;
    if (appState.characters.loading || (appState.characters.loaded && !force && !siteChanged)) {
      return;
    }

    appState.characters.loading = true;
    appState.characters.error = "";
    mountApp();

    try {
      const result = await listCharacters({ siteSlug });
      appState.characters.items = Array.isArray(result.characters) ? result.characters : [];
      appState.characters.categories = Array.isArray(result.categories) ? result.categories : [];
      appState.category = resolveAvailableCharacterCategory(appState.category, appState.characters.categories);
      appState.characters.loaded = true;
      appState.characters.siteSlug = siteSlug;
      appState.characters.error = "";
      if (!appState.characters.current && appState.agent) {
        appState.characters.current = appState.characters.items.find((item) => item.id === appState.agent) || null;
      }
      trackEvent("characters_list_loaded", {
        count: appState.characters.items.length,
        category_count: appState.characters.categories.length,
      });
    } catch (error) {
      appState.characters.error = getUserFacingErrorMessage(error, {
        pageLanguage: appState.site?.pageLanguage,
        fallbackType: "generic",
        allowKnownValidation: false,
      });
      trackEvent("characters_list_failed", {
        reason: error.message,
        status: error.status || 0,
      });
    } finally {
      appState.characters.loading = false;
      mountApp();
    }
  }

  async function loadCurrentCharacter(characterId) {
    const normalizedId = String(characterId || "").trim();
    if (!normalizedId) {
      appState.characters.current = null;
      mountApp();
      return;
    }

    const cachedCharacter = appState.characters.items.find((item) => item.id === normalizedId);
    if (cachedCharacter) {
      appState.characters.current = cachedCharacter;
      mountApp();
    }

    try {
      const result = await getCharacterDetail(normalizedId, {
        siteSlug: appState.site.currentSlug || appState.site.defaultSlug || "gogoalshop",
      });
      appState.characters.current = result.character || cachedCharacter || null;
      trackEvent("character_detail_loaded", {
        character_id: normalizedId,
        has_character: Boolean(appState.characters.current),
      });
    } catch (error) {
      appState.characters.current = cachedCharacter || appState.characters.current;
      trackEvent("character_detail_failed", {
        character_id: normalizedId,
        reason: error.message,
        status: error.status || 0,
      });
    } finally {
      mountApp();
    }
  }

  function loadCharactersForView(view, agent) {
    if (["discover", "search", "kitshop", "create"].includes(view)) {
      void loadCharacters();
      if (view === "discover") void loadCarousel();
      return;
    }

    if (view === "chat") {
      const characterId = agent || appState.agent;
      void loadCharacters();
      void loadCurrentCharacter(characterId);
      void loadChatMessages(characterId);
    }
  }

  return {
    loadCarousel,
    loadCharacters,
    loadCurrentCharacter,
    loadCharactersForView,
  };
}

export function resolveAvailableCharacterCategory(activeCategory = "", categories = []) {
  const labels = categories.map((item) => String(item?.label || "").trim()).filter(Boolean);
  const normalizedActiveCategory = String(activeCategory || "").trim();
  return labels.includes(normalizedActiveCategory) ? normalizedActiveCategory : labels[0] || "";
}
