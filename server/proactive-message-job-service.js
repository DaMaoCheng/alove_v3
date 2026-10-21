import { assertMemoryJobLease } from "./memory-job-service.js";
import { PROACTIVE_GROUNDING_CONTRACT, classifyProactiveContent, allowsProactiveShopping, resolveProactiveCandidate, loadLatestProactiveUserMessageId, assessProactiveContent, inspectProactiveCandidateQuality, areProactiveTextsNearDuplicate } from "./proactive-content-policy-service.js";
import { generateChatReply } from "./ai-reply-service.js";
import { backfillChatMessageIndexForSession, markExpiredPromptMemories } from "./chat-memory-service.js";
import { createProactiveCharacterMessage, createProactivePromotionCampaignMessages } from "./chat-service.js";
import { buildChatWakeUpContext } from "./chat-wakeup-context-service.js";
import { getDbPool, withTransaction } from "./db.js";
import {
  cancelPromotionCampaignDelivery,
  resolvePromotionCampaignForProactive,
  reservePromotionCampaignDelivery,
} from "./promotion-campaign-match-service.js";
import {
  buildProactivePrompt,
  listRecentMessagesForPrompt,
  loadActiveUserSession,
  loadProactiveCharacter,
  loadRecentProactiveHistory,
} from "./proactive-message-context-service.js";
import {
  cancelProactiveMessageDelivery,
  findProactiveJobDelivery,
  getProactiveJobDeliveryId,
  inspectAccountProactiveDeliveryGate,
  PROACTIVE_DELIVERY_MODES,
  PROACTIVE_DELIVERY_SOURCE_TYPES,
  reserveProactiveMessageDelivery,
} from "./proactive-message-delivery-service.js";
import { inspectProactiveGate } from "./proactive-message-gate-service.js";

