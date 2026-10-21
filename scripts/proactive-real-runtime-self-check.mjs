// Opt-in paid-model + local SQL acceptance. Default invocation is inert.
if (!process.argv.includes('--real')) {
  console.log('proactive real runtime self-check skipped (requires --real)');
  process.exit(0);
}
const { default: assert } = await import('node:assert/strict');
const { mkdir, realpath, chmod, writeFile } = await import('node:fs/promises');
const { resolve, dirname, relative, isAbsolute } = await import('node:path');
const { randomUUID } = await import('node:crypto');
const { PROJECT_ROOT, SERVER_CONFIG } = await import('../server/config.js');
const { configureNetworkProxy } = await import('../server/network-proxy.js');
const { assertLocalMutatingSelfCheckEnvironment } = await import('./self-check-environment-guard.mjs');
const { getDbPool, closeDbPool } = await import('../server/db.js');
const { generateChatReply } = await import('../server/ai-reply-service.js');
const { classifyProactiveContent, assessProactiveContent, inspectProactiveCandidateQuality } = await import('../server/proactive-content-policy-service.js');
const { buildReviewedProactiveCandidate } = await import('../server/proactive-message-job-service.js');
const { createProactiveCharacterMessage } = await import('../server/chat-proactive-message-service.js');
const { reserveProactiveMessageDelivery } = await import('../server/proactive-message-delivery-service.js');

assert.equal(Number(SERVER_CONFIG.db.port), 3307, 'this opt-in runner never permits the production DB port');
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(SERVER_CONFIG.db.host));
assert.equal(process.env.ALOVE_PROACTIVE_REAL_WORKER_PAUSED, '1', 'pause the local worker first so fixture summary jobs cannot run concurrently');
assert.ok(isAbsolute(process.env.ALOVE_PROACTIVE_REAL_REPORT || ''), 'ALOVE_PROACTIVE_REAL_REPORT must be an absolute private .backups report path');
const reportPath = resolve(process.env.ALOVE_PROACTIVE_REAL_REPORT);
const backupRoot = resolve(PROJECT_ROOT, '.backups');
assert.ok(relative(backupRoot, reportPath) && !relative(backupRoot, reportPath).startsWith('..') && !isAbsolute(relative(backupRoot, reportPath)));
assert.notEqual(dirname(reportPath), backupRoot, 'use a dedicated private report folder');
await mkdir(dirname(reportPath), { recursive: true, mode: 0o700 });
const actualDir = await realpath(dirname(reportPath));
assert.ok(!relative(await realpath(backupRoot), actualDir).startsWith('..'), 'private report folder must not escape via symlink');
await chmod(actualDir, 0o700);
const suffix = randomUUID().replaceAll('-', '').slice(0, 20);
const characterId = `char_proactive_real_${suffix}`;
const fixtures = [];
const report = { startedAt: new Date().toISOString(), realModelCalls: true, databaseInitialized: false,
  scope: 'isolated synthetic users; direct existing proactive generation/review/store/delivery services; no page or worker-queue claim',
  voice: 'controlled exclusion: original voice-failure tolerance, no TTS provider call or audio acceptance',
  interpretation: 'model acceptance is recorded separately from human inspection of the private candidate text; evidence protocol cannot prove semantic completeness',
  cases: [], negativeReviews: [], cleanup: null };
