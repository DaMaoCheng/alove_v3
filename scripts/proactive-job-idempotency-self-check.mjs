import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getProactiveJobDeliveryId } from '../server/proactive-delivery-policy.js';

// Run the real sender and delivery functions with controlled transaction failures; no DB or provider calls.
const state = { token: 'current', messages: [], deliveries: new Map(), campaigns: new Map(), events: [] };
let failCompletion = false;
let failAfterCommit = false;
const session = { id: 'session', internal_uid: 'user', character_id: 'character' };
const character = { id: 'character', name: 'Check', profile_json: '{}' };
const job = { id: 'job', claimToken: 'current' };
const deps = {};
const pool = { getConnection: async () => transaction(), execute: async (...args) => transaction().execute(...args) };
deps['./db.js'] = { getDbPool: () => pool, withTransaction: async (work) => { const db = transaction(); try { const result = await work(db); await db.commit(); return result; } catch (error) { await db.rollback(); throw error; } } };
deps['./memory-job-service.js'] = {
  assertMemoryJobLease: async (_db, candidate, options) => {
    state.events.push(options?.lock ? 'lease_lock' : 'lease_read');
    if (candidate.claimToken !== state.token) throw new Error('stale lease');
  },
};
deps['./security.js'] = { createId: () => 'generated' };
deps['./proactive-delivery-policy.js'] = Object.fromEntries([
  'dedupeCandidates', 'getDeliveryDateForTimeZone', 'normalizeDeliveryDate', 'normalizeDeliveryMode', 'normalizeSlotIndex',
  'normalizeSourceType', 'normalizeTimeZone', 'resolveDailyRequiredAvailableAt', 'selectProactiveDeliveryCandidate',
  'deterministicNumber', 'getLocalParts', 'zonedLocalTimeToDate',
].map((key) => [key, (value) => value]));
Object.assign(deps['./proactive-delivery-policy.js'], {
  normalizeId: (value) => String(value || '').trim(), getProactiveJobDeliveryId,
  PROACTIVE_DELIVERY_STATUSES: { RESERVED: 'reserved', SENT: 'sent' },
  PROACTIVE_DELIVERY_MODES: {}, PROACTIVE_DELIVERY_SOURCE_TYPES: { PROACTIVE_NUDGE: 'proactive_nudge' },
});
deps['./proactive-content-policy-service.js'] = { inspectProactiveSendPolicy: async () => ({ allowed: true }) };
deps['./chat-memory-service.js'] = { indexChatMessage: async () => {} };
deps['./chat-reply-voice-service.js'] = { resolveReplyVoiceModel: () => ({ model: 'voice' }) };
deps['./chat-voice-asset-service.js'] = {
  createAiReplyVoiceAssetForDb: async () => ({ id: 'voice', assetStatus: 'ready' }),
};
deps['./promotion-campaign-product-payload-service.js'] = {
  buildCampaignProductPayload: () => ({ name: 'Shirt', url: 'https://example.invalid/shirt' }),
};
deps['./product-analytics-service.js'] = { recordProductBubbleTriggered: async () => {} };
deps['./chat-service-shared.js'] = {
  enqueueSummaryRefreshJobs: async () => {}, findCharacterById: async () => character,
  findLatestUserSessionForDb: async () => session, getNextMessageOrder: async () => 20,
  attachVoiceAssetToMessage: async () => {}, mapSessionRow: (row) => row,
  lockUserSessionOwnerForDb: async () => { state.events.push('owner_lock'); },
  normalizeMessageText: (value) => String(value || '').trim(), throwNotFound: () => { throw new Error('not found'); },
  insertMessage: async (db, input) => { const row = { ...input, id: `message_${db.snapshot.messages.length}` }; db.snapshot.messages.push(row); return row; },
};
const deliveryModule = { ...await loadControlledModule('../server/proactive-message-delivery-service.js'), getProactiveJobDeliveryId };
deps['./proactive-message-delivery-service.js'] = deliveryModule;
// Exercise the actual campaign completion function with its optional transaction executor.
const campaignSource = await readFile(new URL('../server/promotion-campaign-match-service.js', import.meta.url), 'utf8');
const campaignFunction = campaignSource.slice(campaignSource.indexOf('export async function completePromotionCampaignDelivery'), campaignSource.indexOf('export async function cancelPromotionCampaignDelivery'));
deps['./promotion-campaign-match-service.js'] = await import(`data:text/javascript,${encodeURIComponent(`const getDbPool = () => { throw new Error('completion escaped transaction'); };\n${campaignFunction}`)}`);
const sender = await loadControlledModule('../server/chat-proactive-message-service.js');
const stableId = deliveryModule.getProactiveJobDeliveryId('job');
assert.equal(stableId, deliveryModule.getProactiveJobDeliveryId('job'));
assert.notEqual(stableId, deliveryModule.getProactiveJobDeliveryId('different'));
assert.ok(stableId.length <= 64);
const delivery = { id: stableId, sourceType: 'proactive_nudge', sourceRef: 'proactive-nudge', campaignId: '' };
const input = { userId: 'user', characterId: 'character', sessionId: 'session', text: 'A natural check-in.',
  proactivePolicy: { state: 'neutral' }, job, delivery };

