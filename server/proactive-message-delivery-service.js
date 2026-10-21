import { getDbPool, withTransaction } from "./db.js";
import { assertMemoryJobLease } from "./memory-job-service.js";
import { createId } from "./security.js";
import {
  PROACTIVE_DELIVERY_MODES,
  PROACTIVE_DELIVERY_SOURCE_TYPES,
  PROACTIVE_DELIVERY_STATUSES,
  dedupeCandidates,
  getDeliveryDateForTimeZone,
  getProactiveJobDeliveryId,
  normalizeDeliveryDate,
  normalizeDeliveryMode,
  normalizeId,
  normalizeSlotIndex,
  normalizeSourceType,
  normalizeTimeZone,
  resolveDailyRequiredAvailableAt,
  selectProactiveDeliveryCandidate,
} from "./proactive-delivery-policy.js";

export {
  PROACTIVE_DELIVERY_MODES,
  PROACTIVE_DELIVERY_SOURCE_TYPES,
  PROACTIVE_DELIVERY_STATUSES,
  deterministicNumber,
  getDeliveryDateForTimeZone,
  getProactiveJobDeliveryId,
  getLocalParts,
  normalizeTimeZone,
  resolveDailyRequiredAvailableAt,
  selectProactiveDeliveryCandidate,
  zonedLocalTimeToDate,
} from "./proactive-delivery-policy.js";

export async function findProactiveJobDelivery(db, { job, userId, characterId, sessionId } = {}) {
  const id = getProactiveJobDeliveryId(job?.id);
  if (!id) return null;
  const [rows] = await db.execute(
    `SELECT id, internal_uid, character_id, session_id, delivery_status, message_id,
            source_type, campaign_id FROM proactive_message_deliveries WHERE id = ? LIMIT 1`, [id]
  );
  const row = rows[0] || null;
  if (row && (row.internal_uid !== userId || row.character_id !== characterId || row.session_id !== sessionId)) {
    throw new Error("Proactive job delivery scope mismatch");
  }
  return row;
}

export async function lockProactiveMessageDeliveryForSend(db, {
  delivery, userId, characterId, sessionId,
} = {}) {
  if (!delivery?.id) return null;
  const [rows] = await db.execute(
    `SELECT id, internal_uid, character_id, session_id, delivery_status, message_id,
            source_type, campaign_id FROM proactive_message_deliveries WHERE id = ? LIMIT 1 FOR UPDATE`, [delivery.id]
  );
  const row = rows[0];
  if (!row || row.internal_uid !== userId || row.character_id !== characterId || row.session_id !== sessionId
      || row.source_type !== delivery.sourceType || (row.campaign_id || "") !== (delivery.campaignId || "")) {
    throw new Error("Proactive delivery reservation is missing or changed");
  }
  if (row.delivery_status === "sent") return row;
  if (row.delivery_status !== "reserved") throw new Error("Proactive delivery is not reserved");
  if (delivery.campaignDeliveryId) {
    const [[campaign]] = await db.execute(
      `SELECT campaign_id, internal_uid, character_id, session_id, delivery_status
       FROM promotion_campaign_deliveries WHERE id = ? LIMIT 1 FOR UPDATE`, [delivery.campaignDeliveryId]
    );
    if (!campaign || campaign.campaign_id !== delivery.campaignId || campaign.internal_uid !== userId
        || campaign.character_id !== characterId || campaign.session_id !== sessionId || campaign.delivery_status !== "reserved") {
      throw new Error("Proactive campaign reservation is missing or changed");
    }
  }
  return row;
}

