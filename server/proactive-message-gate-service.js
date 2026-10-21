const DEFAULT_MIN_IDLE_MINUTES = 240;
const DEFAULT_MAX_UNANSWERED_PROACTIVE = 1;
const DEFAULT_QUIET_HOURS = "1-8";

export async function inspectProactiveGate(db, {
  sessionId,
  minIdleMinutes,
  maxUnansweredProactive,
  quietHours,
  ignoreQuietHours,
} = {}) {
  const rows = await listLatestSessionMessages(db, sessionId, 30);
  if (!rows.length) return { allowed: false, reason: "no_messages" };

  const normalizedQuietHours = normalizeQuietHours(quietHours || DEFAULT_QUIET_HOURS);
  if (!ignoreQuietHours && isQuietHour(new Date(), normalizedQuietHours)) {
    return { allowed: false, reason: "quiet_hours", quietHours: normalizedQuietHours };
  }

  const latest = rows[0];
  const idleMinutes = minutesSince(latest.sent_at || latest.created_at);
  const requiredIdleMinutes = Math.max(0, Number(minIdleMinutes ?? DEFAULT_MIN_IDLE_MINUTES));
  if (idleMinutes < requiredIdleMinutes) {
    return {
      allowed: false,
      reason: "idle_too_short",
      idleMinutes,
      requiredIdleMinutes,
    };
  }

  const unansweredProactiveCount = countUnansweredProactiveMessages(rows);
  const maxAllowed = Math.max(0, Number(maxUnansweredProactive ?? DEFAULT_MAX_UNANSWERED_PROACTIVE));
  if (unansweredProactiveCount >= maxAllowed) {
    return {
      allowed: false,
      reason: "unanswered_proactive_limit",
      unansweredProactiveCount,
      maxUnansweredProactive: maxAllowed,
    };
  }

  return {
    allowed: true,
    reason: "allowed",
    idleMinutes,
    requiredIdleMinutes,
    unansweredProactiveCount,
    maxUnansweredProactive: maxAllowed,
  };
}

async function listLatestSessionMessages(db, sessionId, limit) {
  const [rows] = await db.execute(
    `SELECT id, sender_type, source_ref, sent_at, created_at
     FROM chat_messages
     WHERE session_id = ?
       AND delivery_status = 'sent'
     ORDER BY display_order DESC, sent_at DESC
     LIMIT ${Math.max(1, Math.min(100, Number(limit || 30)))}`,
    [sessionId]
  );
  return rows;
}

function countUnansweredProactiveMessages(rows = []) {
  let count = 0;
  for (const row of rows) {
    if (String(row.sender_type || "") === "user") break;
    if (String(row.source_ref || "") === "proactive-nudge") count += 1;
  }
  return count;
}

function isQuietHour(date, quietHours) {
  const hour = date.getHours();
  const { start, end } = quietHours;
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function normalizeQuietHours(value) {
  const match = String(value || "").match(/(\d{1,2})\s*-\s*(\d{1,2})/);
  if (!match) return normalizeQuietHours(DEFAULT_QUIET_HOURS);
  return {
    start: clampHour(match[1]),
    end: clampHour(match[2]),
  };
}

function clampHour(value) {
  return Math.max(0, Math.min(23, Number(value || 0)));
}

function minutesSince(value) {
  const time = new Date(value || 0).getTime();
  if (!Number.isFinite(time) || time <= 0) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 60000));
}