export async function sendProactiveMessageFromJob(job = {}, { classifyContent = classifyProactiveContent } = {}) {
  const payload = job.payload || {};
  const userId = normalizeId(job.userId || payload.userId);
  const characterId = normalizeId(job.characterId || payload.characterId);
  const sessionId = normalizeId(job.sessionId || payload.sessionId);
  if (!userId || !characterId || !sessionId) {
    return { ok: true, sent: false, reason: "missing_scope" };
  }

  const db = getDbPool();
  if (job.id) await assertMemoryJobLease(db, job);
  const existingDelivery = await findProactiveJobDelivery(db, { job, userId, characterId, sessionId });
  if (existingDelivery?.delivery_status === "sent") {
    return { ok: true, sent: true, replayed: true, reason: "already_sent",
      messageId: existingDelivery.message_id || "", proactiveDeliveryId: existingDelivery.id };
  }
  const stableDeliveryId = getProactiveJobDeliveryId(job.id);
  job.reportStage?.("proactive_context");
  const session = await loadActiveUserSession(db, { userId, characterId, sessionId });
  if (!session) return { ok: true, sent: false, reason: "session_not_found" };

  const deliveryGate = await inspectAccountProactiveDeliveryGate(db, {
    userId,
    deliveryDate: payload.deliveryDate,
    timeZone: session.time_zone || session.timeZone || "UTC",
    deliveryMode: payload.deliveryMode,
    slotIndex: payload.slotIndex,
  });
  if (!deliveryGate.allowed) {
    return { ok: true, sent: false, reason: deliveryGate.reason, deliveryGate };
  }

  const deliveryMode = deliveryGate.deliveryMode || normalizeDeliveryMode(payload.deliveryMode);
  let gate = {
    allowed: true,
    reason: deliveryMode === PROACTIVE_DELIVERY_MODES.DAILY_REQUIRED ? "daily_required" : "allowed",
  };
  if (deliveryMode !== PROACTIVE_DELIVERY_MODES.DAILY_REQUIRED) {
    gate = await inspectProactiveGate(db, {
      sessionId,
      minIdleMinutes: payload.minIdleMinutes,
      maxUnansweredProactive: payload.maxUnansweredProactive,
      quietHours: payload.quietHours,
      ignoreQuietHours: payload.ignoreQuietHours,
    });
    if (!gate.allowed) {
      return { ok: true, sent: false, reason: gate.reason, gate, deliveryGate };
    }
  }

  const character = await loadProactiveCharacter(db, { characterId, userId });
  if (!character) return { ok: true, sent: false, reason: "character_not_found" };

  await markExpiredPromptMemories(db, { userId, characterId });
  await backfillChatMessageIndexForSession(db, {
    userId,
    characterId,
    sessionId,
    limit: 240,
  });
  const latestUserMessageId = await loadLatestProactiveUserMessageId(db, sessionId);
  const { recentMessages, contextTruncated } = await listRecentMessagesForPrompt(db, sessionId, { includeContextStatus: true });
  const proactiveHistory = await loadRecentProactiveHistory(db, { userId, characterId });
  job.reportStage?.("proactive_content_review");
  const logContext = { userId, sessionId, characterId, requestId: job.id || "" };
  const state = await assessProactiveContent(classifyContent, { recentMessages, contextTruncated, logContext });
  const language = session.preferred_language || (() => { try { const profile = typeof character.profile_json === "string" ? JSON.parse(character.profile_json) : character.profile_json; return profile?.defaultLanguageCode || profile?.languageCode || "en"; } catch { return "en"; } })();

  let proactiveDeliveryId = "";
  let campaignDeliveryId = "";
  try {
    const campaignMatch = allowsProactiveShopping(state) ? await resolvePromotionCampaignForProactive({
      userId,
      characterId,
      sessionId,
      recentMessages,
    }) : { matched: false };
    if (campaignMatch.matched) {
      const reservedCampaign = await reservePromotionCampaignDelivery({
        job: job.id ? job : null,
        campaign: campaignMatch.campaign,
        userId,
        characterId,
        sessionId,
        matchScore: campaignMatch.matchScore,
        matchReason: campaignMatch.matchReason,
        deliveryId: getProactiveJobDeliveryId(job.id, "campaign"),
      });
      if (reservedCampaign.reserved) {
        campaignDeliveryId = reservedCampaign.deliveryId || "";
        const reservedDelivery = await reserveProactiveMessageDelivery({
          deliveryId: stableDeliveryId,
          job: job.id ? job : null,
          userId,
          siteId: session.site_id || session.siteId || null,
          characterId,
          sessionId,
          deliveryDate: deliveryGate.deliveryDate || payload.deliveryDate,
          slotIndex: deliveryGate.slotIndex || payload.slotIndex,
          sourceType: PROACTIVE_DELIVERY_SOURCE_TYPES.PROMOTION_CAMPAIGN,
          sourceRef: "promotion-campaign",
          campaignId: campaignMatch.campaign.id,
        });
        if (!reservedDelivery.reserved) {
          await cancelPromotionCampaignDelivery({ deliveryId: campaignDeliveryId, job: job.id ? job : null });
          campaignDeliveryId = "";
          return {
            ok: true,
            sent: false,
            reason: reservedDelivery.reason || "delivery_slot_unavailable",
            gate,
            deliveryGate,
          };
        }
        proactiveDeliveryId = reservedDelivery.deliveryId || "";

        job.reportStage?.("proactive_campaign_send");
        const createdCampaignMessage = await createProactivePromotionCampaignMessages({
          userId,
          characterId,
          sessionId,
          text: campaignMatch.campaign.messageText,
          speechText: campaignMatch.campaign.messageText,
          campaign: campaignMatch.campaign,
          timeZone: session.time_zone || "UTC",
          proactivePolicy: { ...state, latestUserMessageId, candidateText: String(campaignMatch.campaign.messageText || "").trim() },
          job: job.id ? job : null,
          delivery: { id: proactiveDeliveryId, sourceType: PROACTIVE_DELIVERY_SOURCE_TYPES.PROMOTION_CAMPAIGN,
            sourceRef: "promotion-campaign", campaignId: campaignMatch.campaign.id, campaignDeliveryId },
        });
        if (createdCampaignMessage.sent === false) {
          await cancelPromotionCampaignDelivery({ deliveryId: campaignDeliveryId, job: job.id ? job : null });
          await cancelProactiveMessageDelivery({ deliveryId: proactiveDeliveryId, job: job.id ? job : null });
          return { ok: true, sent: false, reason: createdCampaignMessage.reason, gate, deliveryGate };
        }
        const campaignMessageId = createdCampaignMessage.messageId || createdCampaignMessage.productMessage?.id || createdCampaignMessage.items.at(-1)?.id || "";
        return {
          ok: true,
          sent: true,
          reason: "promotion_campaign_sent",
          messageId: campaignMessageId,
          textMessageId: createdCampaignMessage.textMessage?.id || "",
          productMessageId: createdCampaignMessage.productMessage?.id || "",
          campaignId: campaignMatch.campaign.id,
          deliveryId: campaignDeliveryId,
          proactiveDeliveryId,
          gate,
          deliveryGate,
        };
      }
    }

    const reservedDelivery = await reserveProactiveMessageDelivery({
      deliveryId: stableDeliveryId,
      job: job.id ? job : null,
      userId,
      siteId: session.site_id || session.siteId || null,
      characterId,
      sessionId,
      deliveryDate: deliveryGate.deliveryDate || payload.deliveryDate,
      slotIndex: deliveryGate.slotIndex || payload.slotIndex,
      sourceType: PROACTIVE_DELIVERY_SOURCE_TYPES.PROACTIVE_NUDGE,
      sourceRef: "proactive-nudge",
      campaignId: null,
    });
    if (!reservedDelivery.reserved) {
      return {
        ok: true,
        sent: false,
        reason: reservedDelivery.reason || "delivery_slot_unavailable",
        gate,
        deliveryGate,
      };
    }
    proactiveDeliveryId = reservedDelivery.deliveryId || "";

    job.reportStage?.("proactive_wakeup_context");
    const userContext = await buildChatWakeUpContext(db, {
      userId,
      characterId,
      sessionId,
      queryText: "proactive check-in",
      excludeMessageIds: recentMessages.map((message) => message.id),
    });
    job.reportStage?.("proactive_reply_generation");
    const reviewed = await buildReviewedProactiveCandidate({
      character, recentMessages, contextTruncated, userContext, proactiveHistory, language, state,
      reason: payload.reason || "inactive_followup", classifyContent,
      logContext,
    });
    if (!reviewed.allowed) {
      await cancelProactiveMessageDelivery({ deliveryId: proactiveDeliveryId, job: job.id ? job : null });
      return { ok: true, sent: false, reason: reviewed.reason, gate, deliveryGate };
    }
    const { candidate, reply } = reviewed;
    candidate.policy.latestUserMessageId = latestUserMessageId;
    candidate.policy.latestProactiveMessageId = proactiveHistory[0]?.id || "";
    job.reportStage?.("proactive_send");
    const created = await createProactiveCharacterMessage({
      userId,
      characterId,
      sessionId,
      text: candidate.text,
      speechText: candidate.speechText,
      sourceRef: "proactive-nudge",
      proactivePolicy: candidate.policy,
      job: job.id ? job : null,
      delivery: { id: proactiveDeliveryId, sourceType: PROACTIVE_DELIVERY_SOURCE_TYPES.PROACTIVE_NUDGE,
        sourceRef: "proactive-nudge", campaignId: null },
      timeZone: session.time_zone || "UTC",
    });
    if (created.sent === false) {
      await cancelProactiveMessageDelivery({ deliveryId: proactiveDeliveryId, job: job.id ? job : null });
      return { ok: true, sent: false, reason: created.reason, gate, deliveryGate };
    }

    return {
      ok: true,
      sent: true,
      reason: "sent",
      contentPolicyState: state.state,
      controlledCare: candidate.replaced,
      messageId: created.messageId || created.items[0]?.id || "",
      proactiveDeliveryId,
      sourceType: reply.sourceType,
      sourceRef: reply.sourceRef,
      degraded: Boolean(reply.degraded),
      degradationReason: reply.degradationReason || "",
      gate,
      deliveryGate,
    };
  } catch (error) {
    if (proactiveDeliveryId) {
      await cancelProactiveMessageDelivery({ deliveryId: proactiveDeliveryId, job: job.id ? job : null }).catch(() => {});
    }
    if (campaignDeliveryId) {
      await cancelPromotionCampaignDelivery({ deliveryId: campaignDeliveryId, job: job.id ? job : null }).catch(() => {});
    }
    throw error;
  }
}