export async function resolveAccountProactiveDeliveryPlan(db, {
  userId,
  siteId = "",
  timeZone = "UTC",
  candidates = [],
  now = new Date(),
} = {}) {
  const normalizedUserId = normalizeId(userId);
  const normalizedCandidates = dedupeCandidates(candidates);
  if (!normalizedUserId || !normalizedCandidates.length) {
    return { allowed: false, reason: "no_candidate" };
  }

  const deliveryDate = getDeliveryDateForTimeZone(now, timeZone);
  const sentToday = await listSentProactiveDeliveriesForDate(db, {
    userId: normalizedUserId,
    deliveryDate,
  });
  const sentCount = sentToday.length;
  if (sentCount >= 2) {
    return {
      allowed: false,
      reason: "daily_quota_reached",
      deliveryDate,
      sentCount,
    };
  }

  const lastSentOverall = sentToday[0] || await getLastSentProactiveDelivery(db, {
    userId: normalizedUserId,
  });
  const historicalCounts = await listCharacterDeliveryCounts(db, {
    userId: normalizedUserId,
    characterIds: normalizedCandidates.map((candidate) => candidate.characterId),
  });

  if (sentCount === 0) {
    const selectedCandidate = selectProactiveDeliveryCandidate({
      userId: normalizedUserId,
      deliveryDate,
      slotIndex: 1,
      candidates: normalizedCandidates,
      lastCharacterId: lastSentOverall?.characterId || "",
      historicalCounts,
    });
    if (!selectedCandidate) {
      return { allowed: false, reason: "no_candidate", deliveryDate };
    }
    return {
      allowed: true,
      deliveryMode: PROACTIVE_DELIVERY_MODES.DAILY_REQUIRED,
      slotIndex: 1,
      deliveryDate,
      siteId: normalizeId(siteId) || null,
      timeZone: normalizeTimeZone(timeZone),
      availableAt: resolveDailyRequiredAvailableAt({
        userId: normalizedUserId,
        deliveryDate,
        timeZone,
      }),
      selectedCandidate,
      sentCount,
      lastDelivery: lastSentOverall || null,
    };
  }

  const lastSentToday = sentToday[0] || null;
  const replyState = await inspectUserReplyAfterDelivery(db, {
    delivery: lastSentToday,
  });
  if (!replyState.replied) {
    return {
      allowed: false,
      reason: replyState.reason || "previous_proactive_unanswered",
      deliveryDate,
      sentCount,
      lastDelivery: lastSentToday,
    };
  }

  const eligibleCharacterIds = normalizedCandidates
    .filter((candidate) => candidate.idleGate?.allowed)
    .map((candidate) => candidate.characterId);
  const selectedCandidate = selectProactiveDeliveryCandidate({
    userId: normalizedUserId,
    deliveryDate,
    slotIndex: 2,
    candidates: normalizedCandidates,
    eligibleCharacterIds,
    lastCharacterId: lastSentToday?.characterId || lastSentOverall?.characterId || "",
    historicalCounts,
  });
  if (!selectedCandidate) {
    return {
      allowed: false,
      reason: eligibleCharacterIds.length ? "rotation_blocked" : "no_idle_candidate",
      deliveryDate,
      sentCount,
      lastDelivery: lastSentToday,
    };
  }

  return {
    allowed: true,
    deliveryMode: PROACTIVE_DELIVERY_MODES.IDLE_FOLLOWUP,
    slotIndex: 2,
    deliveryDate,
    siteId: normalizeId(siteId) || null,
    timeZone: normalizeTimeZone(timeZone),
    availableAt: selectedCandidate.idleGate?.deferTo || now,
    selectedCandidate,
    sentCount,
    lastDelivery: lastSentToday,
    replyState,
  };
}

