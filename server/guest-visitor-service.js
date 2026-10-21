import { createHash } from 'node:crypto';
import { createId, createToken, hashSessionToken } from './security.js';
import { getDbPool, withTransaction } from './db-core.js';
import { readCookie, setCookie } from './cookie-utils.js';

export const VISITOR_COOKIE_NAME = 'aiove_visitor_id';
export const VISITOR_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
const validToken = (token) => /^[a-f0-9]{64}$/.test(token);
const tokenHash = (token) => createHash('sha256').update(`anonymous-visitor:${token}`).digest('hex');

// Observational only: this identity never grants access or changes guest quotas.
export async function recordGuestIdentity(req, res, { guest = null, created = false, siteSlug = '', invalid = false } = {}) {
  const guestCookiePresent = Boolean(readCookie(req, 'aiove_guest_session'));
  const supplied = readCookie(req, VISITOR_COOKIE_NAME);
  const visitorCookiePresent = Boolean(supplied);
  const outcome = invalid ? 'invalid' : created ? 'created' : 'reused';
  let reason = invalid ? 'guest_unusable_for_site' : created ? 'guest_cookie_missing' : 'guest_cookie_valid';
  let eventGuestId = guest?.id || null;
  try {
    if (invalid && guestCookiePresent) {
      const [[existing]] = await getDbPool().execute(`SELECT g.id, g.session_status, g.expires_at, s.slug,
        s.site_status, s.guest_chat_enabled FROM guest_sessions g JOIN sites s ON s.id = g.site_id
        WHERE g.token_hash = ? LIMIT 1`, [hashSessionToken(readCookie(req, 'aiove_guest_session'))]);
      eventGuestId = existing?.id || null;
      reason = !existing ? 'guest_unrecognized'
        : existing.session_status !== 'active' ? 'guest_inactive'
        : new Date(existing.expires_at).getTime() <= Date.now() ? 'guest_expired'
        : existing.slug !== String(siteSlug || '').trim().toLowerCase() && siteSlug ? 'guest_site_mismatch'
        : existing.site_status !== 'active' || !existing.guest_chat_enabled ? 'guest_site_disabled'
        : 'guest_unusable_for_site';
    }
    let nextToken = validToken(supplied) ? supplied : createToken();
    await withTransaction(async (db) => {
      if (invalid && eventGuestId) {
        await db.execute(`UPDATE guest_visitor_links SET last_seen_at = NOW(3), last_outcome = ?, last_reason = ?,
          guest_cookie_present = ?, visitor_cookie_present = ? WHERE guest_session_id = ?`,
        [outcome, reason, Number(guestCookiePresent), Number(visitorCookiePresent), eventGuestId]);
      }
      if (guest?.id && guest?.site_id) {
        await db.execute('SELECT id FROM guest_sessions WHERE id = ? FOR UPDATE', [guest.id]);
        const [[previous]] = await db.execute(`SELECT v.id, v.token_hash, v.expires_at FROM guest_visitor_links l
          JOIN anonymous_visitors v ON v.id = l.visitor_id WHERE l.guest_session_id = ? AND v.site_id = ? LIMIT 1`, [guest.id, guest.site_id]);
        const [[suppliedVisitor]] = await db.execute('SELECT id, expires_at FROM anonymous_visitors WHERE site_id = ? AND token_hash = ?', [guest.site_id, tokenHash(nextToken)]);
        if (suppliedVisitor && new Date(suppliedVisitor.expires_at).getTime() <= Date.now()) nextToken = createToken();
        if (previous && suppliedVisitor && previous.id !== suppliedVisitor.id) nextToken = createToken();
        // Stable recovery from a still-valid, high-entropy guest credential prevents
        // concurrent responses installing different observer tokens. Never use guest ID.
        const guestToken = readCookie(req, 'aiove_guest_session');
        if (guestToken && (!validToken(supplied) || !suppliedVisitor || nextToken !== supplied || (previous && previous.token_hash !== tokenHash(nextToken)))) {
          nextToken = createHash('sha256').update(`visitor-recovery:${guest.site_id}:${guestToken}`).digest('hex');
        }
        const hash = tokenHash(nextToken);
        // A valid guest cookie proves continuity when only the observer cookie was lost.
        if (previous && previous.token_hash !== hash) {
          await db.execute('UPDATE anonymous_visitors SET token_hash = ?, last_seen_at = NOW(3), expires_at = DATE_ADD(NOW(3), INTERVAL 90 DAY) WHERE id = ?', [hash, previous.id]);
        }
        await db.execute(`INSERT INTO anonymous_visitors (id, site_id, token_hash, expires_at)
          VALUES (?, ?, ?, DATE_ADD(NOW(3), INTERVAL 90 DAY))
          ON DUPLICATE KEY UPDATE last_seen_at = NOW(3), expires_at = DATE_ADD(NOW(3), INTERVAL 90 DAY)`,
        [createId('visitor'), guest.site_id, hash]);
        const [[visitor]] = await db.execute('SELECT id FROM anonymous_visitors WHERE site_id = ? AND token_hash = ?', [guest.site_id, hash]);
        // Keep the original link if visitor storage was cleared while guest auth survived.
        await db.execute(`INSERT INTO guest_visitor_links (guest_session_id, visitor_id, last_outcome, last_reason, guest_cookie_present, visitor_cookie_present)
          VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE last_seen_at = NOW(3),
          last_outcome = VALUES(last_outcome), last_reason = VALUES(last_reason),
          guest_cookie_present = VALUES(guest_cookie_present), visitor_cookie_present = VALUES(visitor_cookie_present)`,
        [guest.id, visitor.id, outcome, reason, Number(guestCookiePresent), Number(visitorCookiePresent)]);
      }
      await db.execute(`INSERT INTO guest_identity_events (id, site_slug, guest_session_id, outcome, reason, guest_cookie_present, visitor_cookie_present)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [createId('identity'), String(guest?.site_slug || siteSlug || '').slice(0, 128), eventGuestId,
        outcome, reason, Number(guestCookiePresent), Number(visitorCookiePresent)]);
    });
    if (guest?.id) setCookie(res, VISITOR_COOKIE_NAME, nextToken, { maxAgeSeconds: VISITOR_MAX_AGE_SECONDS });
  } catch (error) {
    // Never print request headers, tokens, SQL parameters or query errors.
    console.warn('[aiove] guest identity audit unavailable', /^[A-Z0-9_]{1,64}$/.test(String(error?.code || '')) ? error.code : 'AUDIT_FAILED');
  }
}

export async function getGuestVisitorContinuity(db = getDbPool(), guestIds = []) {
  const ids = [...new Set(guestIds.filter(Boolean))];
  if (!ids.length) return new Map();
  try {
    const [rows] = await db.execute(`SELECT l.*, v.first_seen_at AS visitor_first_seen_at,
      v.last_seen_at AS visitor_last_seen_at,
      (SELECT COUNT(*) FROM guest_visitor_links siblings JOIN guest_sessions g ON g.id = siblings.guest_session_id
       WHERE siblings.visitor_id = l.visitor_id) AS session_count
      FROM guest_visitor_links l JOIN anonymous_visitors v ON v.id = l.visitor_id
      WHERE l.guest_session_id IN (${ids.map(() => '?').join(',')})`, ids);
    const linked = new Map();
    const visitorIds = [...new Set(rows.map((row) => row.visitor_id))];
    if (visitorIds.length) {
      const [siblings] = await db.execute(`SELECT visitor_id, guest_session_id FROM (
        SELECT l.visitor_id, l.guest_session_id, ROW_NUMBER() OVER (PARTITION BY l.visitor_id ORDER BY l.last_seen_at DESC) AS position
        FROM guest_visitor_links l JOIN guest_sessions g ON g.id = l.guest_session_id
        WHERE l.visitor_id IN (${visitorIds.map(() => '?').join(',')})
      ) ranked WHERE position <= 20`, visitorIds);
      for (const row of siblings) linked.set(row.visitor_id, [...(linked.get(row.visitor_id) || []), row.guest_session_id]);
    }
    return new Map(rows.map((row) => [row.guest_session_id, {
      visitorId: row.visitor_id, linkedGuestIds: linked.get(row.visitor_id) || [], sessionCount: Number(row.session_count),
      firstSeenAt: row.visitor_first_seen_at, lastSeenAt: row.visitor_last_seen_at,
      lastOutcome: row.last_outcome, lastReason: row.last_reason,
      guestCookiePresent: Boolean(row.guest_cookie_present), visitorCookiePresent: Boolean(row.visitor_cookie_present),
    }]));
  } catch {
    return new Map();
  }
}
