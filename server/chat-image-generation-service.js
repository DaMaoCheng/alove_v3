import { normalizeCharacterLanguage } from "../shared/language-library.js";
import * as replyLog from "./ai-reply-log-service.js";
import { applyChatImageCommercePolicy } from "./chat-image-commerce-policy-service.js";
import { createId } from "./security.js";
import { getChatImageStatusCopy } from "./chat-image-copy-service.js";
import {
  CHAT_IMAGE_STATUSES,
  hasActiveChatImageGeneration,
  hasChatImageQuota,
  lockChatImageQuota,
} from "./chat-image-quota-service.js";
import {
  CHAT_IMAGE_BLOCK_REASONS,
  analyzeChatImageTrigger,
  isMockChatImageRequest,
} from "./chat-image-trigger-service.js";
import { classifyChatImageIntent, isProductCapableCharacter, normalizeChatImageConditions } from "./chat-image-intent-classifier-service.js";
import { MEMORY_JOB_TYPES, enqueueMemoryJob } from "./memory-job-service.js";
import { getNextMessageOrder, insertMessage, mapMessageRow, buildMessageSelectSql } from "./chat-message-store.js";
import {
  GUEST_IMAGE_ENTITLEMENT_STATUSES,
  lockGuestImageEntitlement,
  reserveGuestImageEntitlement,
} from "./guest-image-entitlement-service.js";
import {
  GUEST_IMAGE_DAILY_QUOTA_STATUSES,
  lockGuestImageDailyQuota,
  reserveGuestImageDailyQuota,
} from "./guest-image-daily-quota-service.js";
import { createMascotLibraryImageMessage } from "./mascot-greeting-image-service.js";
import { resolveRecentImageConversationContext } from "./chat-image-conversation-context-service.js";

export const CHAT_IMAGE_REPLY_REASONS = Object.freeze({
  IMAGE_TASK_CREATED: "image_task_created",
  CLASSIFICATION_UNAVAILABLE: "classification_unavailable",
  ACTIVE_GENERATION: CHAT_IMAGE_BLOCK_REASONS.ACTIVE_GENERATION,
  QUOTA_EXHAUSTED: CHAT_IMAGE_BLOCK_REASONS.QUOTA_EXHAUSTED,
  DISALLOWED_REQUEST: CHAT_IMAGE_BLOCK_REASONS.DISALLOWED_REQUEST,
});

const CLASSIFICATION_UNAVAILABLE_INSTRUCTION = [
  "The current possible character-photo request could not be verified because image-intent classification was unavailable. This is not a semantic rejection or image permission.",
  "No image was created or sent. Do not promise generation, progress or delivery, invent a quota problem, or call the request disallowed. Briefly explain that the photo request could not be processed now and invite trying again later in the active conversation language. Do not blame the user wording or ask for clarification merely because a service timed out.",
  "Preserve answers to any other independent questions in this mixed turn using their own trusted context. Do not replace them with an image acknowledgement or a generic acknowledgement that ignores the unresolved photo request.",
];

// Logging cannot affect image permissions, quota locks or the caller's transaction.
async function recordImageTurn(options, result, failed = false) {
  try { await replyLog.recordImageDecisionLog({ ...options, result, failed }); } catch {}
}
export async function maybeCreateChatImagePlaceholder(db, options = {}) {
  try { return await createMemberImageTurn(db, options); }
  catch (error) { await recordImageTurn(options, null, true); throw error; }
}
export async function maybeCreateGuestChatImagePlaceholder(db, options = {}) {
  try {
    const result = await createGuestImageTurn(db, options);
    await recordImageTurn(options, result);
    return result;
  } catch (error) { await recordImageTurn(options, null, true); throw error; }
}

async function createMemberImageTurn(db, { session, character, userId, userText, userMessage, skipImageGeneration = false, jevDecision = null, conversationContext = null, commerceIntent = null, commerceSiteId = "", imageDecision = null, recentMessages = [] } = {}) {
  if (skipImageGeneration) { await recordImageTurn({ session, character, userId, userMessage, jevDecision, imageDecision, skipImageGeneration }, null); return null; }
  const decision = await evaluateChatImageRequest(db, {
    session,
    character,
    userId,
    userText,
    jevDecision,
    conversationContext,
    commerceIntent,
    commerceSiteId,
    imageDecision,
    recentMessages,
    cacheKey: userMessage?.id || "",
    db,
  });
  const message = decision.action !== "create" ? null : await createChatImagePlaceholder(db, {
    session,
    character,
    userId,
    userText,
    afterDisplayOrder: Number(userMessage?.displayOrder || 0),
    sourceRef: "chat-image-generation",
    trigger: decision.trigger,
  });
  await recordImageTurn({ session, character, userId, userMessage, jevDecision, imageDecision, decision }, message);
  return message;
}

