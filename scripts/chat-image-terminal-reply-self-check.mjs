import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import {removeTtsControlTags} from '../server/tts-emotion-tag-service.js';
import {normalizeGuestReplyText,sanitizeGuestReplyText} from '../server/guest-chat-output-policy.js';
import { withChatImageReplySnapshot, isFulfilledImageOnlyRequest, toImageStatusReviewContext, buildImageRepresentationContract, buildCurrentImageDeliveryContract, buildChatImageStatusInstruction } from '../server/chat-image-status-context-service.js';

// Run the actual terminal executor and original-reply registration against a
// transaction/lock fixture. No real DB, provider, TTS, service or user data.
import { buildImageReplyRecoveryPrompt } from '../server/chat-image-reply-recovery-service.js';

const sourcePath = new URL('../server/chat-image-failure-reply-job-service.js', import.meta.url);
const actualSource = readFileSync(process.env.ALOVE_TERMINAL_BASELINE || sourcePath, 'utf8');
const fallbackIdentity = { aiModel: 'fixture-actual-backup-model', aiProvider: 'fixture-backup', aiBaseUrl: 'https://backup-fixture.invalid/v1' };
function fixture({ status = 'ready', initial = null, ledger = {}, newerUser = false, legacy = false } = {}) {
  const state = { status, initial, latestUserOrder: newerUser ? 30 : 10, userId: 'u', guestId: '',
    metadata: { originalProviderContext: 'preserved', _terminalReply: { ...ledger, ...(initial ? { initialReply: initial } : {}) } },
    messages: [], jobs: [], generations: 0, reviews: 0, lease: true };
  let transaction = Promise.resolve(), sqlTrace = [];
  const locks = new Map();
  const clone = value => JSON.parse(JSON.stringify(value));
  const db = { async execute(sql, values = []) {
    if (sql.includes("sender_type = 'user'") && sql.endsWith('FOR UPDATE')) {
      assert(sqlTrace.some(previous => previous.startsWith('SELECT * FROM chat_sessions')), 'message-tail lock requires earlier session lock, never asset-first enqueue');
    }
    sqlTrace.push(sql);
    if (sql.startsWith('SELECT status, prompt_context_json')) return [[{ status: state.status, prompt_context_json: clone(state.metadata), internal_uid: state.userId, guest_session_id: state.guestId || null }]];
    if (sql.includes('SELECT a.id AS image_asset_id')) return [[{ image_asset_id: 'asset', image_status: state.status,
      session_id: 'session', internal_uid: state.userId, guest_session_id: state.guestId || null,
      session_internal_uid: state.userId, session_guest_id: state.guestId || null, character_id: 'character',
      image_display_order: 11, prompt_context_json: clone(state.metadata), latest_user_order: state.latestUserOrder,
      terminal_reply_version: legacy ? null : 1, preferred_language: 'English', image_reply_language_code: 'en',
      profile_json: '{}', name: 'Test', existing_reply: state.messages.some(m => m.sourceRef === 'chat-image-failure:asset') ? 1 : 0 }]];
    if (sql.startsWith('SELECT display_order FROM chat_messages')) return [[{ display_order: state.latestUserOrder }]];
    if (sql.startsWith('SELECT id, display_order FROM chat_messages')) return [[{ id: 'trigger', display_order: 10 }]];
    if (sql.startsWith('SELECT id FROM memory_jobs')) return [state.jobs.map(j => ({ id: j.id }))];
    if (sql.startsWith('SELECT * FROM chat_sessions')) return [[{ id: 'session', internal_uid: state.userId, guest_session_id: state.guestId || null }]];
    if (sql.includes("SET prompt_context_json = JSON_SET")) { state.metadata._terminalReply = JSON.parse(values[0]); return [{ affectedRows: 1 }]; }
    if (sql.startsWith('UPDATE chat_sessions')) return [{ affectedRows: 1 }];
    throw new Error(`Unrecognized fixture SQL: ${sql.slice(0, 100)}`);
  } };
  const sandbox = { removeTtsControlTags, buildChatImageStatusInstruction, buildImageReplyRecoveryPrompt,
    console, createHash,
    normalizeCharacterLanguage: value => value ? { code: 'en', label: 'English' } : null,
    upsertPersonaLanguageSetting: value => value,
    getDbPool: () => db,
    withTransaction: fn => { const result = transaction.then(() => { sqlTrace = []; return fn(db); }); transaction = result.catch(() => {}); return result; },
    buildChatReplyPrompt: ({ recentMessages, userText }) => ({
      systemPrompt: 'Preserved persona, voice, language and safety instructions.', layers: [{ id: 'persona', content: 'preserved' }],
      messages: [...recentMessages.map(message => ({ role: message.senderType === 'user' ? 'user' : 'assistant', content: message.text })),
        { role: 'user', content: userText }],
    }),
    resolveChatImageStatusContext: async (_db, { directive, session, character, userDisplayOrder, currentImageMessageId }) => {
      assert.equal(directive.terminalReplyOnly, true, 'caption purpose is explicit server state');
      assert.equal(directive.trigger, undefined, 'never invent a classifier acceptance or image-only user scope');
      return { ...directive, imageStatus: { kind: 'generated', status: state.status, currentTurn: true },
        _imageStatusAnchor: { assetId: 'asset', messageId: currentImageMessageId, kind: 'generated', displayOrder: 11,
          scope: { sessionId: session.id, characterId: character.character_id, ownerId: state.userId || null,
            guestId: state.guestId || null, order: userDisplayOrder, currentImageMessageId } } };
    },
    generateChatReply: async ({ promptContext, userText }) => {
      state.generations++;
      assert.equal(promptContext.messages.at(-1).role, 'system', 'last instruction is the server caption task, not the mixed user request');
      assert(promptContext.messages.some(message => /not a new user question/.test(message.content)), 'caption task remains scoped');
      assert.match(promptContext.messages.find(message => /physical photoshoots are unverified/.test(message.content))?.content || '', /physical photoshoots are unverified/, 'terminal generation must receive the same representation limits as its reviewer');
      assert.equal(promptContext.messages.some(message => message.content.includes('already added this specific requested character photo')), state.status === 'ready',
        'failed captions must never inherit the current ready-delivery contract');
      assert(promptContext.systemPrompt.startsWith('Preserved persona, voice, language and safety instructions.'));
      assert.equal(promptContext.layers[0].id, 'persona');
      assert(promptContext.messages[0].content.startsWith('READ-ONLY DATA PACKET'));
      const packet = JSON.parse(promptContext.messages[0].content.split('\n').slice(1).join('\n'));
      assert.equal(packet.originalRequest, 'How do I redeem my points? Also send me that photo.');
      assert.equal(packet.recentConversation.at(-1).text, packet.originalRequest, 'real mixed request remains available only as quoted history');
      assert.equal(packet.terminalState.status, state.status);
      assert.equal(packet.terminalState.kind, 'generated');
      assert(promptContext.messages.every(message => message.content !== packet.originalRequest), 'original mixed text is never a direct current command');
      assert.notEqual(userText, packet.originalRequest, 'local candidate-quality task is also caption-scoped');
      await state.onGenerate?.();
      return state.emptyGeneration ? { text: '', sourceType: 'ai', ...fallbackIdentity }
        : { text: state.status === 'failed' ? 'That photo did not come through; sorry about the wait.' : 'Here is that matchday photo we were talking about.', sourceType: 'ai', ...fallbackIdentity };
    },
    assessImageTerminalCaption: async ({ replyResult, userText, language }) => {
      state.reviews++;
      assert.deepEqual(JSON.parse(JSON.stringify(Object.fromEntries(Object.keys(fallbackIdentity).map(key => [key, replyResult[key]])))), fallbackIdentity);
      assert.equal(userText, 'How do I redeem my points? Also send me that photo.');
      assert.equal(language, 'en');
      await state.onReview?.();
      if (state.recoverImageReview && state.reviews === 1) return { allowed: false, reviewStatus: 'valid', failures: ['languageSupported'], confidence: .6 };
      return state.rejectReview ? { allowed: false, reviewStatus: 'valid', failures: ['noInternalLeak'], confidence: .6 } : { allowed: true, reviewStatus: 'valid', failures: [], confidence: .6 };
    },
    isAiTransportFallback: () => false,
    getChatImageStatusCopy: ({ status }) => `localized:${status}`,
    MEMORY_JOB_TYPES: { GENERATE_CHAT_IMAGE_FAILURE_REPLY: 'generate_chat_image_failure_reply' },
    enqueueMemoryJob: async job => { state.jobs.push(clone(job)); return job.id; },
    assertMemoryJobLease: async () => { if (!state.lease) throw Object.assign(new Error('lease lost'), { code: 'MEMORY_JOB_LEASE_LOST' }); },
    insertMessage: async (_db, message) => { const row = { ...message, id: `terminal-${state.messages.length + 1}` }; state.messages.push(row); return row; },
    getNextMessageOrder: async () => 25,
    listRecentMessagesBeforeOrder: async () => [{ senderType: 'user', text: 'How do I redeem my points? Also send me that photo.' }],
    attachVoiceAssetToMessage: async () => {}, indexChatMessage: async () => {}, enqueueSummaryRefreshJobs: async () => {},
    reserveAiReplyVoiceAssetForDb: async () => ({ id: 'voice' }), generateReservedAiReplyVoiceAsset: async () => {},
    applyGuestPromptPolicy: value => value, normalizeGuestReplyText, sanitizeGuestReplyText, guestVoiceMeta: () => ({}),
    parseJsonValue: (value, fallback) => typeof value === 'string' ? JSON.parse(value) : value || fallback,
    acquireDedicatedDbAdvisoryLock: async name => {
      const previous = locks.get(name) || Promise.resolve(); let release;
      const held = new Promise(resolve => { release = resolve; }); locks.set(name, previous.then(() => held));
      await previous; return release;
    },
  };
  const source = actualSource.replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];\s*/gm, '').replace(/^export /gm, '');
  vm.runInNewContext(`${source}\nglobalThis.api = { enqueueChatImageTerminalReplyIfNeeded: typeof enqueueChatImageTerminalReplyIfNeeded === "function" ? enqueueChatImageTerminalReplyIfNeeded : enqueueChatImageFailureReplyIfNeeded, registerChatImageInitialReplyForDb: typeof registerChatImageInitialReplyForDb === "function" ? registerChatImageInitialReplyForDb : null, generateChatImageFailureReplyFromJob, boundedReply: typeof boundedReply === "function" ? boundedReply : null };`, sandbox, { filename: sourcePath.pathname });
  const snapshot = { assetId: 'asset', messageId: 'image', status: 'queued', userDisplayOrder: 10, requestScope: 'mixed', natural: true };
  const originalReply = { id: 'initial', sessionId: 'session', characterId: 'character', text: 'Original policy answer and pending image acknowledgement.' };
  const register = (patch = {}) => sandbox.withTransaction(connection => sandbox.api.registerChatImageInitialReplyForDb(connection, { snapshot: { ...snapshot, ...patch }, replyMessage: originalReply, triggerMessageId: 'trigger' }));
  const enqueue = () => sandbox.withTransaction(connection => sandbox.api.enqueueChatImageTerminalReplyIfNeeded(connection, { assetId: 'asset', messageId: 'image' }));
  const run = () => sandbox.api.generateChatImageFailureReplyFromJob({ id: 'job', claimToken: 'lease', payload: { assetId: 'asset', messageId: 'image' } });
  return { state, originalReply, register, enqueue, run, normalize: sandbox.api.boundedReply };
}