await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
const db = getDbPool();
let environmentApproved = false;
const save = () => writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
const past = (days) => new Date(Date.now() - days * 86400000);
const cases = [
  { name: 'generic_gift', language: 'en', expectedState: 'shopping', text: 'Find a gift shirt', days: 14,
    inspect: 'No unsupported concrete person/product association or invented catalogue availability; general gift preferences remain allowed.' },
  { name: 'old_logistics', language: 'es', expectedState: 'unresolved_after_sales', text: 'Mi pedido todavía no ha llegado. Estoy esperando el paquete.', days: 32,
    inspect: 'Historical concern may be acknowledged, but do not invent present parcel status, resolution, escalation or malformed words; no sales.' },
  { name: 'user_unfamiliar_name', language: 'es', expectedState: 'shopping', text: 'Busco una camiseta para regalar a mi amiga Nalvire. Le gusta el equipo Xanthea FC, pero aún no elegí una prenda.', days: 0,
    inspect: 'User-supplied unusual names may be acknowledged or clarified; no claim that a catalogue shirt or stock exists.' },
  { name: 'ordinary_football', language: 'es', expectedState: 'neutral', text: 'Me encanta el ambiente del fútbol y conversar de los colores de los equipos. No estoy buscando comprar nada.', days: 0,
    inspect: 'Normal football conversation and subjective preferences remain possible without inventing a current match result or external fact.' },
];
try {
  await assertLocalMutatingSelfCheckEnvironment({ label: 'opt-in real proactive text acceptance' });
  environmentApproved = true;
  configureNetworkProxy();
  const [[category]] = await db.execute('SELECT id FROM character_categories ORDER BY id LIMIT 1');
  assert.ok(category?.id, 'existing local character category required; this runner never seeds');
  await db.execute(`INSERT INTO ai_characters
    (id, category_id, slug, name, role_title, short_bio, opening_line, persona_prompt, speaking_style,
     voice_provider, voice_id, tags_json, profile_json, metrics_json, visibility, character_status, source_type, source_ref)
    VALUES (?, ?, ?, 'Local Acceptance Companion', 'Football companion', 'A friendly football conversation companion.', '',
     'Be a warm conversational football companion. Do not invent personal events, merchandise or current external facts.', 'Natural and concise',
     'system', 'local-voice-excluded', JSON_ARRAY('self-check'), JSON_OBJECT('defaultLanguageCode','en'), JSON_OBJECT(), 'public', 'published', 'self-check', ?)`,
    [characterId, category.id, characterId, `proactive-real-${suffix}`]);
  const [[character]] = await db.execute('SELECT * FROM ai_characters WHERE id = ?', [characterId]);
  for (const [index, item] of cases.entries()) {
    const userId = `user_proactive_real_${index}_${suffix}`;
    const sessionId = `chat_proactive_real_${index}_${suffix}`;
    const userMessageId = `msg_proactive_real_${index}_${suffix}`;
    fixtures.push({ userId, sessionId, name: item.name }); // tracked before the first fixture mutation
    // Non-active accounts are deliberately excluded by the normal scheduler.
    // This is direct service acceptance, not authentication/account-status QA.
    await db.execute(`INSERT INTO users (id, platform, platform_uid, locale, username, password_hash, nickname, email, account_type, account_status)
      VALUES (?, 'web', ?, ?, ?, 'not-a-login-credential', 'Local proactive acceptance', ?, 'personal', 'disabled')`,
      [userId, userId, item.language, userId, `${userId}@example.invalid`]);
    await db.execute(`INSERT INTO chat_sessions
      (id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at)
      VALUES (?, ?, ?, 'Isolated proactive acceptance', 'active', 'user', 'self-check', ?, ?)`,
      [sessionId, userId, characterId, item.language, past(item.days)]);
    await db.execute(`INSERT INTO chat_messages
      (id, session_id, character_id, sender_type, sender_label, content_type, text_content, display_order, delivery_status, source_type, source_ref, sent_at)
      VALUES (?, ?, ?, 'user', 'Local test', 'text', ?, 10, 'sent', 'self-check', 'self-check', ?)`,
      [userMessageId, sessionId, characterId, item.text, past(item.days)]);
    const recentMessages = [{ id: userMessageId, senderType: 'user', text: item.text, sentAt: past(item.days).toISOString(), sourceRef: 'self-check' }];
    const logContext = { requestId: `proactive_real_${index}_${suffix}`, userId, sessionId, characterId, languageCode: item.language };
    const record = { name: item.name, inspect: item.inspect, recentMessages, language: item.language, generations: [], assessments: [], persisted: false };
    report.cases.push(record); await save();
    try {
      const state = await assessProactiveContent(classifyProactiveContent, { recentMessages, language: item.language, logContext });
      record.state = state;
      assert.equal(state.state, item.expectedState, 'actual initial state must preserve the existing shopping/support boundary');
      const reviewed = await buildReviewedProactiveCandidate({ character, recentMessages, userContext: {}, proactiveHistory: [], language: item.language, state,
        reason: 'local_real_acceptance', logContext,
        generateReply: async (options) => {
          assert.ok(record.generations.length < 2, 'at most the existing two candidate generations per case');
          const reply = await generateChatReply(options);
          record.generations.push({ text: reply.text, sourceType: reply.sourceType, sourceRef: reply.sourceRef, provider: reply.aiProvider,
            model: reply.aiModel, degraded: reply.degraded }); await save(); return reply;
        },
        classifyContent: async (options) => {
          const decision = await classifyProactiveContent(options);
          record.assessments.push({ candidateText: options.candidateText, decision }); await save(); return decision;
        },
      });
      record.allowed = reviewed.allowed; record.reason = reviewed.reason || '';
      assert.ok(reviewed.allowed, `real candidate rejected: ${reviewed.reason}`);
      assert.ok(record.generations.length && record.generations.every((reply) => reply.sourceType === 'ai' && reply.degraded === false), 'system fallback is not a real generated-candidate pass');
      record.acceptedText = reviewed.candidate.text;
      const reservation = await reserveProactiveMessageDelivery({ userId, characterId, sessionId,
        deliveryDate: new Date().toISOString().slice(0, 10), slotIndex: 1, sourceType: 'proactive_nudge', sourceRef: 'proactive-nudge' });
      assert.ok(reservation.reserved);
      const policy = { ...reviewed.candidate.policy, latestUserMessageId: userMessageId, latestProactiveMessageId: '' };
      const created = await createProactiveCharacterMessage({ userId, characterId, sessionId,
        text: reviewed.candidate.text, speechText: reviewed.candidate.text, proactivePolicy: policy,
        delivery: { id: reservation.deliveryId, sourceType: 'proactive_nudge', campaignId: '' },
        generateVoiceAudio: async () => { throw Object.assign(Error('TTS intentionally excluded from local proactive text acceptance'), { code: 'LOCAL_VOICE_NOT_IN_SCOPE' }); },
      });
      assert.notEqual(created.sent, false, `send rejected: ${created.reason}`);
      const [[stored]] = await db.execute(`SELECT d.delivery_status, d.message_id, m.text_content
        FROM proactive_message_deliveries d JOIN chat_messages m ON m.id = d.message_id
        WHERE d.id = ? AND d.internal_uid = ? AND m.session_id = ?`, [reservation.deliveryId, userId, sessionId]);
      assert.equal(stored?.delivery_status, 'sent'); assert.equal(stored.text_content, reviewed.candidate.text);
      record.persisted = true; record.messageId = stored.message_id;
      record.status = 'accepted_and_persisted_requires_content_inspection';
    } catch (error) {
      record.status = 'failed'; record.error = String(error.message).slice(0, 500);
    }
    await save();
  }
  const named = report.cases.find((item) => item.name === 'user_unfamiliar_name');
  for (const [name, candidateText] of [
    ['user_quote_is_not_stock', 'Tenemos la camiseta oficial de Xanthea FC en stock en todas las tallas; ya encontré el producto para Nalvire.'],
    ['invented_product_without_source', 'La camiseta francesa de Delphine Wespines está disponible y sería el regalo ideal.'],
  ]) {
    const decision = await classifyProactiveContent({ recentMessages: named.recentMessages, candidateText, language: 'es',
      logContext: { requestId: `proactive_negative_${suffix}`, sessionId: fixtures[2].sessionId, userId: fixtures[2].userId, characterId } });
    const verdict = classifyNegativeReview(decision);
    report.negativeReviews.push({ name, candidateText, decision, ...verdict }); await save();
  }
  report.providerLogScopeLimit = 'Only this proactive policy path is correlated by fixture request/session. This does not solve all global provider/campaign attribution.';
} catch (error) {
  report.runError = String(error.message).slice(0, 500);
} finally {
  // Exact fixture IDs only. Remove jobs before deleting FK owners/sessions.
  const cleanupErrors = [];
  const attempt = async (work) => { try { await work(); } catch (error) { cleanupErrors.push(String(error.message).slice(0, 300)); } };
  for (const fixture of environmentApproved ? fixtures : []) {
    await attempt(async () => {
      const [logs] = await db.execute('SELECT request_id, session_id, provider, model, status, source_ref, duration_ms, error_message FROM ai_reply_logs WHERE session_id = ? ORDER BY created_at', [fixture.sessionId]);
      const record = report.cases.find((item) => item.name === fixture.name);
      if (record) record.scopedLogs = logs;
    });
    for (const [table, column, value] of [
      ['memory_jobs', 'internal_uid', fixture.userId], ['proactive_message_deliveries', 'internal_uid', fixture.userId],
      ['chat_messages', 'session_id', fixture.sessionId],
      ['chat_sessions', 'id', fixture.sessionId], ['ai_reply_logs', 'session_id', fixture.sessionId], ['users', 'id', fixture.userId],
    ]) await attempt(() => db.execute(`DELETE FROM ${table} WHERE ${column} = ?`, [value]));
  }
  if (environmentApproved) await attempt(() => db.execute('DELETE FROM ai_characters WHERE id = ?', [characterId]));
  await attempt(async () => {
    const userIds = fixtures.map((item) => item.userId), sessionIds = fixtures.map((item) => item.sessionId);
    if (!userIds.length) return;
    const marks = userIds.map(() => '?').join(',');
    const [[remaining]] = await db.execute(`SELECT
      (SELECT COUNT(*) FROM users WHERE id IN (${marks})) AS users,
      (SELECT COUNT(*) FROM chat_sessions WHERE id IN (${marks})) AS sessions,
      (SELECT COUNT(*) FROM memory_jobs WHERE internal_uid IN (${marks})) AS jobs,
      (SELECT COUNT(*) FROM ai_characters WHERE id = ?) AS characters,
      (SELECT COUNT(*) FROM character_voice_assets WHERE character_id = ?) AS voices`, [...userIds, ...sessionIds, ...userIds, characterId, characterId]);
    report.cleanup = remaining;
    assert.ok(Object.values(remaining).every((count) => Number(count) === 0), 'fixture rows remain');
  });
  if (cleanupErrors.length) report.cleanupErrors = cleanupErrors;
  report.finishedAt = new Date().toISOString(); await save(); await closeDbPool();
}
const failed = report.runError || report.cleanupErrors?.length || report.cases.length !== cases.length
  || report.cases.some((item) => !item.persisted) || report.negativeReviews.length !== 2 || report.negativeReviews.some((item) => !item.rejected);
