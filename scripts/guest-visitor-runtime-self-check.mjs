import { assertLocalMutatingSelfCheckEnvironment } from './self-check-environment-guard.mjs';
import { cleanupGuestVisitorHistory } from '../server/guest-visitor-cleanup-service.js';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createId } from '../server/security.js';
import { getDbPool, closeDbPool } from '../server/db-core.js';
import { recordGuestIdentity, getGuestVisitorContinuity } from '../server/guest-visitor-service.js';

// Real HTTP cookie serialization and real local DB; isolated observer fixtures,
// no chat creation, provider requests, production access or full DB initialization.
await assertLocalMutatingSelfCheckEnvironment({ label: 'guest visitor runtime self-check' });
const pool = getDbPool();
const site = createId('visitor_check');
const ids = [createId('guest_check'), createId('guest_check')];
const server = createServer(async (req, res) => {
  const index = req.url === '/second' ? 1 : 0;
  await recordGuestIdentity(req, res, { guest: { id: ids[index], site_id: site, site_slug: site }, created: !req.headers.cookie?.includes('aiove_guest_session=') });
  res.end('ok');
});
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await getGuestVisitorContinuity({ execute: async () => { throw Error('secret must not escape'); } }, ids)).size, 0);
  const first = await fetch(base);
  const cookie = first.headers.getSetCookie().find((s) => s.startsWith('aiove_visitor_id='));
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Max-Age=7776000/);
  const visitor = cookie.split(';')[0];
  await fetch(`${base}/second`, { headers: { cookie: visitor } });
  const map = await getGuestVisitorContinuity(pool, ids);
  assert.equal(map.get(ids[0]).visitorId, map.get(ids[1]).visitorId);
  assert.equal(map.get(ids[1]).lastReason, 'guest_cookie_missing');
  await fetch(base, { headers: { cookie: `${visitor}; aiove_guest_session=test` } });
  assert.equal((await getGuestVisitorContinuity(pool, ids)).get(ids[0]).lastOutcome, 'reused');
  const recovered = await Promise.all([fetch(base, { headers: { cookie: 'aiove_guest_session=test' } }), fetch(base, { headers: { cookie: 'aiove_guest_session=test' } })]);
  assert.equal(recovered[0].headers.getSetCookie()[0], recovered[1].headers.getSetCookie()[0], 'concurrent observer recovery must converge');
  const [[row]] = await pool.execute('SELECT token_hash FROM anonymous_visitors WHERE site_id = ?', [site]);
  assert.ok(!visitor.includes(row.token_hash));
  await pool.execute('UPDATE anonymous_visitors SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 DAY) WHERE site_id = ?', [site]);
  const rotated = await fetch(base, { headers: { cookie: `${visitor}; aiove_guest_session=test` } });
  assert.notEqual(rotated.headers.getSetCookie()[0].split(';')[0], visitor);
  assert.equal((await getGuestVisitorContinuity(pool, ids)).get(ids[0]).visitorId, map.get(ids[0]).visitorId);
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM anonymous_visitors WHERE site_id = ?', [site]);
  assert.equal(count.n, 1, 'expiry with surviving guest must not create orphan visitors');
  const [events] = await pool.execute('SELECT outcome FROM guest_identity_events WHERE site_slug = ?', [site]);
  assert.equal(events.length, 6);
  await recordGuestIdentity({ headers: { cookie: 'aiove_guest_session=unrecognized-selfcheck' } }, {}, { invalid: true, siteSlug: site });
  const [[invalid]] = await pool.execute("SELECT reason FROM guest_identity_events WHERE site_slug = ? AND outcome = 'invalid'", [site]);
  assert.equal(invalid.reason, 'guest_unrecognized');
  await pool.execute("UPDATE guest_identity_events SET created_at = '1900-01-01' WHERE site_slug = ? AND outcome = 'invalid'", [site]);
  const cleanup = await cleanupGuestVisitorHistory({ now: new Date('1901-01-01T00:00:00Z'), limit: 1 });
  assert.equal(cleanup.deletedGuestIdentityEvents, 1);
  assert.equal(cleanup.deletedAnonymousVisitors, 0);
  const [[remaining]] = await pool.execute('SELECT COUNT(*) AS n FROM guest_identity_events WHERE site_slug = ?', [site]);
  assert.equal(remaining.n, 6, 'recent audit records survive retention');
  await pool.execute("UPDATE anonymous_visitors SET expires_at = '1900-01-01' WHERE site_id = ?", [site]);
  const orphanCleanup = await cleanupGuestVisitorHistory({ now: new Date('1901-01-01T00:00:00Z'), limit: 1 });
  assert.equal(orphanCleanup.deletedAnonymousVisitors, 1);
  assert.equal((await getGuestVisitorContinuity(pool, ids)).size, 0, 'orphan visitor links cleaned');
  console.log('guest visitor real HTTP/DB observer self-check passed');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await pool.execute('DELETE FROM guest_identity_events WHERE site_slug = ?', [site]);
  await pool.execute('DELETE FROM guest_visitor_links WHERE guest_session_id IN (?, ?)', ids);
  await pool.execute('DELETE FROM anonymous_visitors WHERE site_id = ?', [site]);
  await closeDbPool();
}
