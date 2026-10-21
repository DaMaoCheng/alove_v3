import { normalizeJevResponse } from "../server/jev-intent-service.js";
import assert from "node:assert/strict";
import { mapPublicSiteBranding } from "../server/site-branding-service.js";
import {
  applySessionLanguagePreference,
  resolveCharacterInitialLanguagePreference,
  resolveInitialSessionLanguagePreference,
} from "../server/chat-language-preference-service.js";
import { findOrCreateUserSession } from "../server/chat-session-service.js";
import { guestVoiceMeta } from "../server/guest-session-service.js";
import { normalizeSiteLanguage } from "../shared/site-language.js";
import { normalizeSiteBranding } from "../src/services/site-branding-service.js";

assert.deepEqual(normalizeSiteLanguage("Chinese (Mandarin)"), {
  code: "zh",
  label: "Chinese (Mandarin)",
  uiCode: "zh",
});
assert.deepEqual(normalizeSiteLanguage("unknown-language"), {
  code: "en",
  label: "English",
  uiCode: "en",
});

const publicChinese = mapPublicSiteBranding({
  id: "site_zh",
  slug: "language-zh-test",
  default_language: "Chinese (Mandarin)",
});
assert.deepEqual(publicChinese.language, {
  code: "zh",
  label: "Chinese (Mandarin)",
  uiCode: "zh",
});
assert.equal("default_language" in publicChinese, false, "public branding should expose only normalized language metadata");

const frontendChinese = normalizeSiteBranding(publicChinese);
assert.deepEqual(frontendChinese.language, publicChinese.language);

const dbWithoutActivation = {
  async execute(sql) {
    if (String(sql).includes("FROM user_character_activations")) return [[]];
    throw new Error(`Unexpected SQL: ${sql}`);
  },
};
const character = { id: "character_1", profile_json: JSON.stringify({ language: "English" }) };
const adminCharacterPreference = resolveCharacterInitialLanguagePreference({
  sitePreference: { code: "zh", label: "Chinese (Mandarin)" },
  characterPreference: { code: "en", label: "English" },
  characterSourceType: "admin",
});
assert.equal(adminCharacterPreference.label, "Chinese (Mandarin)", "admin-created characters should inherit the trusted site language");

const userCharacterPreference = resolveCharacterInitialLanguagePreference({
  sitePreference: { code: "zh", label: "Chinese (Mandarin)" },
  characterPreference: { code: "es", label: "Spanish" },
  characterSourceType: "user",
});
assert.equal(userCharacterPreference.label, "Spanish", "user-created characters should keep the language selected during creation");

const activatedUserCharacterPreference = resolveCharacterInitialLanguagePreference({
  activationPreference: { code: "fr", label: "French" },
  sitePreference: { code: "zh", label: "Chinese (Mandarin)" },
  characterPreference: { code: "es", label: "Spanish" },
  characterSourceType: "user",
});
assert.equal(activatedUserCharacterPreference.label, "French", "an explicit activation preference should remain the highest priority");
const initialChinese = await resolveInitialSessionLanguagePreference(dbWithoutActivation, {
  character,
  userId: "user_1",
  siteLanguage: "Chinese (Mandarin)",
});
assert.equal(initialChinese.label, "Chinese (Mandarin)", "site language should outrank the character default for a new session");

