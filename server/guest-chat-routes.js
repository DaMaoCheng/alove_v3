import { recordGuestIdentity } from './guest-visitor-service.js';
import { getOrCreateGuestSession, getGuestConversation, GUEST_COOKIE_NAME, GUEST_SESSION_MAX_AGE_SECONDS, requireGuest, requireGuestCharacter, sendGuestMessage, sendGuestReplyForMessage } from "./guest-chat-service.js";
import { readCookie, readJson, readRequestBuffer, sendJson, setCookie } from "./http-utils.js";
import { getDbPool } from "./db.js";
import { assertPublicAppOrigin } from "./request-origin-service.js";
import { buildGuestNetworkHash } from "./guest-network-rate-limit-service.js";
import { getOptionalRequestUser } from "./request-user-service.js";
import { createPublicError } from "./public-error-utils.js";
import { CHAT_ATTACHMENT_UPLOAD_POLICY, CHAT_VOICE_UPLOAD_POLICY } from "./upload-policies.js";
import { validateUploadForPolicy } from "./upload-security.js";
import { decodeUploadFilename } from "./route-utils.js";
import { transcribeChatVoice } from "./elevenlabs-stt-service.js";
import { completeGuestChatAttachmentUpload, deleteGuestPendingAttachment, reserveGuestChatAttachmentUpload } from "./guest-chat-attachment-service.js";
import { completeGuestVoiceTranscription, failGuestVoiceTranscription, markGuestVoiceRequestConsumed, reserveGuestVoiceRequest } from "./guest-voice-request-service.js";
import { assertGuestWavDuration } from "./wav-audio-duration-service.js";
import { resolveRequestAccess } from "./access-location-service.js";

const GUEST_VOICE_ALLOWED_TYPES = Object.freeze({
  "audio/wav": CHAT_VOICE_UPLOAD_POLICY.allowedTypes["audio/wav"],
  "audio/x-wav": CHAT_VOICE_UPLOAD_POLICY.allowedTypes["audio/x-wav"],
});
const GUEST_VOICE_MAX_BYTES = CHAT_VOICE_UPLOAD_POLICY.maxDurationSeconds * 32_000 + 44;