const initial = { messageId: 'initial', triggerMessageId: 'trigger', triggerOrder: 10, status: 'queued', natural: true, requestScope: 'mixed' };
if (process.env.ALOVE_TERMINAL_BASELINE) {
  const red = fixture({ initial }); await red.run();
  assert.equal(red.state.messages.length, 1, 'ready image must receive a natural terminal reply after its pending acknowledgement');
  process.exit(0);
}
const ownedContext = { taskCreated: true, reason: 'image_task_created', terminalReplyOnly: true,
  imageStatus: { kind: 'generated', status: 'ready', currentTurn: true },
  _imageStatusAnchor: { assetId: 'asset', messageId: 'image', kind: 'generated', scope: {
    sessionId: 'session', characterId: 'character', ownerId: 'u', guestId: null, order: 10, currentImageMessageId: 'image' } } };
assert.equal(isFulfilledImageOnlyRequest(ownedContext), true);
assert.equal(toImageStatusReviewContext(ownedContext).terminalReplyOnly, true);
assert.match(buildImageRepresentationContract(toImageStatusReviewContext(ownedContext)), /bare generic completion\/error status label/);
assert.equal(toImageStatusReviewContext({ ...ownedContext, terminalReplyOnly: false }).terminalReplyOnly, undefined, 'ordinary image review receives no caption-only requirement');
assert.equal(toImageStatusReviewContext({ ...ownedContext, _imageStatusAnchor: null }).terminalReplyOnly, undefined, 'unowned/unscoped flag cannot select caption-only review');
for (const override of [{ terminalReplyOnly: false }, { _imageStatusAnchor: null },
  { imageStatus: { ...ownedContext.imageStatus, status: 'failed' } },
  { imageStatus: { ...ownedContext.imageStatus, status: 'generating' } },
  { imageStatus: { ...ownedContext.imageStatus, currentTurn: false } },
  { imageStatus: { ...ownedContext.imageStatus, kind: 'library' } },
  { _imageStatusAnchor: { ...ownedContext._imageStatusAnchor, scope: { ...ownedContext._imageStatusAnchor.scope, ownerId: null } } }]) {
  assert.equal(isFulfilledImageOnlyRequest({ ...ownedContext, ...override }), false, 'caption flag cannot grant image creation or bypass owned terminal anchor');
}
const classificationFallback = { sourceType: 'system', text: 'Original classification fallback.', business: { retained: true } };
const markedFallback = withChatImageReplySnapshot(classificationFallback, ownedContext);
assert.equal(markedFallback._imageDeliveryReply.natural, false, 'classification failure skips review but still registers its actual image');
assert.deepEqual({ ...markedFallback, _imageDeliveryReply: undefined }, { ...classificationFallback, _imageDeliveryReply: undefined });
assert.equal(withChatImageReplySnapshot(classificationFallback, null), classificationFallback, 'normal no-image fallback is unchanged');
const terminalFirst = fixture();
assert.equal(await terminalFirst.enqueue(), '', 'terminal before initial waits without a paid call');
await terminalFirst.register();
assert.equal(terminalFirst.state.jobs.length, 1, 'second entry atomically enqueues exactly once');
await Promise.all([terminalFirst.run(), terminalFirst.run()]);
assert.equal(terminalFirst.state.generations, 1);
assert.equal(terminalFirst.state.reviews, 1);
assert.equal(terminalFirst.state.messages.length, 1, 'two concurrent executors append one natural terminal reply');
assert.equal(terminalFirst.state.messages[0].text, 'Here is that matchday photo we were talking about.');
assert.equal(terminalFirst.state.metadata._terminalReply.responseKind, 'natural');
assert.equal(terminalFirst.state.metadata._terminalReply.draft.aiModel, fallbackIdentity.aiModel);
assert.equal(terminalFirst.state.metadata._terminalReply.approvedReply.aiBaseUrl, fallbackIdentity.aiBaseUrl);
assert.equal(terminalFirst.originalReply.text, 'Original policy answer and pending image acknowledgement.', 'mixed answer not overwritten');
assert.equal(terminalFirst.state.metadata.originalProviderContext, 'preserved');
terminalFirst.state.jobs.length = 0;
assert.equal(await terminalFirst.enqueue(), '', 'job cleanup does not clear the asset lifetime ledger');
assert.equal(terminalFirst.state.generations, 1);

