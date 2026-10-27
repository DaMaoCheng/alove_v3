import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as lifecycle from '../server/chat-image-job-lifecycle-service.js';
const source = (await readFile(new URL('../server/chat-image-job-service.js', import.meta.url), 'utf8'))
 .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\n/gm, '').replace(/^export /gm, '');
const lockError = () => Object.assign(Error('quota row busy'), { code: 'ER_LOCK_WAIT_TIMEOUT' });
function fixture({ failure = lockError(), failures = 1, guest = false, coordinated = true, foreign = false, initial = false, alreadyStaged = false } = {}) {
 const saved = { storagePath: 'staged.webp', protectedPath: '/image', width: 10, height: 10, bytes: 10, mimeType: 'image/webp' };
 let transaction = 0, providerCalls = 0, commits = 0, polls = 0, staged = alreadyStaged ? saved : null, usage = 0;
 const events = [];
 const asset = { status: 'queued', created_at: new Date(), session_id: 'session', character_id: 'character',
  internal_uid: foreign ? 'foreign' : 'owner', guest_session_id: guest ? 'guest' : null };
 const db = { execute: async (query) => {
  const sql = typeof query === 'string' ? query : query.sql;
  if (/GET_LOCK/.test(sql)) return [[{ locked: 1 }]];
  if (/RELEASE_LOCK/.test(sql)) return [[]];
  if (/SELECT.*prompt_context_json/s.test(sql)) {
   assert.equal(transaction, 0, 'initial reply must be observed outside the rolled-back ready transaction');
   assert.doesNotMatch(sql, /FOR UPDATE/);
   polls++;
   const state = initial || polls > 1 ? { version: 1, coordinated: true, initialReply: { messageId: 'initial' } } : undefined;
   events.push('autocommit-observation');
   return [[{ ...asset, session_internal_uid: asset.internal_uid, session_guest_id: asset.guest_session_id,
    prompt_context_json: JSON.stringify({ _terminalReply: state }) }]];
  }
  if (/SELECT.*FROM chat_image_assets/s.test(sql)) return [[{ ...asset }]];
  if (/UPDATE chat_image_assets/.test(sql)) {
   if (/status = 'ready'/.test(sql)) {
    commits++;
    if (commits <= failures) throw failure;
    asset.status = 'ready';
   } else if (/status = 'generating'/.test(sql)) asset.status = 'generating';
   else if (/status = 'failed'/.test(sql)) asset.status = 'failed';
   return [{ affectedRows: 1 }];
  }
  if (/UPDATE chat_messages/.test(sql)) return [{ affectedRows: 1 }];
  throw Error('Unexpected SQL: '+sql);
 }, getConnection: async () => ({ execute: db.execute, release() {} }) };
 const deps = { ...lifecycle, getDbPool: () => db,
  withTransaction: async work => { transaction++; try { return await work(db); } catch (error) { events.push('rollback'); throw error; } finally { transaction--; } },
  assertMemoryJobLease: async () => {}, normalizeCharacterLanguage: () => ({ code: 'en' }),
  getChatImageStatusCopy: ({ status }) => status,
  CHAT_IMAGE_STATUSES: { QUEUED: 'queued', GENERATING: 'generating', READY: 'ready', FAILED: 'failed' },
  lockChatImageQuota: async () => {}, recordChatImageUsage: async () => { usage++; },
  consumeGuestImageEntitlementForAsset: async () => ({ guest: false }), consumeGuestImageDailyQuotaForAsset: async () => ({ enforced: false }),
  releaseGuestImageEntitlementForAsset: async () => {}, releaseGuestImageDailyQuotaForAsset: async () => {},
  enqueueChatImageTerminalReplyIfNeeded: async () => {}, enqueueChatImageFailureReplyIfNeeded: async () => {},
  deleteStoredChatImageAsset: async () => {},
  providerBoundary: async () => { providerCalls++; staged = saved; return staged; },
  stagedBoundary: async () => staged,
 };
 const run = new Function(...Object.keys(deps), `${source}\ngenerateAndSaveChatImage = providerBoundary; recoverStagedChatImage = stagedBoundary; assertGuestImageGenerationAllowed = async () => {}; return generateChatImageFromJob;`)(...Object.values(deps));
 const job = { id: 'job', jobType: 'generate_chat_image', claimedAt: new Date(), userId: 'owner', sessionId: 'session', characterId: 'character', claimToken: 'claim', retryCount: 0, maxRetries: 1,
  payload: { messageId: 'message', assetId: 'asset', guestSessionId: guest ? 'guest' : '', ...(coordinated ? { terminalReplyVersion: 1 } : {}) } };
 return { run: () => run(job), job, events, asset, counts: () => ({ providerCalls, commits, polls, usage }) };
}
let item = fixture();
assert.equal((await item.run()).status, 'ready', 'one rolled-back quota wait should resume the same staged completion after initial commit');
assert.deepEqual(item.counts(), { providerCalls: 1, commits: 2, polls: 2, usage: 2 });
assert.ok(item.events.indexOf('rollback') < item.events.indexOf('autocommit-observation'));
item = fixture({ alreadyStaged: true, initial: true });
assert.equal((await item.run()).handledBy, 'chat-image-staged-recovery');
assert.equal(item.counts().providerCalls, 0, 'an existing staged retry never regenerates the paid image');
assert.equal(item.counts().commits, 2);
item = fixture({ failures: 0 }); await item.run();
assert.equal(item.counts().polls, 0, 'normal early publication must never wait for the initial reply');
for (const options of [{ guest: true }, { coordinated: false }, { coordinated: false, initial: true }, { foreign: true }, { failure: Object.assign(Error('network'), { code: 'ER_CONNECTION_LOST' }) }]) {
 item = fixture(options); await assert.rejects(item.run());
 assert.equal(item.counts().commits, 1, 'ineligible errors retain the existing finite queue retry path');
 assert.equal(item.counts().providerCalls, 1);
 assert.ok(item.counts().polls <= 1, 'legacy/foreign requests never enter a waiting loop');
}
item = fixture({ failures: 2, initial: true }); await assert.rejects(item.run(), { code: 'ER_LOCK_WAIT_TIMEOUT' });
assert.equal(item.counts().commits, 2, 'the same ready transaction is retried at most once');
assert.equal(item.counts().providerCalls, 1);
// The lifecycle helper uses the immutable asset deadline and caller lease guard.
const row = { internal_uid: 'owner', guest_session_id: null, session_id: 'session', character_id: 'character', status: 'generating',
 created_at: new Date(), session_internal_uid: 'owner', session_guest_id: null, prompt_context_json: '{}' };
