import { getChatImageStatusCopy, getChatImageUnverifiedStatusCopy, getChatImageHistoricalReadyCopy } from "./chat-image-copy-service.js";

const STATES = new Set(["queued", "generating", "ready", "failed"]);
const text = (value) => String(value || "").trim();

// Actual media bubbles carry the file. Keep invented model-control tokens out
// of display and speech, while preserving user quotations and normal recovery.
export function cleanCurrentImageReplyMarkup(reply = {}, context = null, userText = '') {
  if (context?.imageStatus?.currentTurn !== true || !context?._imageStatusAnchor?.messageId
    || !context?._imageStatusAnchor?.scope?.sessionId || /\{\s*(?:image|photo)\s*:/i.test(userText)) return reply;
  const cleaned = { ...reply };
  for (const field of ['text', 'displayText', 'speechText']) {
    if (typeof reply[field] !== 'string') continue;
    const value = reply[field].replace(/\{\s*(?:image|photo)\s*:[^{}\r\n]{1,200}\}/gi, '').trim();
    if (value) cleaned[field] = value;
  }
  return cleaned;
}

function scopeFor({ session, character, userDisplayOrder, currentImageMessageId = "" }) {
  const characterId = text(character?.id || character?.character_id || session?.character_id);
  const ownerId = text(session?.internal_uid);
  const guestId = text(session?.guest_session_id);
  const order = Number(userDisplayOrder);
  if (!text(session?.id) || !characterId || (!ownerId && !guestId) || !Number.isFinite(order) || order <= 0) return null;
  if (session?.character_id && text(session.character_id) !== characterId) return null;
  return { sessionId: text(session.id), characterId, ownerId: ownerId || null, guestId: guestId || null, order, currentImageMessageId: text(currentImageMessageId) };
}

// Ownership and the user-turn cutoff are rechecked on both reads. No locks, jobs,
// quota changes, or generation permission decisions belong in this reader.
async function readImage(db, scope, anchor = null) {
  const [rows] = await db.execute(`SELECT m.id, m.content_type, m.display_order,
      a.id AS asset_id, a.status AS image_status
    FROM (SELECT m.* FROM chat_messages m
      JOIN chat_sessions s ON s.id = m.session_id
      WHERE s.id = ? AND s.internal_uid <=> ? AND s.guest_session_id <=> ?
        AND m.character_id = ? AND s.character_id = m.character_id
        AND (m.display_order <= ? OR m.id = ?)
        AND NOT EXISTS (SELECT 1 FROM chat_messages next_user
          WHERE next_user.session_id = m.session_id AND next_user.sender_type = 'user'
            AND next_user.display_order > ? AND next_user.display_order <= m.display_order)
      ORDER BY m.display_order DESC LIMIT 20) m
    LEFT JOIN chat_image_assets a ON a.message_id = m.id AND a.session_id = m.session_id
      AND a.character_id = m.character_id AND a.internal_uid <=> ? AND a.guest_session_id <=> ?
    WHERE m.content_type IN ('image_generation', 'mascot_library_image')
      ${anchor ? "AND m.id = ? AND (a.id <=> ?)" : scope.currentImageMessageId ? "AND m.id = ?" : ""}
    ORDER BY m.display_order DESC LIMIT 1`, [scope.sessionId, scope.ownerId, scope.guestId, scope.characterId,
    scope.order + 2, scope.currentImageMessageId, scope.order, scope.ownerId, scope.guestId,
    ...(anchor ? [anchor.messageId, anchor.assetId] : scope.currentImageMessageId ? [scope.currentImageMessageId] : [])]);
  return rows?.[0] || null;
}

function attach(context, row, anchor) {
  const kind = row?.content_type === "mascot_library_image" ? "library" : anchor.kind;
  const status = row ? kind === "library" ? "ready" : STATES.has(row.image_status) ? row.image_status : "unknown" : "unknown";
  return { ...(context || {}), imageStatus: { kind, status, currentTurn: Number(row?.display_order || anchor.displayOrder) > anchor.scope.order }, _imageStatusAnchor: anchor };
}

function unresolvedDirective(directive) {
  if (!directive?.taskCreated && directive?.reason !== "active_generation") return directive;
  return { ...directive, imageStatus: { kind: directive.libraryDelivered ? "library" : "generated", status: "unknown", currentTurn: Boolean(directive.taskCreated) } };
}

export async function resolveChatImageStatusContext(db, options = {}) {
  const directive = options.directive || null;
  const scope = scopeFor(options);
  if (!scope) return directive;
  try {
    const row = await readImage(db, scope);
    if (!row || scope.currentImageMessageId && row.id !== scope.currentImageMessageId
      || directive?.taskCreated && Number(row.display_order) <= scope.order) return unresolvedDirective(directive);
    return attach(directive, row, { scope, messageId: row.id, assetId: row.asset_id || null,
      displayOrder: Number(row.display_order), kind: row.content_type === "mascot_library_image" ? "library" : "generated" });
  } catch {
    // Unlike an empty successful read, an outage cannot confirm even whether a
    // recent task exists. Keep this uncertainty available to the shared review.
    const unresolved = unresolvedDirective(directive);
    return { ...(unresolved || {}), imageStatus: unresolved?.imageStatus || { kind: "unknown", status: "unknown", currentTurn: false } };
  }
}

export async function refreshChatImageStatusContext(freshDb, context) {
  const anchor = context?._imageStatusAnchor;
  if (!anchor) return context;
  try { return attach(context, await readImage(freshDb, anchor.scope, anchor), anchor); }
  catch { return attach(context, null, anchor); }
}

export function toImageStatusReviewContext(context) {
  const reason = ["active_generation", "quota_exhausted", "disallowed_request", "classification_unavailable"].includes(context?.reason) ? context.reason : "";
  const fact = context?.imageStatus || (reason ? { kind: "unknown", status: "unknown", currentTurn: false } : null);
  if (!fact || !["generated", "library", "unknown"].includes(fact.kind)) return null;
  return { kind: fact.kind, status: fact.kind !== "unknown" && STATES.has(fact.status) ? fact.status : "unknown", currentTurn: fact.currentTurn === true,
    ...(isScopedTerminalCaption(context) ? { terminalReplyOnly: true } : {}),
    ...(reason && context?.taskCreated !== true ? { currentRequest: { outcome: "not_created", reason } } : {}) };
}

// Image provenance describes digital media, not a UI location or a physical act.
export function buildImageRepresentationContract(fact) {
  if (!fact || !["library", "generated"].includes(fact.kind)) return "";
  return [
    "Image source metadata describes digital media, not a user-interface location or evidence of a physical action. Source library means a pre-existing media asset; source generated means a digital image request, with completion determined ONLY by its supplied status.",
    "A requested scene is intended image content, not evidence that the character traveled there, physically posed or operated a camera. A user-requested scene may be discussed only as a desired scene or creative intention; it is not evidence of what any delivered image depicts. Never turn that wish into an assertion that this photo is in that setting, including when a ready library image was supplied instead. Actual world/store/order facts still need their own evidence.",
    "Media origin does not establish a gallery, profile, album, menu, page position or navigation instruction. Browser loading, user visibility, visual details and physical photoshoots are unverified.",
    fact.terminalReplyOnly === true
      ? "This proposed text is ONLY the delayed terminal photo caption, using plain conversational text without stage/emotion annotations or SSML. Require a brief natural in-character continuation grounded in the earlier conversation, or a natural apology if failed. A bare generic completion/error status label is incomplete: imageStatusSupported=false and allowed=false. Do not repeat the original mixed business answer, ask an unrelated clarification, invent depicted details, or initiate another action. This caption purpose does not grant image-generation or other tool permissions."
      : "",
    ["queued", "generating"].includes(fact.status)
      ? [fact.currentTurn === true ? "The server accepted and created the current digital image task; queued/generating confirms that request is pending, not merely an unexecuted user instruction. Acknowledging task acceptance is supported; queued does not prove rendering has begun." : "This pending status belongs to an earlier image task. It does not prove the current request was accepted or a new task was started; identify it as the earlier task.", "A pending task can be acknowledged naturally using the user's creative idea, but no finished result, completion time, invented rendering progress or physical photo-taking is established. Pending photo acknowledgement does not replace answers to other questions in mixed turns."].join("\n")
      : "",
  ].filter(Boolean).join("\n");
}

// Public, server-read facts shared by generation and review; no action permission
// or model-specific instructions belong in this contract.
export function buildCurrentImageDeliveryContract(fact) {
  if (!fact || fact.currentTurn !== true || fact.status !== "ready"
    || !["library", "generated"].includes(fact.kind) || fact.currentRequest?.outcome === "not_created") return "";
  return [
    "The server has already added this specific requested character photo as a ready chat image message in this turn. This is a verified current delivery, not a request still awaiting execution.",
    "Ordinary present-tense sharing or sending language referring to THIS delivered photo can acknowledge the same current delivery; it does not by itself promise another image, future contact, off-platform contact or merchandise browsing. A personal character photo is not merchandise. Warm continuation of this same conversation is not a sales or contact invitation by itself.",
    "Only this photo's delivery is verified. Browser loading, the user having seen it, image contents, poses, clothing and where the user can browse it are unverified. Media source metadata cannot establish a gallery, profile, album, menu, page position or navigation instruction. Unsupported claims about those details remain unsupported.",
    "Other requested actions, merchandise recommendations, discounts, contact collection, off-platform or future follow-up and store/order facts retain all their existing permissions and evidence requirements.",
    fact.terminalReplyOnly === true
      ? "The original reply already handled the mixed business questions. Evaluate only this delayed image caption; do not require it to answer those questions again. Any new business or action claim in the caption still requires its own evidence and permissions."
      : "In mixed turns, each other question still needs its own supported answer; a photo acknowledgement does not replace that answer.",
  ].join("\n");
}

export function buildChatImageStatusInstruction(context) {
  const fact = toImageStatusReviewContext(context);
  if (!fact) return "";
  return [
    `Authoritative image fact: ${JSON.stringify(fact)}.`,
    fact.kind === "unknown" ? "The status read failed; this does not confirm that any image task exists."
      : "This evidence identifies only the latest image message within the bounded conversation window. Apply its state only when the current user reference clearly matches that message. If the user means an older image or the reference is ambiguous, its status is unknown; never transfer this latest state to another request.",
    buildImageRepresentationContract(fact),
    buildCurrentImageDeliveryContract(fact),
    "queued/generating means pending at the latest check; ready means the server finished, not that the user saw it; failed means no successful image; unknown means unverified. Do not invent progress, completion, retry, delivery visibility, or timing.",
    "currentTurn=false describes an earlier image, not delivery of another image. A currentRequest outcome of not_created records that no image was added this turn; never replace this outcome with the earlier image's ready state. For old-image questions, explicitly identify the prior image and do not claim browser visibility.",
    fact.terminalReplyOnly === true
      ? "This is only the delayed image caption; the original mixed business answer is retained. It grants no permission for a new image task."
      : "Use this fact only if relevant to the user's current message. For ordinary unrelated chat, do not mention image status. Answer other questions in mixed turns normally. It grants no permission for a new image task.",
    "The latest authoritative status overrides earlier conversational claims and any older image-task instruction.",
  ].join("\n");
}

export function getChatImageStatusFallbackCopy(context, language = "en") {
  const fact = toImageStatusReviewContext(context);
  if (context?.taskCreated && !fact?.currentTurn) return getChatImageUnverifiedStatusCopy(language);
  if (["quota_exhausted", "disallowed_request", "classification_unavailable"].includes(fact?.currentRequest?.reason)
    || fact?.currentRequest?.reason === "active_generation" && !["queued", "generating"].includes(fact?.status)) return getChatImageUnverifiedStatusCopy(language);
  if (fact?.status === "ready") return fact.currentTurn ? getChatImageStatusCopy({ language, status: "ready" }) : getChatImageHistoricalReadyCopy(language);
  if (["queued", "generating"].includes(fact?.status)) return getChatImageStatusCopy({ language, status: "queued" });
  return getChatImageUnverifiedStatusCopy(language, fact?.status === "failed");
}

// Private server provenance, separate from classifier decisions and public
// message payloads. The commerce-failure fast path uses natural=false too.
export function withChatImageReplySnapshot(reply, context, { natural = false } = {}) {
  const anchor = context?._imageStatusAnchor;
  if (context?.imageStatus?.kind !== "generated" || context.imageStatus.currentTurn !== true
      || !anchor?.assetId || !anchor.messageId || !anchor.scope?.sessionId || !(Number(anchor.scope.order) > 0)) return reply;
  return { ...reply, _imageDeliveryReply: { assetId: anchor.assetId, messageId: anchor.messageId,
    status: context.imageStatus.status, userDisplayOrder: Number(anchor.scope.order),
    requestScope: context.trigger?.requestScope || "", natural: natural === true } };
}

// Only omission of a redundant clarification is allowed; this grants no action.
export function isFulfilledImageOnlyRequest(context) {
  return context?.taskCreated === true && context?.reason === "image_task_created"
    && context?.imageStatus?.currentTurn === true && context.imageStatus.status === "ready"
    && ["library", "generated"].includes(context.imageStatus.kind)
    && (context?.trigger?.hasIntent === true && context.trigger.allowed === true
      && context.trigger.classificationOutcome === "accepted" && context.trigger.requestScope === "image_only"
      // Terminal caption execution supplies a scoped owned generated-media
      // anchor, not a classifier decision. This permits only reply wording;
      // neither this helper nor the flag grants generation/action permission.
      || isScopedTerminalCaption(context));
}

function isScopedTerminalCaption(context) {
  const anchor = context?._imageStatusAnchor, scope = anchor?.scope;
  return context?.terminalReplyOnly === true && context?.imageStatus?.kind === "generated"
    && context.imageStatus.currentTurn === true && ["ready", "failed"].includes(context.imageStatus.status)
    && anchor?.kind === "generated" && Boolean(anchor.assetId) && Boolean(anchor.messageId)
    && Boolean(scope?.sessionId) && Boolean(scope.characterId)
    && Boolean(scope.ownerId) !== Boolean(scope.guestId) && scope.currentImageMessageId === anchor.messageId;
}