const initialFirst = fixture({ status: 'generating' });
await initialFirst.register();
assert.equal(initialFirst.state.jobs.length, 0);
initialFirst.state.status = 'ready';
await Promise.all([initialFirst.enqueue(), initialFirst.enqueue()]);
assert.equal(initialFirst.state.jobs.length, 1, 'opposite completion order and concurrent enqueue remain once-only');
await initialFirst.run();
assert.equal(initialFirst.state.messages.length, 1);
const alreadyNatural = fixture();
await alreadyNatural.register({ status: 'ready' });
assert.equal(alreadyNatural.state.jobs.length, 0, 'initial natural terminal answer is already sufficient');
await alreadyNatural.run();
assert.equal(alreadyNatural.state.generations, 0);
const mechanical = fixture();
await mechanical.register({ status: 'ready', natural: false });
await mechanical.run();
assert.equal(mechanical.state.generations, 1, 'degraded terminal template can receive a natural final follow-up once');

for (const ledger of [{ generationStarted: true }, { generationStarted: true, draft: { text: 'cached', sourceType: 'ai', ...fallbackIdentity }, reviewStarted: true }]) {
  const crashed = fixture({ initial, ledger });
  await crashed.run();
  assert.equal(crashed.state.generations, 0, 'restart never buys the already-started generation again');
  assert.equal(crashed.state.reviews, 0, 'uncertain review cannot be purchased again');
  assert.equal(crashed.state.messages[0].text, 'localized:ready');
}
const cachedDraft = fixture({ initial, ledger: { generationStarted: true, draft: { text: 'Cached natural caption.', sourceType: 'ai', ...fallbackIdentity } } });
await cachedDraft.run();
assert.equal(cachedDraft.state.generations, 0);
assert.equal(cachedDraft.state.reviews, 1, 'completed generation resumes at its single remaining review');
assert.equal(cachedDraft.state.messages[0].text, 'Cached natural caption.');
const rejected = fixture({ initial }); rejected.state.rejectReview = true;
await rejected.run();
assert.equal(rejected.state.messages[0].text, 'localized:ready', 'unreviewed claims never escape');
assert.equal(rejected.state.metadata._terminalReply.responseKind, 'fallback', 'rejected review is never reported as a natural pass');
assert.equal(rejected.state.generations, 2); assert.equal(rejected.state.reviews, 2);

