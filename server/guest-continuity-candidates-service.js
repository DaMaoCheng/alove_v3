// Administrator-only evidence. Never used for authentication, quotas or automatic merging.
export async function getGuestContinuityCandidates(db, rows) {
  const result = new Map();
  for (const siteId of new Set(rows.map((row) => row.site_id).filter(Boolean))) {
    const anchors = rows.filter((row) => row.site_id === siteId);
    const timestamps = anchors.map((row) => new Date(row.created_at).getTime()).filter(Number.isFinite);
    if (!timestamps.length) continue;
    const [candidates] = await db.execute(
      `SELECT id, site_id, last_ip, external_source_context_json, created_at
       FROM guest_sessions WHERE site_id = ? AND created_at >= ? AND created_at <= ?
       ORDER BY created_at DESC LIMIT 200`,
      [siteId, new Date(Math.min(...timestamps) - 30 * 60000), new Date(Math.max(...timestamps) + 30 * 60000)]
    );
    const ids = [...new Set([...anchors, ...candidates].map((row) => row.id))];
    // Read one bounded user message per guest, never the role's repeated greeting.
    const [messages] = await db.execute(
      `SELECT g.id, (SELECT CASE WHEN CHAR_LENGTH(m.text_content) <= 1000 THEN m.text_content ELSE NULL END FROM chat_messages m
         WHERE m.guest_session_id = g.id AND m.sender_type = 'user' AND m.content_type = 'text'
         ORDER BY m.sent_at ASC, m.id ASC LIMIT 1) AS text_content
       FROM guest_sessions g WHERE g.id IN (${ids.map(() => '?').join(',')})`, ids
    );
    const texts = new Map(messages.map((row) => [row.id, normalizeText(row.text_content)]));
    for (const row of anchors) {
      const matches = candidates.map((other) => ({ guestId: other.id, evidence: continuityEvidence(row, other, texts) }))
        .filter((item) => item.evidence.length).slice(0, 3);
      result.set(row.id, { candidates: matches, scannedLimit: 200 });
    }
  }
  return result;
}

export function continuityEvidence(left, right, texts = new Map()) {
  if (!left?.id || !right?.id || left.id === right.id || left.site_id !== right.site_id) return [];
  const gap = Math.abs(new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
  if (!Number.isFinite(gap) || gap > 30 * 60000) return [];
  const ipMatch = Boolean(left.last_ip && left.last_ip === right.last_ip);
  const pageLeft = source(left.external_source_context_json);
  const pageRight = source(right.external_source_context_json);
  const pageMatch = Boolean(pageLeft && pageLeft === pageRight);
  const a = texts.get(left.id) || '';
  const b = texts.get(right.id) || '';
  const textMatch = a.length >= 20 && a === b;
  // Repeated popular product pages and short greetings are not identity evidence.
  if (!(ipMatch && (pageMatch || textMatch)) && !(pageMatch && textMatch)) return [];
  return ['创建时间相距不超过30分钟', ...(ipMatch ? ['最近记录IP相同'] : []),
    ...(pageMatch ? ['最近记录来源页面相同'] : []), ...(textMatch ? ['首条用户文字相同（至少20字符）'] : [])];
}
function source(value) {
  try { return (typeof value === 'string' ? JSON.parse(value) : value)?.sourcePageUrl || ''; } catch { return ''; }
}
function normalizeText(value) {
  const text = String(value || '');
  return text.length > 1000 ? '' : text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}