async function createGuestImageTurn(db, {
  guest = {},
  session = {},
  character = {},
  userText = "",
  userMessage = null,
  requestKey = "",
  networkHash = "",
  skipImageGeneration = false,
  jevDecision = null,
  conversationContext = null,
  commerceIntent = null,
  commerceSiteId = "",
  imageDecision = null,
  recentMessages = [],
} = {}) {
  if (skipImageGeneration) return { requested: false, taskCreated: false, reason: "", trigger: null, message: null, directive: null };
  const trigger = await analyzeChatImageTriggerWithIntent(userText, {
    character,
    jevDecision,
    conversationContext,
    commerceIntent,
    commerceSiteId,
    imageDecision,
    recentMessages,
    cacheKey: requestKey || userMessage?.id || "",
    db,
    session,
    userMessage,
  });
  if (!trigger.hasIntent) {
    if (trigger.reason === CHAT_IMAGE_REPLY_REASONS.CLASSIFICATION_UNAVAILABLE) return buildGuestImageResult({ reason: trigger.reason, trigger });
    return { requested: false, taskCreated: false, reason: "", trigger, message: null, directive: null };
  }
  if (!trigger.allowed) {
    return buildGuestImageResult({ reason: trigger.reason || CHAT_IMAGE_BLOCK_REASONS.DISALLOWED_REQUEST, trigger });
  }

  const guestSessionId = String(guest.id || guest.guest_session_id || "").trim();
  // A concrete approved composition cannot be satisfied by an arbitrary
  // gallery image even if the classifier also used the library label.
  const explicitGeneration = Boolean(trigger.explicitGeneration || trigger.conditions?.wants_clothing === true
    || trigger.conditions?.wants_no_clothing === true);
  if (!explicitGeneration && !isMockChatImageRequest(userText)) {
    const libraryMessage = await createMascotLibraryImageMessage(db, { sessionId: session?.id, guestSessionId, character });
    if (libraryMessage) return buildGuestImageResult({ taskCreated: true, trigger, message: libraryMessage });
  }
  const entitlement = await lockGuestImageEntitlement(db, guestSessionId);
  if (!entitlement) return buildGuestImageResult({ reason: CHAT_IMAGE_BLOCK_REASONS.DISALLOWED_REQUEST, trigger });
  const normalizedRequestKey = String(requestKey || "").trim().slice(0, 128);
  if (entitlement.asset_id && entitlement.request_key === normalizedRequestKey) {
    const existingMessage = await getGuestChatImageMessageByAssetId(db, entitlement.asset_id);
    if (existingMessage) return buildGuestImageResult({ taskCreated: true, trigger, message: existingMessage });
  }
  if (entitlement.entitlement_status === GUEST_IMAGE_ENTITLEMENT_STATUSES.CONSUMED) {
    return buildGuestImageResult({ reason: CHAT_IMAGE_BLOCK_REASONS.QUOTA_EXHAUSTED, trigger });
  }
  if (entitlement.entitlement_status === GUEST_IMAGE_ENTITLEMENT_STATUSES.RESERVED) {
    return buildGuestImageResult({ reason: CHAT_IMAGE_BLOCK_REASONS.ACTIVE_GENERATION, trigger });
  }

  const dailyQuota = await lockGuestImageDailyQuota(db, {
    siteId: guest.site_id || session?.site_id || "",
    networkHash,
    guestSessionId,
    requestKey: normalizedRequestKey,
  });
  if (dailyQuota && (dailyQuota.quota_status === GUEST_IMAGE_DAILY_QUOTA_STATUSES.CONSUMED
    || (Number(dailyQuota.remaining || 0) <= 0 && !Number(dailyQuota.pending || 0)))) {
    return buildGuestImageResult({ reason: CHAT_IMAGE_BLOCK_REASONS.QUOTA_EXHAUSTED, trigger });
  }
  if (dailyQuota && dailyQuota.quota_status === GUEST_IMAGE_DAILY_QUOTA_STATUSES.RESERVED && Number(dailyQuota.remaining || 0) <= 0) {
    return buildGuestImageResult({ reason: CHAT_IMAGE_BLOCK_REASONS.ACTIVE_GENERATION, trigger });
  }

  const message = await createChatImagePlaceholder(db, {
    session,
    character,
    userId: "",
    guestSessionId,
    userText,
    afterDisplayOrder: Number(userMessage?.displayOrder || 0),
    sourceType: "guest",
    sourceRef: "guest-chat-image-generation",
    trigger,
  });
  const assetId = String(message?.image?.id || "").trim();
  if (!message?.id || !assetId) throw new Error("Guest chat image placeholder was not created");
  const reserved = await reserveGuestImageEntitlement(db, {
    guestSessionId,
    assetId,
    requestKey: normalizedRequestKey,
  });
  if (!reserved) throw new Error("Guest image entitlement could not be reserved");
  if (dailyQuota) {
    const dailyReserved = await reserveGuestImageDailyQuota(db, {
      siteId: guest.site_id || session?.site_id || "",
      networkHash,
      guestSessionId,
      assetId,
      requestKey: normalizedRequestKey,
    });
    if (!dailyReserved) throw new Error("Guest daily image quota could not be reserved");
  }
  return buildGuestImageResult({ taskCreated: true, trigger, message });
}