reset();
await assert.rejects(sender.createProactiveCharacterMessage({ ...input, job: { ...job, claimToken: 'old' } }), /stale lease/);
assert.equal(state.messages.length, 0, 'superseded attempts must not insert');

reset(); failCompletion = true;
await assert.rejects(sender.createProactiveCharacterMessage(input), /changed before completion/);
assert.equal(state.messages.length, 0, 'delivery failure must roll back the message');
assert.equal(state.deliveries.get(stableId).delivery_status, 'reserved');
failCompletion = false;

reset();
const sent = await sender.createProactiveCharacterMessage(input);
assert.ok(sent.items[0].voice.id, 'voice metadata remains attached');
assert.equal(state.messages.length, 1);
assert.equal(state.deliveries.get(stableId).delivery_status, 'sent');
assert.deepEqual(state.events.slice(0, 2), ['lease_lock', 'owner_lock']);
const replay = await sender.createProactiveCharacterMessage(input);
assert.equal(replay.replayed, true);
assert.equal(state.messages.length, 1, 'retry of committed send must not repeat');

reset(); failAfterCommit = true;
await assert.rejects(sender.createProactiveCharacterMessage(input), /commit acknowledgement lost/);
assert.equal(state.messages.length, 1, 'an uncertain acknowledgement can still mean committed');
assert.equal(state.deliveries.get(stableId).delivery_status, 'sent');
failAfterCommit = false;
assert.equal((await sender.createProactiveCharacterMessage(input)).replayed, true);
assert.equal(state.messages.length, 1);

reset();
const campaignDelivery = { ...delivery, sourceType: 'promotion_campaign', campaignId: 'campaign', campaignDeliveryId: 'campaign_delivery' };
state.deliveries.get(stableId).source_type = 'promotion_campaign';
state.deliveries.get(stableId).campaign_id = 'campaign';
state.campaigns.set('campaign_delivery', { campaign_id: 'campaign', internal_uid: 'user', character_id: 'character', session_id: 'session', delivery_status: 'reserved' });
failCompletion = true;
await assert.rejects(sender.createProactivePromotionCampaignMessages({ ...input, delivery: campaignDelivery, campaign: { id: 'campaign' } }), /changed before completion/);
assert.equal(state.messages.length, 0, 'both campaign messages roll back if slot completion fails');
assert.equal(state.campaigns.get('campaign_delivery').delivery_status, 'reserved', 'campaign completion rolls back with the slot');
failCompletion = false;
await sender.createProactivePromotionCampaignMessages({ ...input, delivery: campaignDelivery, campaign: { id: 'campaign' } });
assert.equal(state.messages.length, 2, 'campaign text and product still share one transaction');
assert.equal(state.deliveries.get(stableId).delivery_status, 'sent');
assert.equal(state.campaigns.get('campaign_delivery').delivery_status, 'sent');
assert.equal((await sender.createProactivePromotionCampaignMessages({ ...input, delivery: campaignDelivery, campaign: { id: 'campaign' } })).replayed, true);
assert.equal(state.messages.length, 2);

