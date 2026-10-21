import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
globalThis.fetch = async () => { throw new Error('External calls forbidden in registered site checks'); };
const { prepareChatIntentTurn } = await import('../server/chat-intent-turn-service.js');
const { resolveProductRecommendationSite } = await import('../server/product-recommendation-site-service.js');
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const userSite = { id: 'user_site', slug: 'user-shop' };
const ownSite = { id: 'character_site', slug: 'creator-shop' };
const defaultSite = { id: 'default_site', slug: 'default-shop' };
const scopeDb = { execute: async (sql, args) => {
  if (sql.includes('FROM chat_messages')) return [[]];
  if (sql.includes('FROM users u')) { check(args, ['registered_user'], 'site lookup receives trusted user ID'); return [[userSite]]; }
  if (sql.includes('FROM sites s') && sql.includes('WHERE s.id = ?')) {
    check(args, [ownSite.id], 'own-site query retains the trusted character site parameter');
    check(sql.includes('AS identity_mascot_character_id'), true, 'site identity projection is retained');
    return [[ownSite]];
  }
  if (sql.includes('is_default = 1')) return [[defaultSite]];
  throw new Error(`Unexpected SQL: ${sql}`);
} };
const options = { session: { id: 'session_without_owner_projection' }, character: { id: 'mascot_fixture', category_id: 'mascot', site_id: null },
  userId: 'registered_user', recentMessages: [], userText: 'Hola', classify: async () => ({ ok: true, confident: true, primaryIntent: 'chat', productIntent: 'none', productAction: 0 }),
  classifyCommerce: async () => ({ confident: true, confidence: .99, route: 'chat' }) };
check((await prepareChatIntentTurn(scopeDb, options)).commerceSite.id, userSite.id, 'registered preparation retains user site when session projection has no owner');
check((await prepareChatIntentTurn(scopeDb, { ...options, character: { ...options.character, site_id: ownSite.id } })).commerceSite.id, ownSite.id, 'mascot own product site priority remains intact');
check((await prepareChatIntentTurn(scopeDb, { ...options, userId: '', siteId: 'guest_site', siteSlug: 'guest-shop' })).commerceSite, { id: 'guest_site', slug: 'guest-shop' }, 'guest explicit server-resolved site remains intact');
check((await resolveProductRecommendationSite(scopeDb, { character: options.character })).id, defaultSite.id, 'anonymous default resolver behavior remains intact');

// Run the actual four registered entry functions up to the preparation seam.
// All imports are replaced by finite in-memory exports before the module loads;
// the sentinel prevents providers, persistence and order actions from running.
const stop = new Error('intent preparation reached');
let captured, lookupOptions, blockedCharacter = false;
const character = { id: 'mascot_fixture', category_id: 'mascot', site_id: null, name: 'Fixture' };
const session = { id: 'session_without_owner_projection' };
const noop = async () => {};
const db = { beginTransaction: noop, commit: noop, rollback: noop, release() {} };
const exports = {
  getDbPool: () => ({ getConnection: async () => db }),
  findCharacterById: async (_db, _id, access) => { lookupOptions = access; return blockedCharacter ? null : character; },
  findOrCreateUserSession: async () => session, findLatestUserSessionForDb: async () => session,
  ensureOpeningMessageWithVoiceForSession: noop, getNextMessageOrder: async () => 10,
  insertMessage: async (_db, message) => ({ ...message, id: 'user_message', displayOrder: message.displayOrder }),
  normalizeMessageText: text => text.trim(), normalizeVoiceTranscriptText: text => text.trim(), normalizeAttachmentPayload: value => value,
  isProductImageCardRequest: () => false, resolveCurrentProductImageCardContext: async () => null,
  listUserTextMessagesSince: async () => [{ id: 'user_message', text_content: 'Hola', display_order: 10 }],
  buildPendingUserText: rows => rows.map(row => row.text_content).join('\n'), listRecentMessagesBeforeOrder: async () => [],
  resolveStaleMascotGuard: async () => ({ stale: false }),
  applySessionLanguagePreference: async (_db, { character }) => ({ character, languageCode: 'es' }),
  resolveReplyVoiceModel: () => ({ model: 'test' }),
  findUserVoiceMessageForReply: async () => ({ id: 'user_message', text_content: 'Hola', display_order: 10 }),
  prepareChatIntentTurn: async (_db, options) => { captured = options; throw stop; },
  throwNotFound: () => { const error = new Error('not found'); error.statusCode = 404; throw error; },
};
const exportKey = '__registeredChatSiteCheckExports';
globalThis[exportKey] = exports;
try {
  async function loadEntry(file) {
    const source = await readFile(new URL(`../server/${file}`, import.meta.url), 'utf8');
    const rewritten = source.replace(/(import|export)\s*\{([^}]+)\}\s*from\s*["'][^"']+["']/g, (_whole, kind, list) => {
      const names = list.split(',').map(name => name.trim()).filter(Boolean);
      const proxy = names.map(name => `export const ${name}=globalThis.${exportKey}[${JSON.stringify(name)}]??(()=>{throw new Error(${JSON.stringify('Unexpected dependency: ' + name)})});`).join('\n');
      return `${kind} {${list}} from ${JSON.stringify('data:text/javascript;base64,' + Buffer.from(proxy).toString('base64'))}`;
    });
    return import('data:text/javascript;base64,' + Buffer.from(rewritten).toString('base64'));
  }
  const textEntry = await loadEntry('chat-text-message-service.js');
  const voiceEntry = await loadEntry('chat-voice-message-service.js');
  for (const [name, fn, extra] of [
    ['text-send', textEntry.createUserMessage, { text: 'Hola' }],
    ['text-reply', textEntry.createUserReply, { sinceMessageId: 'user_message', siteSlug: 'untrusted_client_site' }],
    ['voice-send', voiceEntry.createUserVoiceMessage, { transcriptText: 'Hola' }],
    ['voice-reply', voiceEntry.createUserVoiceReply, { messageId: 'user_message' }],
  ]) {
    captured = null; lookupOptions = null;
    await assert.rejects(fn({ characterId: character.id, userId: ' registered_user ', ...extra }), error => error === stop, name + ' reaches actual preparation call');
    check(captured.userId, 'registered_user', name + ' forwards normalized authenticated user');
    check(captured.siteId, undefined, name + ' does not accept client site override');
    check(lookupOptions, { userId: 'registered_user' }, name + ' retains character visibility/owner check');
    captured = null;
    await assert.rejects(fn({ characterId: character.id, userId: '', ...extra }), error => error.statusCode === 401);
    check(captured, null, name + ' unauthenticated request cannot prepare intent');
    blockedCharacter = true;
    await assert.rejects(fn({ characterId: character.id, userId: 'registered_user', ...extra }), error => error.statusCode === 404);
    check(captured, null, name + ' invisible character cannot prepare intent');
    blockedCharacter = false;
  }
} finally { delete globalThis[exportKey]; }
console.log(`registered chat site scope self-check passed (${checks} checks; real text/voice entry calls and intent preparation; no DB/network writes)`);