const dbWithActivation = {
  async execute(sql) {
    if (String(sql).includes("FROM user_character_activations")) {
      return [[{ preferred_language_code: "es", preferred_language_label: "Spanish" }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  },
};
const initialActivation = await resolveInitialSessionLanguagePreference(dbWithActivation, {
  character,
  userId: "user_1",
  siteLanguage: "Chinese (Mandarin)",
});
assert.equal(initialActivation.label, "Spanish", "an existing activation preference must keep priority over the site default");

const invalidSiteLanguage = await resolveInitialSessionLanguagePreference(dbWithoutActivation, {
  character: { ...character, profile_json: JSON.stringify({ language: "Spanish" }) },
  userId: "user_1",
  siteLanguage: "unsupported-language",
});
assert.equal(invalidSiteLanguage.label, "English", "unsupported site language values must fail closed to English before reaching the prompt");

const missingSiteLanguage = await resolveInitialSessionLanguagePreference(dbWithoutActivation, {
  character: { ...character, profile_json: JSON.stringify({ language: "Spanish" }) },
  userId: "user_1",
  siteLanguage: "",
});
assert.equal(missingSiteLanguage.label, "Spanish", "a missing site language should preserve the character default before the final English fallback");

const insertedSessions = [];
const newSessionDb = createSessionDb({
  siteLanguage: "Chinese (Mandarin)",
  insertedSessions,
});
const createdSession = await findOrCreateUserSession(newSessionDb, {
  character: { ...character, source_type: "admin" },
  userId: "new_user",
});
assert.equal(createdSession.preferred_language, "Chinese (Mandarin)", "a new formal session should freeze the account site's default language");
assert.equal(insertedSessions[0]?.at(-1), "Chinese (Mandarin)", "the stored formal session should receive the normalized site language");

const userCharacterSessions = [];
const userCharacterSessionDb = createSessionDb({
  siteLanguage: "Chinese (Mandarin)",
  insertedSessions: userCharacterSessions,
});
const createdUserCharacterSession = await findOrCreateUserSession(userCharacterSessionDb, {
  character: {
    ...character,
    source_type: "user",
    profile_json: JSON.stringify({ language: "Spanish" }),
  },
  userId: "user_character_owner",
});
assert.equal(createdUserCharacterSession.preferred_language, "Spanish", "a formal session with a user-created character should freeze that character's selected language");
assert.equal(userCharacterSessions[0]?.at(-1), "Spanish", "the database insert should preserve the user-created character language instead of the site default");

const existingSessionDb = createSessionDb({
  existingSession: {
    id: "existing_session",
    character_id: character.id,
    preferred_language: null,
  },
});
const existingSession = await findOrCreateUserSession(existingSessionDb, {
  character,
  userId: "existing_user",
});
assert.equal(existingSession.preferred_language, null, "an existing legacy session must not be backfilled or overwritten");
assert.equal(existingSessionDb.insertCount, 0, "an existing legacy session must not create a replacement session");

const guestOpeningVoice = guestVoiceMeta({
  voice_provider: "elevenlabs",
  voice_id: "voice_zh",
  profile_json: JSON.stringify({ language: "English", defaultLanguageCode: "en" }),
}, "", normalizeSiteLanguage("Chinese (Mandarin)"));
assert.equal(guestOpeningVoice.languageCode, "zh", "guest opening TTS should use the site language instead of the character profile language");
assert.equal(guestOpeningVoice.languageLabel, "Chinese (Mandarin)");

const guestSession = { id: "guest_chat_1", character_id: character.id, preferred_language: "English" };
const guestLanguageUpdates = [];
const guestPreferenceDb = {
  async execute(sql, values = []) {
    const source = String(sql);
    if (source.includes("UPDATE chat_sessions SET preferred_language")) {
      guestLanguageUpdates.push(values);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL in guest language preference self-check: ${source}`);
  },
};
const guestExplicitSwitch = await applySessionLanguagePreference(guestPreferenceDb, {
  character,
  session: guestSession,
  userText: "以后用中文回复我",
  jevDecision: normalizeJevResponse({ answers: {
    route: { choice: "daily_chat", confidence: .95 },
    reply_language: { choice: "zh", confidence: .95 },
    reply_language_scope: { choice: "persistent", confidence: .95 },
  } }),
});
assert.equal(guestExplicitSwitch.languageCode, "zh", "a guest should be able to explicitly override the frozen site language for that character session");
assert.match(guestExplicitSwitch.character.persona_prompt, /Chinese \(Mandarin\)/, "the guest prompt should receive the explicit language guidance");
assert.deepEqual(guestLanguageUpdates[0], ["Chinese (Mandarin)", guestSession.id], "the guest language switch should persist on its own chat session");
const guestReplyVoice = guestVoiceMeta(character, "", {
  languageCode: guestExplicitSwitch.languageCode,
  languageLabel: guestExplicitSwitch.languageLabel,
});
assert.equal(guestReplyVoice.languageCode, "zh", "guest reply TTS should use the same language as the prompt");
assert.equal(guestReplyVoice.languageLabel, "Chinese (Mandarin)");

console.log("site default language context self-check passed");

function createSessionDb({ siteLanguage = "English", existingSession = null, insertedSessions = [] } = {}) {
  const state = { insertCount: 0 };
  return {
    get insertCount() {
      return state.insertCount;
    },
    async execute(sql, values = []) {
      const source = String(sql);
      if (source.includes("SELECT id FROM users") && source.includes("FOR UPDATE")) return [[]];
      if (source.includes("FROM chat_sessions") && source.includes("session_status = 'active'")) {
        return [existingSession ? [existingSession] : []];
      }
      if (source.includes("FROM users u") && source.includes("LEFT JOIN sites")) {
        return [[{ default_language: siteLanguage }]];
      }
      if (source.includes("FROM user_character_activations")) return [[]];
      if (source.includes("INSERT INTO chat_sessions")) {
        state.insertCount += 1;
        insertedSessions.push(values);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in site language session self-check: ${source}`);
    },
  };
}