reset();
await sender.createProactiveCharacterMessage({ ...input, job: null, delivery: null });
assert.equal(state.messages.length, 1, 'normal direct entry still sends');
assert.ok(!state.events.includes('lease_lock'), 'direct entry does not acquire a job lease');
assert.equal(state.deliveries.get(stableId).delivery_status, 'reserved');
const jobSource = await readFile(new URL('../server/proactive-message-job-service.js', import.meta.url), 'utf8');
const reconcileSource = jobSource.slice(jobSource.indexOf('export async function reconcileInterruptedProactiveJob'), jobSource.indexOf('// At most two generations.'));
globalThis.__proactiveReconcileSelfCheck = { ...deps['./db.js'], ...deps['./memory-job-service.js'], getProactiveJobDeliveryId: deliveryModule.getProactiveJobDeliveryId };
const reconcile = await import(`data:text/javascript,${encodeURIComponent(`const {withTransaction,assertMemoryJobLease,getProactiveJobDeliveryId}=globalThis.__proactiveReconcileSelfCheck; const normalizeId=(v)=>String(v||'').trim();\n${reconcileSource}`)}`);
const interruptedJob = { ...job, userId: 'user', characterId: 'character', sessionId: 'session' };
reset();
assert.equal((await reconcile.reconcileInterruptedProactiveJob(interruptedJob)).sent, false);
assert.equal(state.deliveries.size, 0, 'confirmed interrupted unsent reservation is released');
reset();
state.deliveries.get(stableId).delivery_status = 'sent';
state.deliveries.get(stableId).message_id = 'already_sent';
assert.equal((await reconcile.reconcileInterruptedProactiveJob(interruptedJob)).messageId, 'already_sent');
assert.equal(state.deliveries.size, 1, 'committed slot is never deleted by interruption cleanup');
reset();
await assert.rejects(reconcile.reconcileInterruptedProactiveJob({ ...interruptedJob, claimToken: 'old' }), /stale lease/);
assert.equal(state.deliveries.size, 1);
await assert.rejects(reconcile.reconcileInterruptedProactiveJob({ ...interruptedJob, userId: 'different' }), /scope mismatch/);
assert.equal(state.deliveries.size, 1);
console.log('Proactive idempotency controlled transaction checks passed (no DB/provider calls).');