export async function evaluateChatImageRequest(db, { session, character = null, userId, userText, jevDecision = null, cacheKey = "", conversationContext = null, userMessage = null, commerceIntent = null, commerceSiteId = "", imageDecision = null, recentMessages = [] } = {}) {
  const normalizedSessionId = String(session?.id || "").trim();
  const normalizedUserId = String(userId || session?.internal_uid || session?.internalUid || "").trim();
  const normalizedCharacterId = String(session?.character_id || session?.characterId || "").trim();
  const trigger = await analyzeChatImageTriggerWithIntent(userText, {
    character,
    jevDecision,
    conversationContext,
    commerceIntent,
    commerceSiteId,
    imageDecision,
    recentMessages,
    cacheKey,
    db,
    session,
    userMessage: userMessage || { displayOrder: 0 },
  });
  if (!trigger.hasIntent) {
    return {
      hasIntent: false,
      action: trigger.reason === CHAT_IMAGE_REPLY_REASONS.CLASSIFICATION_UNAVAILABLE ? "unavailable" : "none",
      reason: trigger.reason || "",
      trigger,
    };
  }
  if (!normalizedSessionId || !normalizedUserId) {
    return {
      hasIntent: true,
      action: "blocked",
      reason: CHAT_IMAGE_BLOCK_REASONS.DISALLOWED_REQUEST,
      trigger,
    };
  }
  if (await hasActiveChatImageGeneration(db, normalizedSessionId)) {
    return {
      hasIntent: true,
      action: "blocked",
      reason: CHAT_IMAGE_BLOCK_REASONS.ACTIVE_GENERATION,
      trigger,
    };
  }
  if (!trigger.allowed) {
    return {
      hasIntent: true,
      action: "blocked",
      reason: trigger.reason || CHAT_IMAGE_BLOCK_REASONS.DISALLOWED_REQUEST,
      trigger,
    };
  }
  // Serialize only admitted signed-in image requests. Ordinary chat and
  // rejected requests must not create or hold a quota-window lock.
  await lockChatImageQuota(db, normalizedUserId);
  if (!await hasChatImageQuota(db, { userId: normalizedUserId, characterId: normalizedCharacterId })) {
    return {
      hasIntent: true,
      action: "blocked",
      reason: CHAT_IMAGE_BLOCK_REASONS.QUOTA_EXHAUSTED,
      trigger,
    };
  }
  return {
    hasIntent: true,
    action: "create",
    reason: "",
    trigger,
  };
}

export async function resolveChatImageReplyDirective(db, { session, character = null, userId, userText, userDisplayOrder = 0, jevDecision = null, cacheKey = "", conversationContext = null, commerceIntent = null, commerceSiteId = "", imageDecision = null, recentMessages = [] } = {}) {
  const decision = await evaluateChatImageRequest(db, {
    session,
    character,
    userId,
    userText,
    jevDecision,
    cacheKey,
    conversationContext,
    commerceIntent,
    commerceSiteId,
    imageDecision,
    recentMessages,
    userMessage: { displayOrder: userDisplayOrder },
  });
  if (decision.action === "unavailable") return buildChatImageReplyDirective(decision);
  if (!decision.hasIntent || decision.action === "none") return null;
  if (await hasImageGenerationAfterUserMessage(db, {
    sessionId: session?.id,
    userDisplayOrder,
  })) {
    return {
      reason: CHAT_IMAGE_REPLY_REASONS.IMAGE_TASK_CREATED,
      taskCreated: true,
      trigger: decision.trigger,
      instruction: [
        "The backend has already created a chat photo task for this user message.",
        "The image request was accepted. Discuss digital image creation, not physically taking a photo, traveling or posing. Acknowledge only the supplied task status.",
        "Do not infer progress or completion merely from task creation. Use the current authoritative image status when provided; otherwise let the image message carry its state.",
      ].join("\n"),
    };
  }
  if (decision.action === "create") return null;
  return buildChatImageReplyDirective(decision);
}

