import assert from "node:assert/strict";
import { getDbPool, closeDbPool, initializeDatabase } from "../server/db.js";
import { SUPPORTED_CHARACTER_LANGUAGES } from "../shared/language-library.js";
import {
  applySessionLanguagePreference,
  detectRequestedLanguageSwitch,
} from "../server/chat-language-preference-service.js";

const isolated = process.argv.includes('--isolated');
globalThis.fetch = async () => { throw Error('Unexpected network in language preference self-check'); };
const { normalizeJevResponse, buildQuestions } = await import('../server/jev-intent-service.js');
const semantic = (code, scope = 'session', confidence = .95) => normalizeJevResponse({ answers: { route: { choice: 'daily_chat', confidence: .9 }, reply_language: { choice: code, confidence }, reply_language_scope: { choice: scope, confidence } } });
const db = getDbPool();
const USER_ID = "self_check_language_pref_user";
const CHARACTER_ID = "self_check_language_pref_character";
const SESSION_ID = "self_check_language_pref_session";

try {
  for (const language of SUPPORTED_CHARACTER_LANGUAGES) {
    for (const input of [language.label, `${language.label} please`, `Please ${language.label}!`]) {
      assertLanguagePreference(detectRequestedLanguageSwitch(input), {
        code: language.code, label: language.label, scope: "session",
      }, `standalone language selection should resolve ${input}`);
    }
  }
  for (const [input, code] of [["English.", "en"], ["english please!", "en"], ["Magyar", "hu"], ["español", "es"], ["Français", "fr"], ["中文。", "zh"], ["普通话", "zh"], ["한국어", "ko"], ["ภาษาไทย", "th"], ["Bahasa Indonesia", "id"]]) {
    assert.equal(detectRequestedLanguageSwitch(input)?.code, code, `standalone native alias should resolve ${input}`);
  }
  for (const input of ["hi", "Hi!", "no", "No please", "it", "Please it", "en", "zh-cn", "fr", "nor", "h i", "English please please", "I like English football", "English or Spanish?", "English and Magyar", "not English", "Why do you speak English?", "为什么你说中文", "English jersey please", "English\nSpanish", "French fries", "Italian jersey"]) {
    assert.equal(detectRequestedLanguageSwitch(input), null, `ordinary/ambiguous language mentions must not switch: ${input}`);
  }
  const guestUpdates = [];
  const guestDb = {
    async execute(sql, values) {
      assert.match(sql, /^UPDATE chat_sessions SET preferred_language/, "guest language selection must only update its session");
      guestUpdates.push(values);
      return [{ affectedRows: 1 }];
    },
  };
  const guestSession = { id: "mock_guest_language_session", preferred_language: "Spanish" };
  const guestCharacter = { id: "mock_guest_character", profile_json: '{"language":"Spanish"}', persona_prompt: "Existing persona." };
  const guestStandalone = await applySessionLanguagePreference(guestDb, {
    character: guestCharacter, session: guestSession, userText: "English please.",
  });
  assert.equal(guestStandalone.languageCode, "en", "standalone selection must apply to a guest prompt");
  assert.equal(guestStandalone.scope, "session", "standalone guest selection must stay session-scoped");
  assert.match(guestStandalone.character.persona_prompt, /Use English/, "guest language selection must update runtime language guidance");
  assert.deepEqual(guestUpdates, [["English", guestSession.id]], "guest language selection must persist only its own session");
  const guestFollowup = await applySessionLanguagePreference(guestDb, {
    character: guestCharacter, session: guestSession, userText: "Hola, quiero hablar de fútbol.",
  });
  assert.equal(guestFollowup.languageCode, "en", "ordinary foreign-language input must retain the selected language");
  assert.equal(guestUpdates.length, 1, "ordinary input must not write another preference");
  assert.equal(guestCharacter.persona_prompt, "Existing persona.", "language selection must not mutate the shared character");
  const writes = [];
  const mockDb = { execute: async (sql, values) => {
    if (/^SELECT/.test(sql.trim())) return [[{ preferred_language_code: 'hu', preferred_language_label: 'Hungarian' }]];
    assert.match(sql, /^UPDATE (chat_sessions|user_character_activations)/); writes.push({ sql, values }); return [{ affectedRows: 1 }];
  } };
  const makeSession = () => ({ id: 'isolated-language-session', preferred_language: 'Hungarian' });
  const baseCharacter = { id: 'isolated-language-character', profile_json: '{"language":"Hungarian","defaultLanguageCode":"hu"}', persona_prompt: 'Keep existing character style.' };
  for (const scope of ['turn', 'session', 'persistent']) {
    writes.length = 0;
    const session = makeSession();
    const result = await applySessionLanguagePreference(mockDb, { character: baseCharacter, session, userId: 'isolated-user', userText: 'Let’s just chat in English. I had a long day and want to relax, no shopping.', jevDecision: semantic('en', scope) });
    assert.equal(result.languageCode, 'en'); assert.equal(result.scope, scope);
    assert.equal(JSON.parse(result.character.profile_json).languageCode, result.languageCode, 'prompt profile shares the resolved reviewer/TTS code');
    assert.match(result.character.persona_prompt, /Use English/);
    assert.equal(writes.length, scope === 'turn' ? 0 : scope === 'session' ? 1 : 2);
    assert.equal(session.preferred_language, scope === 'turn' ? 'Hungarian' : 'English');
    if (scope === 'turn') {
      const next = await applySessionLanguagePreference(mockDb, { character: baseCharacter, session, userId: 'isolated-user', userText: 'Hello' });
      assert.equal(next.languageCode, 'hu', 'turn-only preference must not leak to the next reply');
    }
  }
  writes.length = 0;
  const guestPersistent = await applySessionLanguagePreference(mockDb, { character: baseCharacter, session: makeSession(), userText: 'Use English by default.', jevDecision: semantic('en', 'persistent') });
  assert.equal(guestPersistent.languageCode, 'en'); assert.equal(writes.length, 1, 'guest has session storage only, never writes a user activation');
  for (const text of ['Do not reply in English.', 'He said "reply in English", what does that mean?', 'Why do you speak English?', 'Translate "hello" into English.', 'Beszéljünk angolul.', 'Hablemos en inglés.']) {
    assert.equal(detectRequestedLanguageSwitch(text), null, 'complex language meaning is never authorized by a verb regex');
  }
  for (const decision of [null, { ok: false }, semantic('none'), semantic('xx'), semantic('en', 'none'), semantic('en', 'session', '0.95'), { ok: true, languageDecision: { targetCode: 'en', scope: 'session', confidence: NaN } }]) {
    writes.length = 0;
    const unchanged = await applySessionLanguagePreference(mockDb, { character: baseCharacter, session: makeSession(), userText: 'chat in English', jevDecision: decision });
    assert.equal(unchanged.languageCode, 'hu'); assert.equal(writes.length, 0, 'missing/old/failed/invalid semantic output preserves preferences');
  }
  writes.length = 0;
  const lowScoreChoice = await applySessionLanguagePreference(mockDb, { character: baseCharacter, session: makeSession(), userText: 'chat in English', jevDecision: semantic('en', 'session', .01) });
  assert.equal(lowScoreChoice.languageCode, 'en', 'valid selected language is not discarded for low confidence');
  writes.length = 0;
  const loadOnly = await applySessionLanguagePreference(mockDb, { character: baseCharacter, session: makeSession(), userText: 'English', resolveOnly: true, jevDecision: semantic('en') });
  assert.equal(loadOnly.languageCode, 'hu'); assert.equal(writes.length, 0, 'initial load waits for the existing request JEV decision');
  for (const language of SUPPORTED_CHARACTER_LANGUAGES) {
    const decision = semantic(language.code, 'turn'); assert.equal(decision.primaryIntent, 'daily_chat');
    const result = await applySessionLanguagePreference(mockDb, { character: baseCharacter, session: makeSession(), userText: 'current explicit language instruction', jevDecision: decision });
    assert.equal(result.languageCode, language.code);
  }
  assert.equal(Object.keys(buildQuestions().reply_language.criteria).length, SUPPORTED_CHARACTER_LANGUAGES.length + 1);
  if (isolated) { console.log('Language preference isolated checks passed: existing standalone selectors, 43 semantic codes, explicit scopes, missing/invalid decisions, prompt parity; no DB/network'); await closeDbPool(); process.exit(0); }
  await initializeDatabase();
  await cleanup();
  await seedFixture();

  assert.equal(detectRequestedLanguageSwitch("以后用英文和我聊"), null, "complex requests require a validated semantic decision");
  assert.equal(detectRequestedLanguageSwitch("用日语说一遍"), null, "complex requests require a validated semantic decision");
  assert.equal(
    detectRequestedLanguageSwitch("no i 1, you 0"),
    null,
    "short language tokens in ordinary chat should not switch the reply language"
  );
  assert.equal(
    detectRequestedLanguageSwitch("no, you lead 1-0"),
    null,
    "ordinary no/score text should not be treated as Norwegian"
  );
  assert.equal(
    detectRequestedLanguageSwitch("why you speak chinese"),
    null,
    "asking why the character used a language should not switch into that language"
  );
  assert.equal(
    detectRequestedLanguageSwitch("为什么你说中文"),
    null,
    "Chinese language questions should not become a language switch request"
  );
  assert.equal(detectRequestedLanguageSwitch("speak Norwegian from now on"), null, "complex requests require a validated semantic decision");

  const character = await loadCharacter();
  const session = await loadSession();
  const standalone = await applySessionLanguagePreference(db, {
    character, session, userId: USER_ID, userText: "Magyar please",
  });
  assert.equal(standalone.languageCode, "hu", "standalone registered selection must apply to the prompt");
  assert.equal(standalone.scope, "session", "standalone selection must not become persistent");
  assert.match(standalone.character.persona_prompt, /Hungarian/, "the selected language must reach the character prompt");
  const [[sessionAfterStandalone]] = await db.execute("SELECT preferred_language FROM chat_sessions WHERE id = ?", [SESSION_ID]);
  assert.equal(sessionAfterStandalone.preferred_language, "Hungarian", "standalone selection must persist on the session");
  const [[activationAfterStandalone]] = await db.execute("SELECT preferred_language_code FROM user_character_activations WHERE internal_uid = ? AND character_id = ?", [USER_ID, CHARACTER_ID]);
  assert.notEqual(activationAfterStandalone.preferred_language_code, "hu", "standalone selection must not overwrite long-term activation preference");
  const persistent = await applySessionLanguagePreference(db, {
    character,
    session,
    userId: USER_ID,
    userText: "以后用普通话和我聊", jevDecision: semantic("zh", "persistent"),
  });

  assert.equal(persistent.language, "Chinese (Mandarin)");
  assert.equal(persistent.languageCode, "zh");
  assert.equal(persistent.scope, "persistent");
  assert.match(persistent.character.persona_prompt, /Chinese \(Mandarin\)/);

  const [[activationAfterPersistent]] = await db.execute(
    `SELECT preferred_language_code, preferred_language_label
     FROM user_character_activations
     WHERE internal_uid = ? AND character_id = ?
     LIMIT 1`,
    [USER_ID, CHARACTER_ID]
  );
  assert.equal(activationAfterPersistent.preferred_language_code, "zh");
  assert.equal(activationAfterPersistent.preferred_language_label, "Chinese (Mandarin)");

  const [[publicCharacterAfterPersistent]] = await db.execute(
    "SELECT profile_json, persona_prompt FROM ai_characters WHERE id = ? LIMIT 1",
    [CHARACTER_ID]
  );
  assert.doesNotMatch(publicCharacterAfterPersistent.persona_prompt, /Chinese \(Mandarin\)/, "public character prompt should not be rewritten");
  assert.equal(parseJsonObject(publicCharacterAfterPersistent.profile_json).defaultLanguageCode, "en", "public character default language should remain unchanged");

  const oneOff = await applySessionLanguagePreference(db, {
    character: await loadCharacter(),
    session: await loadSession(),
    userId: USER_ID,
    userText: "用日语说一遍", jevDecision: semantic("ja", "turn"),
  });
  assert.equal(oneOff.language, "Japanese");
  assert.equal(oneOff.languageCode, "ja");
  assert.equal(oneOff.scope, "turn");

  const [[activationAfterOneOff]] = await db.execute(
    `SELECT preferred_language_code, preferred_language_label
     FROM user_character_activations
     WHERE internal_uid = ? AND character_id = ?
     LIMIT 1`,
    [USER_ID, CHARACTER_ID]
  );
  assert.equal(activationAfterOneOff.preferred_language_code, "zh", "one-off language request should not overwrite long-term preference");
  assert.equal(activationAfterOneOff.preferred_language_label, "Chinese (Mandarin)");

  const fallback = await applySessionLanguagePreference(db, {
    character: await loadCharacter(),
    session: { ...(await loadSession()), preferred_language: "" },
    userId: USER_ID,
    userText: "hello",
  });
  assert.equal(fallback.language, "Chinese (Mandarin)", "existing activation preference should be used when the user does not request another language");
  assert.equal(fallback.languageCode, "zh");
  assert.equal(fallback.scope, "activation");

  console.log("chat user-character language preference self-check passed");
} finally {
  if (!isolated) await cleanup();
  await closeDbPool();
}

