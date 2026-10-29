import { SUPPORTED_CHARACTER_LANGUAGES, normalizeCharacterLanguage } from "../shared/language-library.js";
import { normalizeSiteLanguage } from "../shared/site-language.js";

const LANGUAGE_SETTING_PREFIX = "Language guidance: Use ";
const LANGUAGE_SETTING_SUFFIX = " as the configured output language. Do not change output language just because the user's message is written in another language. Change the configured language only when the user explicitly asks you to reply, speak, or write in a specific language. A current-turn language-preference question may follow the narrowly bounded exception in the global reply policy after complete review; it never changes this configured language.";

const LANGUAGE_SETTING_LINE_PATTERN = /^Language (?:setting: You are good at multilingual communication\. By default, communicate with the user in .+\.|guidance: Use .+(?: unless the user clearly asks for another language\.|\. Do not mirror the user's language; switch only when the user clearly asks for another language\.| as the configured output language\. Do not change output language just because the user's message is written in another language\. Change language only when the user explicitly asks you to reply, speak, or write in a specific language\.))$/gim;

// Match the exact current canonical suffix as well as the historical lines
// above, so repeated preference application never stacks language guidance.
const CURRENT_LANGUAGE_SETTING_LINE_PATTERN = new RegExp(`^Language guidance: Use .+${LANGUAGE_SETTING_SUFFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "gim");

export async function applySessionLanguagePreference(db, { character, session, userId = "", userText = "", jevDecision = null, resolveOnly = false }) {
  // Initial loading never guesses or saves a preference. After the existing
  // request-local JEV call, all consumers share this one validated decision.
  const candidate = jevDecision?.ok === true ? jevDecision.languageDecision : null;
  const semantic = candidate && ['turn', 'session', 'persistent'].includes(candidate.scope)
    && typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence)
    && candidate.confidence >= 0 && candidate.confidence <= 1
    && SUPPORTED_CHARACTER_LANGUAGES.some(language => language.code === candidate.targetCode)
    ? { ...normalizeCharacterLanguage(candidate.targetCode), scope: candidate.scope } : null;
  // Active turns carry the shared decision, including valid uncertainty. A
  // language keyword must not replace it; keep the utility for legacy callers.
  const requested = resolveOnly ? null : semantic || (jevDecision == null ? detectRequestedLanguageSwitch(userText) : null);
  const activationPreference = await loadActivationLanguagePreference(db, {
    userId,
    characterId: character?.id || session?.character_id || session?.characterId,
  });
  const sessionPreference = normalizePreference(session?.preferred_language || session?.preferredLanguage);
  const characterPreference = normalizePreference(
    parseJsonObject(character?.profile_json || character?.profile).defaultLanguageCode ||
    parseJsonObject(character?.profile_json || character?.profile).languageCode ||
    parseJsonObject(character?.profile_json || character?.profile).defaultLanguageLabel ||
    parseJsonObject(character?.profile_json || character?.profile).language
  );
  const selected = requested || sessionPreference || activationPreference || characterPreference;

  if (!selected) {
    return {
      character,
      language: "",
      languageCode: "",
      languageLabel: "",
      scope: "",
    };
  }

  if (requested && requested.scope !== "turn") {
    await saveSessionLanguagePreference(db, session, selected);
    if (requested.scope === "persistent" && activationPreference?.code !== selected.code) {
      await saveActivationLanguagePreference(db, {
        userId,
        characterId: character?.id || session?.character_id || session?.characterId,
        language: selected,
      });
    }
  }

  const nextScope = selected.scope || (sessionPreference ? "session" : activationPreference ? "activation" : "character");
  return {
    character: buildCharacterWithLanguage(character, selected),
    language: selected.label,
    languageCode: selected.code,
    languageLabel: selected.label,
    scope: nextScope,
  };
}

export async function resolveInitialSessionLanguagePreference(db, {
  character,
  userId = "",
  siteLanguage = "",
} = {}) {
  const activationPreference = await loadActivationLanguagePreference(db, {
    userId,
    characterId: character?.id || character?.character_id || character?.characterId,
  });
  const normalizedSiteLanguage = safeString(siteLanguage)
    ? normalizeSiteLanguage(siteLanguage)
    : null;
  const sitePreference = normalizePreference(normalizedSiteLanguage?.code);
  const profile = parseJsonObject(character?.profile_json || character?.profile);
  const characterPreference = normalizePreference(
    profile.defaultLanguageCode || profile.languageCode || profile.defaultLanguageLabel || profile.language
  );
  return resolveCharacterInitialLanguagePreference({
    activationPreference,
    sitePreference,
    characterPreference,
    characterSourceType: character?.source_type || character?.sourceType,
  });
}

// Character content is never translated here. This only selects the language
// used to start a brand-new conversation. User-created characters keep the
// language chosen by their creator; admin-managed characters inherit the
// trusted site language so the same character can serve multiple site locales.
export function resolveCharacterInitialLanguagePreference({
  activationPreference = null,
  sitePreference = null,
  characterPreference = null,
  characterSourceType = "",
} = {}) {
  if (activationPreference) return activationPreference;
  if (safeString(characterSourceType).toLowerCase() === "user") {
    return characterPreference || sitePreference || normalizePreference("English");
  }
  return sitePreference || characterPreference || normalizePreference("English");
}

export function detectRequestedLanguageSwitch(text = "") {
  const source = safeString(text);
  if (!source) return null;
  const standaloneLanguage = findStandaloneLanguageSelection(source);
  return standaloneLanguage ? { ...standaloneLanguage, scope: "session" } : null;
}

function findStandaloneLanguageSelection(source = "") {
  const trimPunctuation = (value) => value.replace(/^[\s.!?。！？,，;；:：]+|[\s.!?。！？,，;；:：]+$/g, "").trim();
  const candidate = trimPunctuation(trimPunctuation(source)
    .replace(/^please[\s,，:：]+/i, "")
    .replace(/[\s,，]+please$/i, ""));
  // Short ASCII aliases are ordinary words too (hi/no/it). They remain valid
  // configuration codes, but never qualify as standalone chat selections.
  if (/^[a-z]{2,3}$/i.test(normalizeLooseText(candidate))
    || /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})+$/i.test(candidate)) return null;
  return normalizeCharacterLanguage(candidate);
}

export function upsertPersonaLanguageSetting(personaPrompt = "", language = "") {
  const normalizedLanguage = normalizePreference(language);
  const label = normalizedLanguage?.label || safeString(language);
  const basePrompt = safeString(personaPrompt).replace(LANGUAGE_SETTING_LINE_PATTERN, "").replace(CURRENT_LANGUAGE_SETTING_LINE_PATTERN, "").trim();
  const languageLine = label ? `${LANGUAGE_SETTING_PREFIX}${label}${LANGUAGE_SETTING_SUFFIX}` : "";
  return [basePrompt, languageLine].filter(Boolean).join("\n\n");
}

async function loadActivationLanguagePreference(db, { userId = "", characterId = "" } = {}) {
  const normalizedUserId = safeString(userId);
  const normalizedCharacterId = safeString(characterId);
  if (!normalizedUserId || !normalizedCharacterId) return null;

  const [[row]] = await db.execute(
    `SELECT preferred_language_code, preferred_language_label
     FROM user_character_activations
     WHERE internal_uid = ?
       AND character_id = ?
       AND activation_status = 'active'
     LIMIT 1`,
    [normalizedUserId, normalizedCharacterId]
  );
  return normalizePreference(row?.preferred_language_code || row?.preferred_language_label);
}

async function saveActivationLanguagePreference(db, { userId = "", characterId = "", language = null } = {}) {
  const normalizedUserId = safeString(userId);
  const normalizedCharacterId = safeString(characterId);
  if (!normalizedUserId || !normalizedCharacterId || !language?.code) return;

  await db.execute(
    `UPDATE user_character_activations
     SET preferred_language_code = ?,
         preferred_language_label = ?,
         updated_at = NOW(3)
     WHERE internal_uid = ?
       AND character_id = ?
       AND activation_status = 'active'`,
    [language.code, language.label, normalizedUserId, normalizedCharacterId]
  );
}

async function saveSessionLanguagePreference(db, session = {}, language = null) {
  if (!session?.id || !language?.label) return;
  if (safeString(session.preferred_language || session.preferredLanguage) === language.label) return;
  await db.execute(
    "UPDATE chat_sessions SET preferred_language = ?, updated_at = NOW(3) WHERE id = ?",
    [language.label, session.id]
  );
  session.preferred_language = language.label;
}

function buildCharacterWithLanguage(character = {}, language = null) {
  const label = language?.label || "";
  if (!label) return character;

  const profile = parseJsonObject(character.profile_json || character.profile);
  const nextProfile = {
    ...profile,
    language: label,
    languageCode: language.code,
    languageLabel: label,
  };
  return {
    ...character,
    profile_json: JSON.stringify(nextProfile),
    persona_prompt: upsertPersonaLanguageSetting(character.persona_prompt || character.personaPrompt, label),
  };
}

function normalizePreference(value = "") {
  const language = normalizeCharacterLanguage(value);
  if (!language) return null;
  return {
    ...language,
    scope: "",
  };
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeLooseText(value = "") {
  return safeString(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[\s_().,，。/\\-]+/g, "");
}

function safeString(value = "") {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}