// Only the supervisor calls this after proving the previous execution process has exited.
// Keep the lease locked until uncertain message/delivery commit facts have been reconciled.
export async function reconcileInterruptedProactiveJob(job = {}) {
  const userId = normalizeId(job.userId || job.payload?.userId);
  const characterId = normalizeId(job.characterId || job.payload?.characterId);
  const sessionId = normalizeId(job.sessionId || job.payload?.sessionId);
  if (!job.id || !userId || !characterId || !sessionId) throw new Error("Interrupted proactive job is missing scope");
  return withTransaction(async (db) => {
    await assertMemoryJobLease(db, job, { lock: true });
    const id = getProactiveJobDeliveryId(job.id);
    const [[delivery]] = await db.execute(
      `SELECT id, internal_uid, character_id, session_id, delivery_status, message_id
       FROM proactive_message_deliveries WHERE id = ? LIMIT 1 FOR UPDATE`, [id]
    );
    if (delivery && (delivery.internal_uid !== userId || delivery.character_id !== characterId || delivery.session_id !== sessionId)) {
      throw new Error("Interrupted proactive delivery scope mismatch");
    }
    if (delivery?.delivery_status === "sent") return { ok: true, sent: true, messageId: delivery.message_id || "", proactiveDeliveryId: id };
    if (delivery && delivery.delivery_status !== "reserved") throw new Error("Interrupted proactive delivery has an unsupported status");
    await db.execute(
      `DELETE FROM promotion_campaign_deliveries WHERE id = ? AND internal_uid = ?
       AND character_id = ? AND session_id = ? AND delivery_status = 'reserved'`,
      [getProactiveJobDeliveryId(job.id, "campaign"), userId, characterId, sessionId]
    );
    await db.execute(
      `DELETE FROM proactive_message_deliveries WHERE id = ? AND internal_uid = ?
       AND character_id = ? AND session_id = ? AND delivery_status = 'reserved'`, [id, userId, characterId, sessionId]
    );
    return { ok: true, sent: false, reason: "interrupted_before_send", proactiveDeliveryId: id };
  });
}

