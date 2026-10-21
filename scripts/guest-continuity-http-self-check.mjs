import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// Exercise the actual route and services with real MySQL; disable paid opening
// voice generation only in this isolated test process, not the running app.
process.env.ELEVENLABS_API_KEY = '';
const { assertLocalMutatingSelfCheckEnvironment } = await import('./self-check-environment-guard.mjs');
const { getDbPool, closeDbPool } = await import('../server/db.js');
const { handleGuestChatRoute } = await import('../server/guest-chat-routes.js');
const { getGuestVisitorContinuity, recordGuestIdentity } = await import('../server/guest-visitor-service.js');
const { listAdminGuestSessions } = await import('../server/admin-guest-session-service.js');
const { buildGuestNetworkHash } = await import('../server/guest-network-rate-limit-service.js');
const { createExternalSourceHandoffToken, normalizeExternalSourcePage } = await import('../server/external-source-context-service.js');
await assertLocalMutatingSelfCheckEnvironment({ label: 'guest continuity HTTP chain' });
const db = getDbPool();
const guestIds = new Set();
const visitors = new Set();
const siteIds = new Set();
const testIp = '198.51.100.241';
const origin = 'http://127.0.0.1:4173';
const networkHash = buildGuestNetworkHash({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': testIp } });
const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, origin);
    const handled = await handleGuestChatRoute(req, res, { path: requestUrl.pathname, requestUrl });
    if (!handled) { res.statusCode = 404; res.end(); }
  } catch (error) {
    res.statusCode = Number(error.statusCode || 500);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: res.statusCode }));
  }
});
let site;
try {
  const [[row]] = await db.execute(`SELECT s.id, s.slug, COALESCE(ms.character_id, s.mascot_character_id) AS character_id
    FROM sites s LEFT JOIN mascot_settings ms ON ms.site_id=s.id AND ms.setting_status='active'
    WHERE s.slug='camisetasfutbol' AND s.site_status='active' AND s.guest_chat_enabled=1 LIMIT 1`);
  site = row;
  siteIds.add(site.id);
  assert.ok(site?.character_id);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(cookie = '', slug = site.slug, handoff = '') {
    const response = await fetch(`${base}/api/guest/session?siteSlug=${encodeURIComponent(slug)}&handoff=${encodeURIComponent(handoff)}`, {
      headers: { Origin: origin, Cookie: cookie, 'X-Forwarded-For': testIp },
    });
    const body = await response.json();
    if (body.session?.id) {
      const [[guest]] = await db.execute('SELECT id FROM guest_sessions WHERE chat_session_id = ?', [body.session.id]);
      assert.ok(guest);
      guestIds.add(guest.id);
      body.testGuestId = guest.id;
      const map = await getGuestVisitorContinuity(db, [guest.id]);
      if (map.get(guest.id)) visitors.add(map.get(guest.id).visitorId);
    }
    return { response, body, cookies: response.headers.getSetCookie().map((v) => v.split(';')[0]) };
  }
  const first = await request();
  assert.equal(first.response.status, 200);
  const guestCookie = first.cookies.find((v) => v.startsWith('aiove_guest_session='));
  let visitorCookie = first.cookies.find((v) => v.startsWith('aiove_visitor_id='));
  assert.ok(guestCookie && visitorCookie);
  // Emulate a pre-migration guest receiving its first observer from two tabs.
  const oldVisitor = (await getGuestVisitorContinuity(db, [first.body.testGuestId])).get(first.body.testGuestId).visitorId;
  await db.execute('DELETE FROM guest_visitor_links WHERE guest_session_id = ?', [first.body.testGuestId]);
  await db.execute('DELETE FROM anonymous_visitors WHERE id = ?', [oldVisitor]);
  const concurrent = await Promise.all([request(guestCookie), request(guestCookie)]);
  assert.ok(concurrent.every((r) => r.response.status === 200 && r.body.session.id === first.body.session.id));
  const recoveredCookies = concurrent.map((r) => r.cookies.find((v) => v.startsWith('aiove_visitor_id=')));
  assert.equal(recoveredCookies[0], recoveredCookies[1]);
  assert.ok(recoveredCookies[0]);
  visitorCookie = recoveredCookies[0];
  const [[linked]] = await db.execute('SELECT COUNT(*) AS n FROM guest_visitor_links WHERE guest_session_id = ?', [first.body.testGuestId]);
  assert.equal(linked.n, 1);
  const both = `${guestCookie}; ${visitorCookie}`;
  const reused = await request(both);
  assert.equal(reused.body.session.id, first.body.session.id);
  assert.deepEqual(reused.body.items.map((m) => m.id), first.body.items.map((m) => m.id));

  const sourceOrigin = 'https://www.camisetasfutbol.mx';
  const handoff = createExternalSourceHandoffToken({ publicId: 'continuity-local-check', siteId: site.id,
    siteSlug: site.slug, mascotCharacterId: site.character_id, sourceOrigin,
    page: normalizeExternalSourcePage({ sourceUrl: `${sourceOrigin}/productdetail/Continuity-Check/623621`, expectedOrigin: sourceOrigin }) });
  const reentered = await request(both, site.slug, handoff);
  assert.equal(reentered.body.session.id, first.body.session.id);
  const [[source]] = await db.execute('SELECT external_source_context_json FROM guest_sessions WHERE id = ?', [first.body.testGuestId]);
  const context = typeof source.external_source_context_json === 'string' ? JSON.parse(source.external_source_context_json) : source.external_source_context_json;
  assert.equal(context.sourceProductId, '623621');

  const second = await request(visitorCookie, site.slug, handoff);
  assert.equal(second.response.status, 200);
  assert.notEqual(second.body.session.id, first.body.session.id);
  let map = await getGuestVisitorContinuity(db, [...guestIds]);
  assert.equal(map.get(second.body.testGuestId).visitorId, map.get(first.body.testGuestId).visitorId);
  const third = await request();
  assert.equal(third.response.status, 200);
  map = await getGuestVisitorContinuity(db, [...guestIds]);
  assert.notEqual(map.get(third.body.testGuestId).visitorId, map.get(first.body.testGuestId).visitorId);
  const observerLost = await request(guestCookie);
  assert.equal(observerLost.body.session.id, first.body.session.id);
  assert.equal((await getGuestVisitorContinuity(db, [...guestIds])).get(first.body.testGuestId).visitorId, map.get(first.body.testGuestId).visitorId);

  const [[other]] = await db.execute("SELECT id, slug FROM sites WHERE id <> ? AND site_status='active' AND guest_chat_enabled=1 LIMIT 1", [site.id]);
  assert.ok(other);
  siteIds.add(other.id);
  const isolated = await request(visitorCookie, other.slug);
  assert.equal(isolated.response.status, 200);
  const isolatedMap = await getGuestVisitorContinuity(db, [...guestIds]);
  assert.notEqual(isolatedMap.get(isolated.body.testGuestId).visitorId, isolatedMap.get(first.body.testGuestId).visitorId);
  // A different valid observer cannot reassign a guest to someone else's group.
  const thirdVisitor = third.cookies.find((v) => v.startsWith('aiove_visitor_id='));
  const conflicted = await request(`${guestCookie}; ${thirdVisitor}`);
  assert.equal(conflicted.body.session.id, first.body.session.id);
  assert.equal((await getGuestVisitorContinuity(db, [...guestIds])).get(first.body.testGuestId).visitorId, map.get(first.body.testGuestId).visitorId);
  const mismatch = await request(both, other.slug);
  assert.equal(mismatch.response.status, 401);
  assert.ok(mismatch.response.headers.getSetCookie().some((v) => v.startsWith('aiove_guest_session=') && v.includes('Max-Age=0')));
  const [[event]] = await db.execute("SELECT reason FROM guest_identity_events WHERE guest_session_id = ? AND site_slug = ? AND outcome='invalid' ORDER BY created_at DESC LIMIT 1", [first.body.testGuestId, other.slug]);
  assert.equal(event.reason, 'guest_site_mismatch');

  const admin = await listAdminGuestSessions({ query: first.body.testGuestId });
  const item = admin.items.find((v) => v.id === first.body.testGuestId);
  assert.equal(item.visitorContinuity.sessionCount, 2);
  assert.equal(item.visitorContinuity.lastReason, 'guest_site_mismatch');
  assert.ok(item.continuityCandidates.some((v) => v.guestId === second.body.testGuestId));
  assert.ok(item.visitorContinuity.linkedGuestIds.includes(second.body.testGuestId));
  assert.equal(JSON.stringify(item).includes(visitorCookie.split('=')[1]), false);
  const [[quota]] = await db.execute('SELECT message_window_count FROM guest_sessions WHERE id = ?', [first.body.testGuestId]);
  assert.equal(quota.message_window_count, 0);
  await db.execute('UPDATE guest_sessions SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 DAY) WHERE id = ?', [first.body.testGuestId]);
  const expired = await request(guestCookie);
  assert.equal(expired.response.status, 401);
  assert.equal((await getGuestVisitorContinuity(db, [...guestIds])).get(first.body.testGuestId).lastReason, 'guest_expired');
  const originalGetConnection = db.getConnection;
  const originalWarn = console.warn;
  const warnings = [];
  try {
    db.getConnection = async () => { throw Object.assign(new Error('private database detail'), { code: 'bad ' + guestCookie }); };
    console.warn = (...args) => warnings.push(args.join(' '));
    await recordGuestIdentity({ headers: { cookie: guestCookie } }, {}, { siteSlug: site.slug });
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].includes(guestCookie), false);
    assert.equal(warnings[0].includes('private database detail'), false);
  } finally {
    db.getConnection = originalGetConnection;
    console.warn = originalWarn;
  }
  console.log('guest continuity actual route HTTP + MySQL + admin chain passed (reuse, source refresh, cookie loss, isolation, quota)');
} finally {
  await new Promise((resolve) => server.close(resolve));
  for (const id of guestIds) {
    const [[guest]] = await db.execute('SELECT chat_session_id FROM guest_sessions WHERE id = ?', [id]);
    await db.execute('DELETE FROM character_voice_assets WHERE message_id IN (SELECT id FROM chat_messages WHERE guest_session_id = ?)', [id]);
    await db.execute('DELETE FROM mascot_greeting_message_deliveries WHERE session_id = ?', [guest.chat_session_id]);
    await db.execute('DELETE FROM chat_messages WHERE guest_session_id = ?', [id]);
    await db.execute('DELETE FROM guest_image_entitlements WHERE guest_session_id = ?', [id]);
    await db.execute('DELETE FROM guest_character_sessions WHERE guest_session_id = ?', [id]);
    await db.execute('DELETE FROM chat_sessions WHERE id = ?', [guest.chat_session_id]);
    await db.execute('DELETE FROM guest_identity_events WHERE guest_session_id = ?', [id]);
    await db.execute('DELETE FROM guest_visitor_links WHERE guest_session_id = ?', [id]);
    await db.execute('DELETE FROM guest_sessions WHERE id = ?', [id]);
  }
  for (const id of visitors) await db.execute('DELETE FROM anonymous_visitors WHERE id = ?', [id]);
  for (const siteId of siteIds) await db.execute('DELETE FROM guest_network_rate_limits WHERE network_hash = ? AND site_id = ?', [networkHash, siteId]);
  await closeDbPool();
}