async function seedFixture() {
  await db.execute(
    `INSERT INTO users (id, platform, platform_uid, locale, username, email, password_hash, nickname, account_type, account_status)
     VALUES (?, 'web', ?, 'cn', 'self-check-language-pref', 'self-check-language-pref@example.local', 'x', 'Language Preference Check', 'personal', 'active')
     ON DUPLICATE KEY UPDATE account_status = 'active', updated_at = NOW(3)`,
    [USER_ID, USER_ID]
  );
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, voice_provider, voice_id, voice_style, voice_sample_url,
       tags_json, profile_json, metrics_json, visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'companion', NULL, NULL, ?, 'Language Pref Character', 'Companion', 'Temporary language preference check.',
       '', '', 'Hello.', 'Base persona.', 'Calm', 'elevenlabs', 'EXAVITQu4vr4xnSDxMaL', 'Nova', '/uploads/voice/presets/nova.mp3',
       JSON_ARRAY('self-check'), JSON_OBJECT('language', 'English', 'defaultLanguageCode', 'en', 'defaultLanguageLabel', 'English'),
       JSON_OBJECT('chatCountLabel', '0'), 'public', 'published', 'self-check', 'language-preference', NOW(3))
     ON DUPLICATE KEY UPDATE
       profile_json = VALUES(profile_json),
       persona_prompt = VALUES(persona_prompt),
       character_status = 'published',
       updated_at = NOW(3)`,
    [CHARACTER_ID, CHARACTER_ID]
  );
  await db.execute(
    `INSERT INTO user_character_activations (
       id, internal_uid, character_id, activation_status, source_type, source_ref
     ) VALUES ('self_check_language_pref_activation', ?, ?, 'active', 'self-check', 'language-preference')
     ON DUPLICATE KEY UPDATE
       activation_status = 'active',
       source_type = 'self-check',
       source_ref = 'language-preference',
       updated_at = NOW(3)`,
    [USER_ID, CHARACTER_ID]
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at
     ) VALUES (?, ?, ?, 'Language Preference Session', 'active', 'user', 'language-preference', NULL, NOW(3))
     ON DUPLICATE KEY UPDATE
       preferred_language = NULL,
       updated_at = NOW(3)`,
    [SESSION_ID, USER_ID, CHARACTER_ID]
  );
}

async function loadCharacter() {
  const [[row]] = await db.execute("SELECT * FROM ai_characters WHERE id = ? LIMIT 1", [CHARACTER_ID]);
  return row;
}

async function loadSession() {
  const [[row]] = await db.execute("SELECT * FROM chat_sessions WHERE id = ? LIMIT 1", [SESSION_ID]);
  return row;
}

async function cleanup() {
  await db.execute("DELETE FROM chat_messages WHERE session_id = ?", [SESSION_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [SESSION_ID]).catch(() => {});
  await db.execute("DELETE FROM user_character_activations WHERE internal_uid = ? OR character_id = ?", [USER_ID, CHARACTER_ID]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [CHARACTER_ID]).catch(() => {});
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [USER_ID]).catch(() => {});
}

function assertLanguagePreference(actual, expected, message) {
  assert.equal(actual?.code, expected.code, message);
  assert.equal(actual?.label, expected.label, message);
  assert.equal(actual?.scope, expected.scope, message);
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return JSON.parse(String(value || "{}"));
}