const empty = fixture({ initial }); empty.state.emptyGeneration = true;
await empty.run();
assert.equal(empty.state.generations, 1); assert.equal(empty.state.reviews, 0);
assert.equal(empty.state.messages[0].sourceType, 'system');
assert.equal(empty.state.metadata._terminalReply.responseKind, 'fallback');
assert.equal(empty.state.messages[0].text, 'localized:ready');
const cachedApproved = fixture({ initial, ledger: { generationStarted: true, reviewStarted: true,
  approvedReply: { text: 'Previously approved natural caption.', sourceType: 'ai' } } });
await cachedApproved.run();
assert.equal(cachedApproved.state.generations, 0); assert.equal(cachedApproved.state.reviews, 0);
assert.equal(cachedApproved.state.messages[0].text, 'Previously approved natural caption.');
const later = fixture({ initial, newerUser: true });
await later.run();
assert.equal(later.state.messages.length, 0); assert.equal(later.state.generations, 0);
const during = fixture({ initial }); during.state.onReview = async () => { during.state.latestUserOrder = 30; };
await during.run();
assert.equal(during.state.messages.length, 0, 'new user during provider work fences stale terminal insertion');
const lease = fixture({ initial }); lease.state.lease = false;
await assert.rejects(lease.run(), { code: 'MEMORY_JOB_LEASE_LOST' });
assert.equal(lease.state.generations, 0);
const owner = fixture({ initial }); owner.state.onReview = async () => { owner.state.userId = 'different-owner'; };
await owner.run();
assert.equal(owner.state.messages.length, 0, 'ownership must still match when the reviewed reply commits');
const failed = fixture({ status: 'failed', initial });
await failed.run();
assert.equal(failed.state.generations, 1); assert.equal(failed.state.reviews, 1); assert.equal(failed.state.messages.length, 1);
const legacy = fixture({ status: 'failed', legacy: true });
await legacy.run();
assert.equal(legacy.state.messages.length, 1, 'old serialized failure job without initial marker still works');
console.log('Image terminal reply: opposite ordering, enqueue/executor concurrency, asset-lifetime dedup, normal single candidate and bounded image-text repair, crash recovery, mixed/new-turn/lease/owner protection and legacy failure passed (isolated real executor; no DB/network/models).');