export async function createChatImagePlaceholder(db, {
  session,
  character,
  userId,
  guestSessionId = "",
  userText = "",
  afterDisplayOrder = 0,
  sourceType = "system",
  sourceRef = "chat-image-generation",
  trigger = null,
} = {}) {
  const normalizedSessionId = String(session?.id || "").trim();
  const normalizedUserId = String(userId || session?.internal_uid || session?.internalUid || "").trim();
  const normalizedGuestSessionId = String(guestSessionId || session?.guest_session_id || session?.guestSessionId || "").trim();
  const normalizedCharacterId = String(character?.id || session?.character_id || session?.characterId || "").trim();
  if (!normalizedSessionId || !normalizedCharacterId || (!normalizedUserId && !normalizedGuestSessionId) || (normalizedUserId && normalizedGuestSessionId)) return null;

  const assetId = createId("chat_img");
  const displayOrder = afterDisplayOrder > 0 ? afterDisplayOrder + 1 : await getNextMessageOrder(db, normalizedSessionId);
  const replyLanguage = normalizeCharacterLanguage(session?.replyLanguageCode);
  const statusCopy = getChatImageStatusCopy({
    language: replyLanguage?.code || session?.preferred_language || session?.preferredLanguage || character?.default_language || character?.defaultLanguage || "",
    status: CHAT_IMAGE_STATUSES.QUEUED,
  });
  const message = await insertMessage(db, {
    sessionId: normalizedSessionId,
    guestSessionId: normalizedGuestSessionId,
    characterId: normalizedCharacterId,
    senderType: "character",
    senderLabel: character?.name || "AIOVE Character",
    contentType: "image_generation",
    text: statusCopy,
    displayOrder,
    deliveryStatus: CHAT_IMAGE_STATUSES.QUEUED,
    sourceType,
    sourceRef,
  });
  const provider = isMockChatImageRequest(userText) ? "mock" : "openai";

  await db.execute(
    `INSERT INTO chat_image_assets (
       id, message_id, session_id, internal_uid, guest_session_id, character_id, status, prompt_summary, provider
     ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    [
      assetId,
      message.id,
      normalizedSessionId,
      normalizedUserId || null,
      normalizedGuestSessionId || null,
      normalizedCharacterId,
      "Chat image queued",
      provider,
    ]
  );

  await enqueueMemoryJob({
    userId: normalizedUserId,
    characterId: normalizedCharacterId,
    sessionId: normalizedSessionId,
    jobType: MEMORY_JOB_TYPES.GENERATE_CHAT_IMAGE,
    priority: 35,
    maxRetries: 1,
    payload: {
      assetId,
      ...(replyLanguage ? { replyLanguageCode: replyLanguage.code } : {}),
      messageId: message.id,
      phase: isMockChatImageRequest(userText) ? "mock" : "real",
      triggerReason: trigger?.matchedIntent || "",
      terminalReplyVersion: 1,
      guestSessionId: normalizedGuestSessionId || "",
      imageConditions: trigger?.conditions || null,
      productReferenceRequired: trigger?.productReferenceRequired === true,
      ...(trigger?.productReferenceRequired ? { requiredProductReference: trigger.referenceProduct || null } : {}),
    },
  }, db);

  return getChatImageMessageById(db, message.id);
}

function buildGuestImageResult({ taskCreated = false, reason = "", trigger = null, message = null } = {}) {
  const libraryDelivered = message?.contentType === "mascot_library_image";
  const instructions = taskCreated
    ? [
        libraryDelivered ? "The backend has added the requested character photo as a chat image message using an existing media asset. This establishes current delivery, not a new photoshoot or a user-facing gallery location." : "The backend has already created a chat photo task for this guest message.",
        "The image request was accepted. Discuss digital image creation, not physically taking a photo, traveling or posing. Acknowledge only the supplied task status.",
        "Use the active conversation language. Let the image message carry its status, and answer any other explicit question in this same turn using its trusted product/knowledge context. Do not replace that answer with only a photo acknowledgement.",
      ]
    : reason === CHAT_IMAGE_REPLY_REASONS.CLASSIFICATION_UNAVAILABLE
      ? CLASSIFICATION_UNAVAILABLE_INSTRUCTION
    : reason === 'appearance_uncertain'
      ? ["The current photo request is valid, but it is uncertain whether to depict the user's earlier outfit or a different/plain look.",
          "No image was created or sent. Ask one brief natural clarification of the desired appearance in the active language; do not refuse character photos or claim a quota problem. Preserve independent answers in a mixed request."]
    : reason === CHAT_IMAGE_BLOCK_REASONS.ACTIVE_GENERATION
      ? [
          "The current guest image is still queued or generating.",
          "Do not create or promise another image. Say briefly that the current shot is still being handled.",
        ]
      : reason === CHAT_IMAGE_BLOCK_REASONS.QUOTA_EXHAUSTED
        ? [
            "This guest has already completed the one available guest image.",
            "Do not create or promise another image. Clearly invite the guest to register or sign in to continue with image generation.",
            "Use the current site or conversation language and keep the invitation natural; do not mention internal quota names or implementation details.",
          ]
        : [
            "The image request is outside the existing chat-photo rules.",
            "Apply the same image-content limits used for signed-in chat and do not promise an image task.",
          ];
  return {
    requested: true,
    taskCreated,
    reason: taskCreated ? CHAT_IMAGE_REPLY_REASONS.IMAGE_TASK_CREATED : reason,
    trigger,
    message,
    directive: {
      reason: taskCreated ? CHAT_IMAGE_REPLY_REASONS.IMAGE_TASK_CREATED : reason,
      taskCreated,
      libraryDelivered,
      trigger,
      instruction: instructions.join("\n"),
    },
  };
}

export async function getChatImageMessageById(db, messageId) {
  const [rows] = await db.execute(
    buildMessageSelectSql("m.id = ?"),
    [messageId]
  );
  return rows[0] ? mapMessageRow(rows[0]) : null;
}

async function getGuestChatImageMessageByAssetId(db, assetId = "") {
  const [rows] = await db.execute(
    `SELECT message_id
     FROM chat_image_assets
     WHERE id = ?
       AND guest_session_id IS NOT NULL
     LIMIT 1`,
    [String(assetId || "").trim()]
  );
  return rows[0]?.message_id ? getChatImageMessageById(db, rows[0].message_id) : null;
}

async function hasImageGenerationAfterUserMessage(db, { sessionId, userDisplayOrder = 0 } = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  const safeOrder = Number(userDisplayOrder || 0);
  if (!normalizedSessionId || !safeOrder) return false;
  const [rows] = await db.execute(
    `SELECT id
     FROM chat_messages
     WHERE session_id = ?
       AND content_type = 'image_generation'
       AND display_order > ?
       AND display_order <= ?
     LIMIT 1`,
    [normalizedSessionId, safeOrder, safeOrder + 2]
  );
  return Boolean(rows[0]);
}

function buildChatImageReplyDirective(decision) {
  const reason = decision.reason || CHAT_IMAGE_REPLY_REASONS.DISALLOWED_REQUEST;
  const instructions = {
    [CHAT_IMAGE_REPLY_REASONS.CLASSIFICATION_UNAVAILABLE]: CLASSIFICATION_UNAVAILABLE_INSTRUCTION,
    appearance_uncertain: [
      "The current character-photo request needs clarification of whether to continue the earlier USER outfit or use a different/plain appearance.",
      "Ask one brief natural appearance clarification, without creating or promising an image, claiming a quota block or refusing all character photos. Preserve independent mixed-question answers.",
    ],
    [CHAT_IMAGE_BLOCK_REASONS.ACTIVE_GENERATION]: [
      "The user is asking for another chat photo, but this conversation already has a queued or generating image task.",
      "Do not create or promise another image. Reply naturally in character and say the current shot is still being handled.",
    ],
    [CHAT_IMAGE_BLOCK_REASONS.QUOTA_EXHAUSTED]: [
      "This account's chat-photo limit is 10 successful images shared across all characters in a 72-hour window starting at the first successful image. Pending images reserve capacity.",
      "Do not create or promise another image. Briefly apologize in the conversation language and explain that they must wait for capacity or the current window to reset. Do not ask this signed-in user to register or sign in again.",
    ],
    [CHAT_IMAGE_BLOCK_REASONS.DISALLOWED_REQUEST]: [
      "The user is asking for an image, but this request is outside V1 chat-photo rules.",
      "Do not create or promise product main images, ecommerce packshots, white-background images, ad creatives, background removal, bulk images, or multiple candidates.",
      "Reply naturally in character and redirect toward a role/photo/try-on style request if it fits the context.",
    ],
  };
  return {
    reason,
    trigger: decision.trigger,
    instruction: (instructions[reason] || instructions[CHAT_IMAGE_BLOCK_REASONS.DISALLOWED_REQUEST]).join("\n"),
  };
}

async function analyzeChatImageTriggerWithIntent(userText = "", {
  character = null,
  jevDecision = null,
  conversationContext = null,
  cacheKey = "",
  db = null,
  session = null,
  userMessage = null,
  commerceIntent = null,
  commerceSiteId = "",
  imageDecision = null,
  recentMessages = [],
} = {}) {
  const deterministic = analyzeChatImageTrigger(userText);
  const verifyCharacterTarget = isProductCapableCharacter(character);
  if (deterministic.hasIntent) {
    if ((!deterministic.allowed && !verifyCharacterTarget) || isMockChatImageRequest(userText)) return deterministic;
    const conditions = jevDecision?.ok && jevDecision?.confident
      ? normalizeChatImageConditions(jevDecision.imageConditions)
      : null;
    if (conditions && !verifyCharacterTarget) return { ...deterministic, conditions };
  }

  const resolvedConversationContext = conversationContext || (db
    ? await resolveRecentImageConversationContext(db, {
        sessionId: session?.id,
        beforeDisplayOrder: Number(userMessage?.displayOrder || 0),
      })
    : null);
  const classified = imageDecision || await classifyChatImageIntent(userText, {
    character,
    jevDecision,
    conversationContext: resolvedConversationContext,
    cacheKey,
    forceTargetVerification: verifyCharacterTarget && deterministic.hasIntent,
  });
  if (deterministic.hasIntent && !verifyCharacterTarget) {
    return { ...deterministic, conditions: classified.conditions || null };
  }
  if (!classified.hasIntent) {
    // An unavailable second opinion is not a semantic no-image verdict. The
    // first-pass signal only scopes a no-action notice; it never approves media.
    const possiblePhotoRequest = jevDecision?.ok
      ? ["library_photo", "explicit_generation", "try_on", "group_photo"].includes(jevDecision.imageIntent)
      : deterministic.hasIntent;
    const classificationUnavailable = classified.classificationFailure
      || ["grounding_rejected", "low_confidence"].includes(classified.classificationOutcome);
    return { ...deterministic, hasIntent: false, allowed: false,
      reason: classificationUnavailable && possiblePhotoRequest ? CHAT_IMAGE_REPLY_REASONS.CLASSIFICATION_UNAVAILABLE : "",
      matchedIntent: "", intentType: "", explicitGeneration: false, detectionSource: classified.detectionSource || "classifier", confidence: classified.confidence, classificationFailure: classified.classificationFailure, classificationOutcome: classified.classificationOutcome, classificationIntent: classified.classificationIntent };
  }

  // Confirm a real image request before applying the existing unsupported-task
  // gate. Semantic approval never overrides its batch/advertising restrictions.
  if (deterministic.hasIntent && !deterministic.allowed) return { ...classified, allowed: false,
    reason: deterministic.reason, matchedBlocker: deterministic.matchedBlocker };

  return applyChatImageCommercePolicy({
    ...classified,
    hasIntent: true,
    allowed: classified.allowed,
    reason: classified.allowed ? "" : classified.appearanceClarificationRequired === true
      ? 'appearance_uncertain' : CHAT_IMAGE_BLOCK_REASONS.DISALLOWED_REQUEST,
    matchedIntent: `ai_intent:${classified.intentType || "chat_photo"}`,
    matchedBlocker: classified.allowed ? "" : "ai_intent_disallowed",
    intentType: classified.intentType || "library_photo",
    explicitGeneration: Boolean(classified.explicitGeneration || ["explicit_generation", "try_on"].includes(classified.intentType)),
    conditions: classified.conditions || null,
    detectionSource: classified.detectionSource || "classifier",
  }, { commerceIntent, recentMessages, userText, characterName: character?.name || character?.display_name || "", characterId: character?.id || "", siteId: commerceSiteId || commerceIntent?.productCandidateState?.siteId || "" });
}