export async function inspectAccountProactiveDeliveryGate(db, {
  userId,
  deliveryDate = "",
  timeZone = "UTC",
  deliveryMode = "",
  slotIndex = null,
  now = new Date(),
} = {}) {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) {
    return { allowed: false, reason: "missing_user" };
  }

  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const todayDeliveryDate = getDeliveryDateForTimeZone(now, normalizedTimeZone);
  const scopedDeliveryDate = normalizeDeliveryDate(deliveryDate) || todayDeliveryDate;
  if (normalizeDeliveryDate(deliveryDate) && scopedDeliveryDate !== todayDeliveryDate) {
    return {
      allowed: false,
      reason: "delivery_date_mismatch",
      deliveryDate: scopedDeliveryDate,
      currentDeliveryDate: todayDeliveryDate,
    };
  }

  const sentToday = await listSentProactiveDeliveriesForDate(db, {
    userId: normalizedUserId,
    deliveryDate: scopedDeliveryDate,
  });
  const sentCount = sentToday.length;
  if (sentCount >= 2) {
    return {
      allowed: false,
      reason: "daily_quota_reached",
      deliveryDate: scopedDeliveryDate,
      sentCount,
    };
  }

  const resolvedSlotIndex = normalizeSlotIndex(slotIndex) || (sentCount === 0 ? 1 : 2);
  const resolvedMode = normalizeDeliveryMode(deliveryMode)
    || (resolvedSlotIndex === 1 ? PROACTIVE_DELIVERY_MODES.DAILY_REQUIRED : PROACTIVE_DELIVERY_MODES.IDLE_FOLLOWUP);

  if (resolvedSlotIndex === 1) {
    if (sentCount > 0) {
      return {
        allowed: false,
        reason: "first_slot_already_used",
        deliveryDate: scopedDeliveryDate,
        sentCount,
      };
    }
    return {
      allowed: true,
      reason: "allowed",
      deliveryDate: scopedDeliveryDate,
      slotIndex: 1,
      deliveryMode: resolvedMode,
      sentCount,
    };
  }

  if (resolvedSlotIndex !== 2) {
    return {
      allowed: false,
      reason: "invalid_slot_index",
      deliveryDate: scopedDeliveryDate,
      slotIndex: resolvedSlotIndex,
    };
  }

  if (!sentToday[0]) {
    return {
      allowed: false,
      reason: "first_slot_missing",
      deliveryDate: scopedDeliveryDate,
      sentCount,
    };
  }

  const replyState = await inspectUserReplyAfterDelivery(db, {
    delivery: sentToday[0],
  });
  if (!replyState.replied) {
    return {
      allowed: false,
      reason: replyState.reason || "previous_proactive_unanswered",
      deliveryDate: scopedDeliveryDate,
      sentCount,
      lastDelivery: sentToday[0],
    };
  }

  return {
    allowed: true,
    reason: "allowed",
    deliveryDate: scopedDeliveryDate,
    slotIndex: 2,
    deliveryMode: resolvedMode,
    sentCount,
    lastDelivery: sentToday[0],
    replyState,
  };
}