const delivered = {kind:"generated",status:"ready",currentTurn:true};
assert.match(buildCurrentImageDeliveryContract(delivered), /each other question still needs/);
assert.doesNotMatch(buildCurrentImageDeliveryContract({...delivered, terminalReplyOnly:true}), /each other question still needs/);
assert.match(buildCurrentImageDeliveryContract({...delivered, terminalReplyOnly:true}), /already handled/);

const captionFormat=fixture({initial});
const captionText="[happy] Aquí tienes. [nervous] ¿Qué te parece? (como comentamos) 12";
const normalizedCaption=captionFormat.normalize({text:captionText,...fallbackIdentity},{guestSessionId:"",languageCode:"es"},"old mixed request");
assert.equal(normalizedCaption.text,"Aquí tienes. ¿Qué te parece? (como comentamos) 12");
assert.equal(normalizedCaption.speechText,normalizedCaption.text);
assert.equal(captionFormat.normalize({text:"[nervous]"},{guestSessionId:""},""),null,"pure stage labels must use finite fallback without audit");
const stageOnly = fixture({initial,ledger:{generationStarted:true,terminalStatus:'ready',draft:{text:'[nervous]',...fallbackIdentity}}});
await stageOnly.run();
assert.equal(stageOnly.state.generations,0);
assert.equal(stageOnly.state.reviews,0,'empty cleaned cached caption cannot spend another audit');
assert.equal(stageOnly.state.messages[0].text,'localized:ready');
assert.equal(normalizedCaption.aiModel,fallbackIdentity.aiModel);
assert.equal(captionText.includes('[nervous]'),true,'source conversation/output remains immutable');