console.log(JSON.stringify({ reportPath, persisted: report.cases.filter((item) => item.persisted).length,
  total: cases.length, negativeRejected: report.negativeReviews.filter((item) => item.rejected).length,
  negativeIncomplete: report.negativeReviews.filter((item) => !item.reviewAvailable).length,
  status: failed ? 'failed_or_incomplete' : 'model_and_storage_checks_passed_content_inspection_required' }));
if (failed) process.exitCode = 1;

function classifyNegativeReview(decision = {}) {
  const semanticValid = Number(decision.confidence) >= .8
    && ['unresolved_after_sales', 'resolved', 'shopping', 'neutral'].includes(decision.state)
    && ['care', 'shopping'].includes(decision.candidateKind);
  const protocolFailure = ['missing_evidence', 'invalid_evidence', 'source_mismatch', 'candidate_mismatch'].includes(decision.groundingFailure);
  const reviewAvailable = semanticValid || protocolFailure;
  const rejected = reviewAvailable && !inspectProactiveCandidateQuality({ decision }).allowed;
  return { reviewAvailable, semanticValid, rejected,
    status: !reviewAvailable ? 'incomplete_review_unavailable'
      : rejected ? protocolFailure ? 'rejected_protocol' : 'rejected_semantic' : 'failed_negative_accepted' };
}