export async function reserveProactiveMessageDelivery(input = {}, executor = getDbPool()) {
  const {
    userId,
    siteId = null,
    characterId = null,
    sessionId = null,
    deliveryDate,
    slotIndex,
    sourceType,
    sourceRef = null,
    campaignId = null,
    deliveryId = "",
  } = input;
  if (input.job?.id) {
    return withTransaction(async (db) => {
      await assertMemoryJobLease(db, input.job, { lock: true });
      return reserveProactiveMessageDelivery({ ...input, job: null }, db);
    });
  }
  const normalizedUserId = normalizeId(userId);
  const normalizedDeliveryDate = normalizeDeliveryDate(deliveryDate);
  const normalizedSlotIndex = normalizeSlotIndex(slotIndex);
  const normalizedSourceType = normalizeSourceType(sourceType);
  if (!normalizedUserId || !normalizedDeliveryDate || !normalizedSlotIndex || !normalizedSourceType) {
    return { reserved: false, reason: "missing_scope" };
  }

  const normalizedDeliveryId = normalizeId(deliveryId) || createId("proactive_delivery");
  try {
    await executor.execute(
      `INSERT INTO proactive_message_deliveries (
         id, internal_uid, site_id, character_id, session_id, message_id,
         delivery_date, delivery_status, source_type, source_ref, campaign_id, slot_index, sent_at
       ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        normalizedDeliveryId,
        normalizedUserId,
        normalizeId(siteId) || null,
        normalizeId(characterId) || null,
        normalizeId(sessionId) || null,
        normalizedDeliveryDate,
        PROACTIVE_DELIVERY_STATUSES.RESERVED,
        normalizedSourceType,
        safeString(sourceRef, 128) || null,
        normalizeId(campaignId) || null,
        normalizedSlotIndex,
      ]
    );
    return { reserved: true, deliveryId: normalizedDeliveryId };
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY" && normalizeId(deliveryId)) {
      const [rows] = await executor.execute(
        `SELECT id, internal_uid, site_id, character_id, session_id, delivery_date,
                slot_index, delivery_status, source_type, campaign_id
         FROM proactive_message_deliveries
         WHERE id = ?
         LIMIT 1`,
        [normalizedDeliveryId]
      );
      const existing = rows[0];
      if (
        existing?.internal_uid === normalizedUserId
        && (existing?.site_id || null) === (normalizeId(siteId) || null)
        && (existing?.character_id || null) === (normalizeId(characterId) || null)
        && (existing?.session_id || null) === (normalizeId(sessionId) || null)
        && existing?.delivery_date === normalizedDeliveryDate
        && Number(existing?.slot_index || 0) === normalizedSlotIndex
        && existing?.source_type === normalizedSourceType
        && (existing?.campaign_id || null) === (normalizeId(campaignId) || null)
        && [PROACTIVE_DELIVERY_STATUSES.RESERVED, PROACTIVE_DELIVERY_STATUSES.SENT].includes(existing?.delivery_status)
      ) {
        return { reserved: true, deliveryId: normalizedDeliveryId, resumed: true };
      }
    }
    if (error?.code === "ER_DUP_ENTRY") return { reserved: false, reason: "slot_already_reserved" };
    throw error;
  }
}

export async function completeProactiveMessageDelivery({
  deliveryId,
  messageId = null,
  sourceType = "",
  sourceRef = "",
  campaignId = "",
} = {}, executor = getDbPool()) {
  const normalizedDeliveryId = normalizeId(deliveryId);
  if (!normalizedDeliveryId) return { ok: true, updated: false };
  const [result] = await executor.execute(
    `UPDATE proactive_message_deliveries
     SET delivery_status = ?,
         message_id = ?,
         source_type = ?,
         source_ref = ?,
         campaign_id = ?,
         sent_at = NOW(3),
         updated_at = NOW(3)
     WHERE id = ? AND delivery_status = 'reserved'
     LIMIT 1`,
    [
      PROACTIVE_DELIVERY_STATUSES.SENT,
      normalizeId(messageId) || null,
      normalizeSourceType(sourceType) || PROACTIVE_DELIVERY_SOURCE_TYPES.PROACTIVE_NUDGE,
      safeString(sourceRef, 128) || null,
      normalizeId(campaignId) || null,
      normalizedDeliveryId,
    ]
  );
  return { ok: true, updated: Number(result.affectedRows || 0) === 1 };
}

export async function cancelProactiveMessageDelivery({ deliveryId, job = null } = {}) {
  const normalizedDeliveryId = normalizeId(deliveryId);
  if (!normalizedDeliveryId) return { ok: true, deleted: false };
  const remove = async (db) => {
    if (job?.id) await assertMemoryJobLease(db, job, { lock: true });
    const [result] = await db.execute(
      `DELETE FROM proactive_message_deliveries
       WHERE id = ?
         AND delivery_status = ?
       LIMIT 1`,
      [normalizedDeliveryId, PROACTIVE_DELIVERY_STATUSES.RESERVED]
    );
    return { ok: true, deleted: Number(result.affectedRows || 0) > 0 };
  };
  return job?.id ? withTransaction(remove) : remove(getDbPool());
}

async function listSentProactiveDeliveriesForDate(db, {
  userId,
  deliveryDate,
} = {}) {
  const [rows] = await db.execute(
    `SELECT
       id,
       internal_uid,
       site_id,
       character_id,
       session_id,
       message_id,
       delivery_date,
       delivery_status,
       source_type,
       source_ref,
       campaign_id,
       slot_index,
       sent_at,
       created_at
     FROM proactive_message_deliveries
     WHERE internal_uid = ?
       AND delivery_date = ?
       AND delivery_status = ?
     ORDER BY slot_index DESC, sent_at DESC, created_at DESC`,
    [
      normalizeId(userId),
      normalizeDeliveryDate(deliveryDate),
      PROACTIVE_DELIVERY_STATUSES.SENT,
    ]
  );
  return rows.map(mapDeliveryRow);
}

async function getLastSentProactiveDelivery(db, { userId } = {}) {
  const [rows] = await db.execute(
    `SELECT
       id,
       internal_uid,
       site_id,
       character_id,
       session_id,
       message_id,
       delivery_date,
       delivery_status,
       source_type,
       source_ref,
       campaign_id,
       slot_index,
       sent_at,
       created_at
     FROM proactive_message_deliveries
     WHERE internal_uid = ?
       AND delivery_status = ?
     ORDER BY sent_at DESC, created_at DESC
     LIMIT 1`,
    [normalizeId(userId), PROACTIVE_DELIVERY_STATUSES.SENT]
  );
  return rows[0] ? mapDeliveryRow(rows[0]) : null;
}

async function listCharacterDeliveryCounts(db, {
  userId,
  characterIds = [],
} = {}) {
  const normalizedCharacterIds = Array.from(new Set(characterIds.map((value) => normalizeId(value)).filter(Boolean)));
  if (!normalizeId(userId) || !normalizedCharacterIds.length) return {};
  const placeholders = normalizedCharacterIds.map(() => "?").join(", ");
  const [rows] = await db.execute(
    `SELECT character_id, COUNT(*) AS delivery_count
     FROM proactive_message_deliveries
     WHERE internal_uid = ?
       AND delivery_status = ?
       AND character_id IN (${placeholders})
     GROUP BY character_id`,
    [normalizeId(userId), PROACTIVE_DELIVERY_STATUSES.SENT, ...normalizedCharacterIds]
  );
  const counts = Object.fromEntries(
    normalizedCharacterIds.map((characterId) => [characterId, 0])
  );
  for (const row of rows) {
    const characterId = normalizeId(row.character_id);
    if (!characterId) continue;
    counts[characterId] = Math.max(0, Number(row.delivery_count || 0));
  }
  return counts;
}

async function inspectUserReplyAfterDelivery(db, { delivery } = {}) {
  if (!delivery?.messageId || !delivery?.sessionId) {
    return { replied: false, reason: "missing_delivery_message" };
  }

  const [messageRows] = await db.execute(
    `SELECT display_order, COALESCE(sent_at, created_at) AS message_at
     FROM chat_messages
     WHERE id = ?
       AND session_id = ?
     LIMIT 1`,
    [delivery.messageId, delivery.sessionId]
  );
  const messageRow = messageRows[0] || null;
  if (!messageRow) {
    return { replied: false, reason: "delivery_message_missing" };
  }

  const [replyRows] = await db.execute(
    `SELECT id
     FROM chat_messages
     WHERE session_id = ?
       AND sender_type = 'user'
       AND delivery_status = 'sent'
       AND (
         display_order > ?
         OR (display_order = ? AND COALESCE(sent_at, created_at) > ?)
       )
     LIMIT 1`,
    [
      delivery.sessionId,
      Number(messageRow.display_order || 0),
      Number(messageRow.display_order || 0),
      messageRow.message_at,
    ]
  );
  return {
    replied: Boolean(replyRows[0]?.id),
    reason: replyRows[0]?.id ? "user_replied" : "previous_proactive_unanswered",
  };
}

function mapDeliveryRow(row = {}) {
  return {
    id: normalizeId(row.id),
    userId: normalizeId(row.internal_uid),
    siteId: normalizeId(row.site_id),
    characterId: normalizeId(row.character_id),
    sessionId: normalizeId(row.session_id),
    messageId: normalizeId(row.message_id),
    deliveryDate: normalizeDeliveryDate(row.delivery_date),
    deliveryStatus: safeString(row.delivery_status, 32),
    sourceType: safeString(row.source_type, 32),
    sourceRef: safeString(row.source_ref, 128),
    campaignId: normalizeId(row.campaign_id),
    slotIndex: normalizeSlotIndex(row.slot_index) || 0,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

function safeString(value, maxLength = 255) {
  return String(value || "").trim().slice(0, Math.max(0, Number(maxLength || 0)));
}