// At most two generations. Every semantic call stays outside the send transaction.
export async function buildReviewedProactiveCandidate({ character, recentMessages = [], contextTruncated = false,
  userContext, proactiveHistory = [], language = "en", state = {}, reason, classifyContent = classifyProactiveContent,
  generateReply = generateChatReply, logContext = {} } = {}) {
  if (state.state === "unknown") {
    const candidate = resolveProactiveCandidate({ decision: state, recentMessages, language });
    const latestUser = [...recentMessages].reverse().find((message) => (message.senderType || message.sender_type) === "user");
    const latestUserTime = Date.parse(latestUser?.sentAt || "");
    if (proactiveHistory.some((message) => {
      if (!areProactiveTextsNearDuplicate(candidate.text, message.text)) return false;
      const previousTime = Date.parse(message.sentAt || "");
      // New user engagement may restore a check-in. Without chronology, do not
      // claim that the repeated controlled fallback has a new conversational basis.
      return !Number.isFinite(latestUserTime) || !Number.isFinite(previousTime) || latestUserTime <= previousTime;
    })) {
      return { allowed: false, reason: "proactive_duplicate_history" };
    }
    return { allowed: true, candidate, reply: { sourceType: "system", sourceRef: "proactive-care-fallback", degraded: true, degradationReason: "proactive_state_unavailable" } };
  }
  let rewriteReasons = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const promptContext = buildProactivePrompt({ character, recentMessages, userContext, reason,
      shoppingAllowed: allowsProactiveShopping(state), proactiveHistory, language, rewriteReasons });
    promptContext.systemPrompt += `\n\n${PROACTIVE_GROUNDING_CONTRACT}`;
    const reply = await generateReply({ promptContext, userText: "Send one proactive check-in message now.", logContext });
    const decision = await assessProactiveContent(classifyContent, { recentMessages, contextTruncated,
      proactiveHistory, language, candidateText: reply.text, generatorModel: reply.aiModel || "", logContext });
    const quality = inspectProactiveCandidateQuality({ text: reply.text, decision, proactiveHistory });
    const candidate = resolveProactiveCandidate({ text: reply.text, decision: { ...decision, state: state.state }, recentMessages, language });
    if (quality.allowed && !candidate.replaced) return { allowed: true, candidate, reply };
    rewriteReasons = [...quality.reasons, ...(candidate.replaced ? ["proactive_content_unverified"] : [])];
  }
  return { allowed: false, reason: rewriteReasons[0] || "proactive_quality_unverified" };
}

function normalizeId(value) {
  return String(value || "").trim();
}

function normalizeDeliveryMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.values(PROACTIVE_DELIVERY_MODES).includes(normalized) ? normalized : "";
}