const job = { id: 'job', claimToken: 'claim', jobType: 'generate_chat_image', claimedAt: new Date(), userId: 'owner', sessionId: 'session', characterId: 'character', payload: { assetId: 'asset', messageId: 'message', terminalReplyVersion: 1 } };
const db = { execute: async () => [[row]] };
const lost = Object.assign(Error('lease lost'), { code: 'MEMORY_JOB_LEASE_LOST', retryable: false });
await assert.rejects(lifecycle.waitForChatImageInitialReplyAfterLock(db, { error: lockError(), job, assetId: 'asset', messageId: 'message',
 assertCanContinue: async () => { throw lost; } }), e => e === lost);
await assert.rejects(lifecycle.waitForChatImageInitialReplyAfterLock(db, { error: lockError(), job, assetId: 'asset', messageId: 'message',
 assertCanContinue: async () => {}, now: () => new Date(row.created_at.getTime()+900000) }), { code: 'chat_image_request_deadline' });
await assert.rejects(lifecycle.waitForChatImageInitialReplyAfterLock(db, { error: lockError(),
 job: { ...job, claimedAt: new Date(Date.now()-24*60*60*1000) }, assetId: 'asset', messageId: 'message',
 assertCanContinue: async () => {} }), { code: 'MEMORY_JOB_TIMEOUT' });
for (const changes of [
 { sessionId: 'another_session' }, { characterId: 'another_character' }, { userId: 'another_owner' },
 { id: '' }, { claimToken: '' }, { payload: { ...job.payload, assetId: 'another_asset' } },
 { payload: { ...job.payload, messageId: 'another_message' } }, { claimedAt: 'invalid', startedAt: null },
]) {
 let leaseCalls = 0;
 assert.equal(await lifecycle.waitForChatImageInitialReplyAfterLock(db, { error: lockError(), job: { ...job, ...changes },
  assetId: 'asset', messageId: 'message', assertCanContinue: async () => { leaseCalls++; } }), false);
 assert.equal(leaseCalls, 0, 'scope mismatch cannot enter a coordination wait');
}
for (const state of [{ coordinated: true }, { version: 1, coordinated: false }, { version: 2, coordinated: true }]) {
 let continuations = 0;
 const contradicted = { execute: async () => [[{ ...row, prompt_context_json: JSON.stringify({ _terminalReply: state }) }]] };
 assert.equal(await lifecycle.waitForChatImageInitialReplyAfterLock(contradicted, { error: lockError(), job,
  assetId: 'asset', messageId: 'message', assertCanContinue: async () => { continuations++; } }), false);
 assert.equal(continuations, 0, 'a contradictory persisted ledger cannot activate the wait');
}
for (const version of [undefined, 0, 2, '1']) {
 assert.equal(await lifecycle.waitForChatImageInitialReplyAfterLock({ execute: async () => { throw Error('legacy version must not query'); } },
  { error: lockError(), job: { ...job, payload: { ...job.payload, terminalReplyVersion: version } },
   assetId: 'asset', messageId: 'message', assertCanContinue: async () => {} }), false);
}
console.log('image ready-lock isolation passed: staged/provider-once, rollback-before-observation, bounded ready reattempt, no-lock/guest/legacy/foreign/error controls, deadline and lease (fixtures only)');