const couponCaption=captionFormat.normalize({text:"Here is that photo we were talking about."},{guestSessionId:"owned-guest",languageCode:"en"},"Can I have a discount coupon? Also send your photo.");
assert.equal(couponCaption.text,"Here is that photo we were talking about.","caption must not re-run the original business routing");

const safeCaption=captionFormat.normalize({text:"Here is your photo. Use promo code SAVE50."},{guestSessionId:"owned-guest",languageCode:"en"},"Please send your photo.");
assert(!safeCaption.text.includes("SAVE50"),"guest safety filtering remains active in caption subtask");
const trackingCaption=captionFormat.normalize({text:"Here is the photo we discussed."},{guestSessionId:"owned-guest",languageCode:"en"},"Where is tracking AB1234? Also send your photo.");
assert.equal(trackingCaption.text,"Here is the photo we discussed.");

const imageRepair = fixture({ initial });
imageRepair.state.recoverImageReview = true;
await imageRepair.run();
assert.equal(imageRepair.state.generations, 2, 'only one additional text candidate through the shared recovery path');
assert.equal(imageRepair.state.messages.length, 1);
assert.equal(imageRepair.state.metadata._terminalReply.responseKind, 'natural');
await imageRepair.run();
assert.equal(imageRepair.state.generations, 2, 'completed ledger prevents repair on replay');
assert.equal(imageRepair.originalReply.text, 'Original policy answer and pending image acknowledgement.');