function reset() {
  state.messages = []; state.events = []; state.campaigns = new Map();
  state.deliveries = new Map([[stableId, { id: stableId, internal_uid: 'user', character_id: 'character', session_id: 'session', source_type: 'proactive_nudge', campaign_id: '', delivery_status: 'reserved' }]]);
}
function transaction() {
  let committed = false;
  const db = {
    snapshot: structuredClone(state),
    beginTransaction: async () => {}, release: () => {},
    rollback: async () => {},
    commit: async () => { state.messages = db.snapshot.messages; state.deliveries = db.snapshot.deliveries; state.campaigns = db.snapshot.campaigns; committed = true; if (failAfterCommit) throw new Error('commit acknowledgement lost'); },
    execute: async (sql, params = []) => {
      const snapshot = committed ? state : db.snapshot;
      if (/FROM chat_sessions/.test(sql)) return [[session]];
      if (/^\s*SELECT/.test(sql) && /FROM proactive_message_deliveries/.test(sql)) return [[snapshot.deliveries.get(params[0])].filter(Boolean)];
      if (/^\s*SELECT/.test(sql) && /FROM promotion_campaign_deliveries/.test(sql)) return [[snapshot.campaigns.get(params[0])].filter(Boolean)];
      if (/UPDATE proactive_message_deliveries/.test(sql)) {
        const row = snapshot.deliveries.get(params.at(-1));
        if (failCompletion || !row || row.delivery_status !== 'reserved') return [{ affectedRows: 0 }];
        row.delivery_status = 'sent'; row.message_id = params[1]; return [{ affectedRows: 1 }];
      }
      if (/UPDATE promotion_campaign_deliveries/.test(sql)) {
        const row = snapshot.campaigns.get(params.at(-1));
        if (!row || row.delivery_status !== 'reserved') return [{ affectedRows: 0 }];
        row.delivery_status = 'sent'; row.message_id = params[0]; return [{ affectedRows: 1 }];
      }
      if (/DELETE FROM (proactive_message_deliveries|promotion_campaign_deliveries)/.test(sql)) {
        const rows = /DELETE FROM proactive_message_deliveries/.test(sql) ? snapshot.deliveries : snapshot.campaigns;
        const row = rows.get(params[0]);
        if (row && row.internal_uid === params[1] && row.character_id === params[2] && row.session_id === params[3] && row.delivery_status === 'reserved') {
          rows.delete(params[0]); return [{ affectedRows: 1 }];
        }
        return [{ affectedRows: 0 }];
      }
      if (/UPDATE chat_sessions/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unhandled controlled SQL: ${sql.slice(0, 70)}`);
    },
  };
  return db;
}
async function loadControlledModule(path) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  const key = `__proactiveSelfCheck_${Math.random()}`;
  globalThis[key] = deps;
  source = source.replace(/import\s+\{([^}]+)\}\s+from\s+"(\.\/[^\"]+)";/g, (_all, bindings, modulePath) => {
    assert.ok(deps[modulePath], `Missing controlled dependency ${modulePath}`);
    return `const {${bindings}} = globalThis[${JSON.stringify(key)}][${JSON.stringify(modulePath)}];`;
  });
  // Re-exported policy symbols are irrelevant here; their declarations must still resolve locally.
  source = source.replace(/export\s+\{[\s\S]*?\}\s+from\s+"\.\/proactive-delivery-policy\.js";/g, '');
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

if (process.argv.includes('--db')) await runLocalDatabaseChecks();

async function runLocalDatabaseChecks() {
  // The parent runs this serially after schema migration. No initializeDatabase/seed or real model call.
  const { SERVER_CONFIG } = await import('../server/config.js');
  assert.ok(['127.0.0.1', 'localhost'].includes(SERVER_CONFIG.db.host));
  assert.equal(Number(SERVER_CONFIG.db.port), 3307, 'this fixture only belongs to the local DB');
  const { getDbPool, closeDbPool } = await import('../server/db.js');
  const api = await import('../server/chat-proactive-message-service.js');
  const deliveryApi = await import('../server/proactive-message-delivery-service.js');
  const { randomUUID } = await import('node:crypto');
  const tag = randomUUID().replaceAll('-', '');
  const ids = { user: `u_proactive_atomic_${tag}`, session: `chat_atomic_${tag}`, seed: `msg_atomic_${tag}`, job: `job_atomic_${tag}`, campaign: `campaign_atomic_${tag}` };
  const actualJob = { id: ids.job, claimToken: `lease_${tag}` };
  const db = getDbPool();
  let characterId = '';
  const text = 'Just checking whether your week has brought a pleasant surprise.';
  let gateVoice = false;
  let signalVoice;
  let releaseVoice;
  const voiceStarted = new Promise((resolve) => { signalVoice = resolve; });
  const voiceGate = new Promise((resolve) => { releaseVoice = resolve; });
  const generateVoiceAudio = async () => {
    if (gateVoice) { signalVoice(); await voiceGate; }
    return { status: 'ready', audioUrl: '/uploads/voice/ai/proactive-atomic-self-check.mp3', audioBytes: 100, durationSeconds: 1, outputFormat: 'mp3_44100_128' };
  };
  try {
    const [[selected]] = await db.execute("SELECT id, site_id FROM ai_characters WHERE character_status = 'published' AND visibility = 'public' ORDER BY created_at LIMIT 1");
    assert.ok(selected?.id, 'local published character is required');
    characterId = selected.id;
    const [[site]] = await db.execute('SELECT id FROM sites ORDER BY created_at LIMIT 1');
    await db.execute(`INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type, site_id)
      VALUES (?, ?, ?, 'not-a-login-fixture', ?, 'active', 'personal', ?)`, [ids.user, ids.user, ids.user, `${ids.user}@example.invalid`, site.id]);
    await db.execute(`INSERT INTO chat_sessions (id, internal_uid, character_id, session_title, session_status, source_type, preferred_language)
      VALUES (?, ?, ?, 'atomic proactive fixture', 'active', 'user', 'English')`, [ids.session, ids.user, characterId]);
    await db.execute(`INSERT INTO chat_messages (id, session_id, character_id, sender_type, sender_label, content_type, text_content, display_order, delivery_status, source_type, sent_at)
      VALUES (?, ?, ?, 'user', 'Fixture', 'text', 'Hello', 10, 'sent', 'user', NOW(3))`, [ids.seed, ids.session, characterId]);
    await db.execute(`INSERT INTO memory_jobs (id, internal_uid, character_id, session_id, job_type, job_status, claim_token, started_at, available_at)
      VALUES (?, ?, ?, ?, 'send_proactive_message', 'running', ?, NOW(3), DATE_ADD(NOW(3), INTERVAL 1 DAY))`, [ids.job, ids.user, characterId, ids.session, actualJob.claimToken]);
    const id = deliveryApi.getProactiveJobDeliveryId(ids.job);
    await deliveryApi.reserveProactiveMessageDelivery({ userId: ids.user, siteId: site.id, characterId, sessionId: ids.session,
      deliveryDate: '2026-10-19', slotIndex: 1, sourceType: 'proactive_nudge', deliveryId: id });
    const actualInput = { userId: ids.user, characterId, sessionId: ids.session, text,
      proactivePolicy: { state: 'neutral', candidateKind: 'care', latestUserMessageId: ids.seed, candidateText: text },
      generateVoiceAudio, job: actualJob, delivery: { id, sourceType: 'proactive_nudge', sourceRef: 'proactive-nudge' } };
    await assert.rejects(api.createProactiveCharacterMessage({ ...actualInput, job: { ...actualJob, claimToken: 'stale' } }), /lease/);
    gateVoice = true;
    const firstSend = api.createProactiveCharacterMessage(actualInput);
    // This send now owns the lease row and owner lock. Revocation cannot slip between its proof and commit.
    await Promise.race([voiceStarted, new Promise((_, reject) => setTimeout(() => reject(new Error('voice fixture did not reach send transaction')), 10000))]);
    let revocationFinished = false;
    const revocation = db.execute('UPDATE memory_jobs SET claim_token = ? WHERE id = ?', ['replacement', ids.job])
      .then(() => { revocationFinished = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(revocationFinished, false, 'lease revocation must wait for an active send transaction');
    releaseVoice();
    await firstSend;
    await revocation;
    const [[facts]] = await db.execute(`SELECT delivery_status, message_id FROM proactive_message_deliveries WHERE id = ?`, [id]);
    assert.equal(facts.delivery_status, 'sent');
    assert.ok(facts.message_id);
    await assert.rejects(api.createProactiveCharacterMessage(actualInput), /lease/, 'old worker cannot send after replacement');
    const replay = await api.createProactiveCharacterMessage({ ...actualInput, job: { ...actualJob, claimToken: 'replacement' } });
    assert.equal(replay.replayed, true);
    const [[counts]] = await db.execute("SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ? AND sender_type = 'character'", [ids.session]);
    assert.equal(Number(counts.count), 1, 'committed send and retry produce exactly one message');
    // Existing direct callers keep their behavior and policy/voice handling without a lease or delivery object.
    gateVoice = false;
    const directText = 'What are you most looking forward to this weekend?';
    const direct = await api.createProactiveCharacterMessage({ ...actualInput, job: null, delivery: null, text: directText,
      proactivePolicy: { ...actualInput.proactivePolicy, candidateText: directText } });
    assert.ok(direct.items[0]?.voice?.id);
    const campaignApi = await import('../server/promotion-campaign-match-service.js');
    const campaignJob = { id: `${ids.job}_campaign`, claimToken: actualJob.claimToken };
    await db.execute(`INSERT INTO memory_jobs (id, internal_uid, character_id, session_id, job_type, job_status, claim_token, started_at, available_at)
      VALUES (?, ?, ?, ?, 'send_proactive_message', 'running', ?, NOW(3), DATE_ADD(NOW(3), INTERVAL 1 DAY))`, [campaignJob.id, ids.user, characterId, ids.session, campaignJob.claimToken]);
    await db.execute(`INSERT INTO promotion_campaigns (id, site_id, title, product_title, product_url, message_text)
      VALUES (?, ?, 'atomic fixture', 'Fixture shirt', 'https://example.invalid/shirt', 'Fixture campaign')`, [ids.campaign, site.id]);
    const campaignId = deliveryApi.getProactiveJobDeliveryId(campaignJob.id, 'campaign');
    const campaignDeliveryId = deliveryApi.getProactiveJobDeliveryId(campaignJob.id);
    const campaign = { id: ids.campaign, siteId: site.id, productTitle: 'Fixture shirt', productUrl: 'https://example.invalid/shirt', productSnapshot: { name: 'Fixture shirt', url: 'https://example.invalid/shirt' } };
    await campaignApi.reservePromotionCampaignDelivery({ job: campaignJob, campaign, userId: ids.user, characterId, sessionId: ids.session, deliveryId: campaignId });
    await deliveryApi.reserveProactiveMessageDelivery({ job: campaignJob, userId: ids.user, siteId: site.id, characterId, sessionId: ids.session,
      deliveryDate: '2026-10-19', slotIndex: 2, sourceType: 'promotion_campaign', campaignId: ids.campaign, deliveryId: campaignDeliveryId });
    const campaignText = 'Here is the shirt you asked about.';
    const campaignInput = { ...actualInput, text: campaignText, job: campaignJob, campaign,
      proactivePolicy: { state: 'shopping', latestUserMessageId: ids.seed, candidateText: campaignText },
      delivery: { id: campaignDeliveryId, sourceType: 'promotion_campaign', sourceRef: 'promotion-campaign', campaignId: ids.campaign, campaignDeliveryId: campaignId } };
    const campaignSends = await Promise.all([api.createProactivePromotionCampaignMessages(campaignInput), api.createProactivePromotionCampaignMessages(campaignInput)]);
    assert.equal(campaignSends.filter((result) => result.replayed).length, 1);
    const [[campaignFact]] = await db.execute('SELECT delivery_status FROM promotion_campaign_deliveries WHERE id = ?', [campaignId]);
    const [[slotFact]] = await db.execute('SELECT delivery_status FROM proactive_message_deliveries WHERE id = ?', [campaignDeliveryId]);
    assert.equal(campaignFact.delivery_status, 'sent');
    assert.equal(slotFact.delivery_status, 'sent');
    const [[campaignMessages]] = await db.execute("SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ? AND source_ref IN ('promotion-campaign', 'promotion-campaign-product')", [ids.session]);
    assert.equal(Number(campaignMessages.count), 2, 'two concurrent campaign attempts produce one text/product pair');
    console.log('Proactive local DB fencing, commit/replay, concurrent revocation/campaign and direct entry checks passed.');
  } finally {
    releaseVoice();
    // Exact private fixture ownership only; no production state or character configuration is modified.
    await db.execute('DELETE FROM character_voice_assets WHERE message_id IN (SELECT id FROM chat_messages WHERE session_id = ?)', [ids.session]);
    await db.execute('DELETE FROM proactive_message_deliveries WHERE internal_uid = ?', [ids.user]);
    await db.execute('DELETE FROM promotion_campaign_deliveries WHERE internal_uid = ?', [ids.user]);
    await db.execute('DELETE FROM promotion_campaigns WHERE id = ?', [ids.campaign]);
    await db.execute('DELETE FROM memory_jobs WHERE internal_uid = ?', [ids.user]);
    await db.execute('DELETE FROM chat_message_index WHERE session_id = ?', [ids.session]).catch(() => {});
    await db.execute('DELETE FROM chat_messages WHERE session_id = ?', [ids.session]);
    await db.execute('DELETE FROM chat_sessions WHERE id = ?', [ids.session]);
    await db.execute('DELETE FROM users WHERE id = ?', [ids.user]);
    await closeDbPool();
  }
}