export async function handleGuestChatRoute(req, res, { path, requestUrl }) {
  if (req.method === "GET" && path === "/api/guest/capability") {
    const slug = String(requestUrl.searchParams.get("siteSlug") || "").trim().toLowerCase();
    const [rows] = await getDbPool().execute(
      `SELECT s.id AS site_id, s.slug AS site_slug, s.guest_chat_enabled,
              c.id AS mascot_character_id, c.name AS mascot_name, c.avatar_url AS mascot_avatar_url
       FROM sites s
       LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
       LEFT JOIN ai_characters c ON c.id = COALESCE(ms.character_id, s.mascot_character_id)
         AND c.category_id = 'mascot' AND c.character_status = 'published'
       WHERE s.slug = ? AND s.site_status = 'active' LIMIT 1`,
      [slug]
    );
    const site = rows[0] || null;
    sendJson(res, 200, {
      ok: true,
      enabled: Boolean(site?.guest_chat_enabled && site?.mascot_character_id),
      siteSlug: site?.site_slug || slug,
      mascotCharacterId: site?.mascot_character_id || "",
      mascotName: site?.mascot_name || "",
      mascotAvatarUrl: site?.mascot_avatar_url || "",
      capabilities: {
        aiVoiceReplies: true,
        voiceInput: true,
        attachments: true,
        realtimeCall: true,
      },
    });
    return true;
  }
  if (req.method === "GET" && path === "/api/guest/session") {
    await assertGuestRequest(req);
    assertPublicAppOrigin(req);
    const token = readCookie(req, GUEST_COOKIE_NAME);
    try {
      const result = await getOrCreateGuestSession({
        token,
        siteSlug: requestUrl.searchParams.get("siteSlug"),
        handoff: requestUrl.searchParams.get("handoff"),
        networkHash: buildGuestNetworkHash(req),
        access: resolveRequestAccess(req),
      });
      await recordGuestIdentity(req, res, result);
      if (result.created) setCookie(res, GUEST_COOKIE_NAME, result.token, { maxAgeSeconds: GUEST_SESSION_MAX_AGE_SECONDS });
      sendJson(res, 200, await getGuestConversation(result.token, {
        characterId: requestUrl.searchParams.get("characterId"),
        networkHash: buildGuestNetworkHash(req),
      }));
    } catch (error) {
      if (token && Number(error?.statusCode || 0) === 401) {
        await recordGuestIdentity(req, res, { invalid: true, siteSlug: requestUrl.searchParams.get("siteSlug") });
        setCookie(res, GUEST_COOKIE_NAME, "", { maxAgeSeconds: 0 });
      }
      throw error;
    }
    return true;
  }
  if (req.method === "POST" && path === "/api/guest/messages") {
    await assertGuestRequest(req);
    assertPublicAppOrigin(req);
    const body = await readJson(req);
    sendJson(res, 200, await sendGuestMessage({ token: readCookie(req, GUEST_COOKIE_NAME), characterId: body.characterId, text: body.text, attachments: body.attachments, clientMessageId: body.clientMessageId, networkHash: buildGuestNetworkHash(req), access: resolveRequestAccess(req) }));
    return true;
  }
  if (req.method === "POST" && path === "/api/guest/uploads/chat") {
    await assertGuestRequest(req);
    assertPublicAppOrigin(req);
    const token = readCookie(req, GUEST_COOKIE_NAME);
    const guest = await requireGuestCharacter(token, req.headers["x-guest-character-id"]);
    const clientUploadId = String(req.headers["x-client-upload-id"] || "").trim().slice(0, 128);
    const contentLength = Number(req.headers["content-length"] || CHAT_ATTACHMENT_UPLOAD_POLICY.maxBytes);
    const normalizedContentType = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
    const uploadType = CHAT_ATTACHMENT_UPLOAD_POLICY.allowedTypes[normalizedContentType] || null;
    if (!uploadType?.extension) throw createPublicError("Attachment file type is unsupported.", 400);
    if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > CHAT_ATTACHMENT_UPLOAD_POLICY.maxBytes) {
      throw createPublicError("Attachment cannot exceed 20MB.", 413);
    }
    const reservation = await reserveGuestChatAttachmentUpload({
      guest,
      clientUploadId,
      networkHash: buildGuestNetworkHash(req),
      reservedBytes: contentLength,
      storageExtension: uploadType.extension,
    });
    if (reservation.reused) {
      sendJson(res, 200, { ok: true, attachment: reservation.attachment });
      return true;
    }
    const attachment = await completeGuestChatAttachmentUpload({
      guest,
      reservationId: reservation.id,
      attemptToken: reservation.attemptToken,
      buffer: await readRequestBuffer(req, CHAT_ATTACHMENT_UPLOAD_POLICY.maxBytes),
      contentType: req.headers["content-type"],
      filename: decodeUploadFilename(req.headers["x-upload-filename"]),
      originalName: decodeUploadFilename(req.headers["x-original-filename"]),
      originalSha256: req.headers["x-original-file-sha256"],
    });
    sendJson(res, 200, { ok: true, attachment });
    return true;
  }
  const guestAttachmentDeleteMatch = path.match(/^\/api\/guest\/uploads\/chat\/([^/]+)$/);
  if (req.method === "DELETE" && guestAttachmentDeleteMatch) {
    await assertGuestRequest(req);
    assertPublicAppOrigin(req);
    const guest = await requireGuestCharacter(
      readCookie(req, GUEST_COOKIE_NAME),
      requestUrl.searchParams.get("characterId")
    );
    sendJson(res, 200, await deleteGuestPendingAttachment({
      guest,
      attachmentId: decodeURIComponent(guestAttachmentDeleteMatch[1]),
    }));
    return true;
  }
  if (req.method === "POST" && path === "/api/guest/voices") {
    await assertGuestRequest(req);
    assertPublicAppOrigin(req);
    const token = readCookie(req, GUEST_COOKIE_NAME);
    const guest = await requireGuestCharacter(token, req.headers["x-guest-character-id"]);
    const clientMessageId = String(req.headers["x-client-message-id"] || "").trim().slice(0, 128);
    if (!clientMessageId) throw createPublicError("Voice message id is required.", 400);
    const voiceContentLength = Number(req.headers["content-length"] || GUEST_VOICE_MAX_BYTES);
    if (!Number.isFinite(voiceContentLength) || voiceContentLength <= 0 || voiceContentLength > GUEST_VOICE_MAX_BYTES) {
      throw createPublicError("Voice messages cannot exceed 120 seconds.", 413);
    }
    const reservation = await reserveGuestVoiceRequest({ guest, requestKey: clientMessageId, networkHash: buildGuestNetworkHash(req) });
    let transcriptText = reservation.transcriptText;
    if (reservation.shouldTranscribe) {
      try {
        const voiceBuffer = await readRequestBuffer(req, GUEST_VOICE_MAX_BYTES);
        const uploadFilename = decodeUploadFilename(req.headers["x-upload-filename"]);
        const voiceUpload = validateUploadForPolicy({
          buffer: voiceBuffer,
          contentType: req.headers["content-type"],
          uploadFilename,
          allowedTypes: GUEST_VOICE_ALLOWED_TYPES,
          maxBytes: GUEST_VOICE_MAX_BYTES,
          emptyMessage: "Voice file is empty.",
          tooLargeMessage: "Voice messages cannot exceed 10MB.",
          unsupportedMessage: "Guest voice input must be WAV audio.",
        });
        assertGuestWavDuration(voiceBuffer, CHAT_VOICE_UPLOAD_POLICY.maxDurationSeconds);
        const transcript = await transcribeChatVoice({
          buffer: voiceBuffer,
          filename: voiceUpload.safeUploadName,
          mimeType: voiceUpload.allowed?.mimeType || voiceUpload.mimeType,
        });
        transcriptText = await completeGuestVoiceTranscription({ requestId: reservation.id, attemptToken: reservation.attemptToken, transcriptText: transcript.text });
      } catch (error) {
        await failGuestVoiceTranscription({ requestId: reservation.id, attemptToken: reservation.attemptToken, error });
        throw error;
      }
    }
    const result = await sendGuestMessage({
      token,
      characterId: req.headers["x-guest-character-id"],
      text: transcriptText,
      clientMessageId,
      networkHash: buildGuestNetworkHash(req),
      access: resolveRequestAccess(req),
      deferReply: true,
      sourceRef: "voice-asr",
      networkQuotaReserved: true,
      reservedVoiceRequestKey: clientMessageId,
    });
    await markGuestVoiceRequestConsumed({ guestSessionId: guest.id, characterId: guest.mascot_character_id, requestKey: clientMessageId });
    sendJson(res, 200, result);
    return true;
  }
  const guestVoiceReplyMatch = path.match(/^\/api\/guest\/voices\/([^/]+)\/reply$/);
  if (req.method === "POST" && guestVoiceReplyMatch) {
    await assertGuestRequest(req);
    assertPublicAppOrigin(req);
    sendJson(res, 200, await sendGuestReplyForMessage({
      token: readCookie(req, GUEST_COOKIE_NAME),
      characterId: requestUrl.searchParams.get("characterId"),
      messageId: decodeURIComponent(guestVoiceReplyMatch[1]),
      networkHash: buildGuestNetworkHash(req),
    }));
    return true;
  }
  return false;
}

async function assertGuestRequest(req) {
  if (await getOptionalRequestUser(req)) {
    throw createPublicError("Please use your signed-in chat.", 403);
  }
}
