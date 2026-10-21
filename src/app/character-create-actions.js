import { trackEvent } from "../analytics/track.js";
import { createCharacter, polishCharacterBackstory } from "../services/character-service.js";
import { validateCreateCharacterPayload } from "../features/create-character/create-character-validation.js";
import { createSiteCopy } from "../i18n/site-copy.js";

export function createCharacterCreateActions({ appState, mountApp, loadCharacters, loadChatContacts } = {}) {
  async function handleCreateCharacterSubmit(payload) {
    const copy = createSiteCopy(appState.site?.pageLanguage);
    const accessError = validateCreateAccess(payload, appState.session, copy);
    if (accessError) {
      appState.create.error = accessError;
      trackEvent("character_create_access_failed", {
        reason: accessError,
        account_type: appState.session.accountType || "personal",
      });
      mountApp();
      return null;
    }

    const validationError = validateCreateCharacterPayload(payload, { pageLanguage: appState.site?.pageLanguage });
    if (validationError) {
      appState.create.error = validationError;
      trackEvent("character_create_validation_failed", {
        reason: validationError,
      });
      mountApp();
      return null;
    }

    appState.create.submitting = true;
    appState.create.error = "";
    mountApp();

    try {
      const result = await createCharacter(payload);
      const character = result.character;
      if (!character?.id) {
        throw new Error("Character creation failed. Please try again.");
      }

      appState.agent = character.id;
      appState.characters.current = character;
      appState.characters.loaded = false;
      appState.chat.session = null;
      appState.chat.messages = [];
      appState.chat.error = "";
      trackEvent("character_created", {
        character_id: character.id,
        category: payload.categoryId || payload.category || "",
        has_backstory: Boolean(payload.backstory),
      });
      await loadChatContacts?.();
      void loadCharacters({ force: true });
      return character;
    } catch (error) {
      appState.create.error = copy.t("create.failed");
      trackEvent("character_create_failed", {
        reason: appState.create.error,
        raw_reason: error.message,
        status: error.status || 0,
      });
      mountApp();
      return null;
    } finally {
      appState.create.submitting = false;
      mountApp();
    }
  }

  async function handlePolishBackstory(payload) {
    const copy = createSiteCopy(appState.site?.pageLanguage);
    appState.create.polishing = true;
    appState.create.polishError = "";
    appState.create.error = "";
    mountApp();

    try {
      const result = await polishCharacterBackstory(payload);
      const text = String(result.text || "").trim();
      if (!text) {
        throw new Error("AI polish did not return usable text.");
      }
      appState.create.backstory = text;
      trackEvent("character_backstory_polished", {
        category: payload.categoryId || "",
        has_name: Boolean(payload.name),
      });
      return text;
    } catch (error) {
      appState.create.polishError = copy.t("create.failed");
      trackEvent("character_backstory_polish_failed", {
        reason: appState.create.polishError,
        raw_reason: error.message,
        status: error.status || 0,
      });
      return "";
    } finally {
      appState.create.polishing = false;
      mountApp();
    }
  }

  return {
    handleCreateCharacterSubmit,
    handlePolishBackstory,
  };
}

function validateCreateAccess(payload = {}, session = {}, copy = createSiteCopy("English")) {
  const categoryId = normalizeCategoryId(payload.categoryId || payload.category);
  if (categoryId !== "creator") return "";
  const accountType = String(session.accountType || "personal").trim().toLowerCase();
  if (accountType === "admin") return "";
  if (accountType !== "creator") return copy.t("create.creatorOnly");
  if (!session.siteId) return copy.t("create.creatorSiteRequired");
  return "";
}

function normalizeCategoryId(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return {
    babe: "football_babe",
    football_babe: "football_babe",
    creator: "creator",
    pundit: "pundit",
    fan: "fan",
    companion: "companion",
  }[normalized] || normalized;
}
