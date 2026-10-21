import { getDbPool, withTransaction } from './db-core.js';

export async function cleanupGuestVisitorHistory({ now = new Date(), limit = 500 } = {}) {
  const time = new Date(now);
  if (!Number.isFinite(time.getTime())) throw new Error('Invalid visitor cleanup date');
  const batch = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 500)));
  const cutoff = new Date(time.getTime() - 90 * 24 * 60 * 60 * 1000);
  const [events] = await getDbPool().execute(
    `DELETE FROM guest_identity_events WHERE created_at < ? ORDER BY created_at LIMIT ${batch}`, [cutoff]);
  // Preserve links to any retained guest (including claimed historical records).
  // Only expired, entirely orphaned visitor groups can be deleted.
  const visitors = await withTransaction(async (db) => {
    const [rows] = await db.execute(`SELECT v.id FROM anonymous_visitors v
      WHERE v.expires_at < ? AND NOT EXISTS (
        SELECT 1 FROM guest_visitor_links l JOIN guest_sessions g ON g.id = l.guest_session_id WHERE l.visitor_id = v.id
      ) ORDER BY v.expires_at LIMIT ${batch} FOR UPDATE`, [time]);
    if (!rows.length) return 0;
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');
    await db.execute(`DELETE FROM guest_visitor_links WHERE visitor_id IN (${placeholders})`, ids);
    const [removed] = await db.execute(`DELETE FROM anonymous_visitors WHERE id IN (${placeholders})`, ids);
    return Number(removed.affectedRows || 0);
  });
  return { deletedGuestIdentityEvents: Number(events.affectedRows || 0), deletedAnonymousVisitors: visitors };
}
