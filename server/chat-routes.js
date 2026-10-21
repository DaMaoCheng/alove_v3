import { requireAuth } from "./auth-service.js";
import { listQuickRepliesForCharacter } from "./chat-quick-reply-service.js";
import { transcribeChatVoice } from "./elevenlabs-stt-service.js";
import { saveChatAttachmentUpload } from "./chat-upload-service.js";
import { createUserAttachmentMessage, createUserMessage, createUserReply, createUserVoiceMessage, createUserVoiceReply, getMessagesForCharacter, listUserChatContacts } from "./chat-service.js";
import { readAuthToken, readJson, readRequestBuffer, sendJson } from "./http-utils.js";
import { decodeUploadFilename } from "./route-utils.js";
import { CHAT_ATTACHMENT_UPLOAD_POLICY, CHAT_VOICE_UPLOAD_POLICY } from "./upload-policies.js";
import { validateUploadForPolicy } from "./upload-security.js";

export async function handleChatRoute(req, res, { path, requestUrl }) {
  if (req.method === "GET" && path === "/api/chat/contacts") {
    const user = await requireAuth(req, readAuthToken);
    sendJson(res, 200, await listUserChatContacts(user.id, {
      siteSlug: requestUrl.searchParams.get("siteSlug"),
      accountType: user.account_type,
    }));
    return true;
  }

  const messagesMatch = path.match(/^\/api\/characters\/([^/]+)\/messages$/);
  if (req.method === "GET" && messagesMatch) {
    const user = await requireAuth(req, readAuthToken);
    sendJson(res, 200, await getMessagesForCharacter({
      characterId: decodeURIComponent(messagesMatch[1]),
      userId: user.id,
    }));
    return true;
  }

  const quickRepliesMatch = path.match(/^\/api\/characters\/([^/]+)\/quick-replies$/);
  if (req.method === "GET" && quickRepliesMatch) {
    await requireAuth(req, readAuthToken);
    sendJson(res, 200, {
      quickReplies: await listQuickRepliesForCharacter(decodeURIComponent(quickRepliesMatch[1])),
    });
    return true;
  }

  if (req.method === "POST" && messagesMatch) {
    const user = await requireAuth(req, readAuthToken);
    const body = await readJson(req);
    sendJson(res, 200, await createUserMessage({
      characterId: decodeURIComponent(messagesMatch[1]),
      userId: user.id,
      text: body.text,
      attachments: body.attachments,
    }));
    return true;
  }

  const replyMatch = path.match(/^\/api\/characters\/([^/]+)\/messages\/reply$/);
  if (req.method === "POST" && replyMatch) {
    const user = await requireAuth(req, readAuthToken);
    const body = await readJson(req);
    sendJson(res, 200, await createUserReply({
      characterId: decodeURIComponent(replyMatch[1]),
      userId: user.id,
      sinceMessageId: body.sinceMessageId,
      productTrigger: body.productTrigger,
      siteSlug: user.site_slug || body.siteSlug || "",
    }));
    return true;
  }

  const attachmentsMatch = path.match(/^\/api\/characters\/([^/]+)\/attachments$/);
  if (req.method === "POST" && attachmentsMatch) {
    const user = await requireAuth(req, readAuthToken);
    const attachment = await saveChatAttachmentUpload({
      userId: user.id,
      buffer: await readRequestBuffer(req, CHAT_ATTACHMENT_UPLOAD_POLICY.maxBytes),
      contentType: req.headers["content-type"],
      filename: decodeUploadFilename(req.headers["x-upload-filename"]),
      originalName: decodeUploadFilename(req.headers["x-original-filename"]),
      originalSha256: req.headers["x-original-file-sha256"],
    });
    sendJson(res, 200, await createUserAttachmentMessage({
      characterId: decodeURIComponent(attachmentsMatch[1]),
      userId: user.id,
      attachment,
    }));
    return true;
  }

  if (req.method === "POST" && path === "/api/uploads/chat") {
    const user = await requireAuth(req, readAuthToken);
    const attachment = await saveChatAttachmentUpload({
      userId: user.id,
      buffer: await readRequestBuffer(req, CHAT_ATTACHMENT_UPLOAD_POLICY.maxBytes),
      contentType: req.headers["content-type"],
      filename: decodeUploadFilename(req.headers["x-upload-filename"]),
      originalName: decodeUploadFilename(req.headers["x-original-filename"]),
      originalSha256: req.headers["x-original-file-sha256"],
    });
    sendJson(res, 200, {
      ok: true,
      attachment,
    });
    return true;
  }

  const voicesMatch = path.match(/^\/api\/characters\/([^/]+)\/voices$/);
  if (req.method === "POST" && voicesMatch) {
    const user = await requireAuth(req, readAuthToken);
    const voiceBuffer = await readRequestBuffer(req, CHAT_VOICE_UPLOAD_POLICY.maxBytes);
    const uploadFilename = decodeUploadFilename(req.headers["x-upload-filename"]);
    const voiceUpload = validateUploadForPolicy({
      buffer: voiceBuffer,
      contentType: req.headers["content-type"],
      uploadFilename,
      allowedTypes: CHAT_VOICE_UPLOAD_POLICY.allowedTypes,
      maxBytes: CHAT_VOICE_UPLOAD_POLICY.maxBytes,
      emptyMessage: "语音文件不能为空",
      tooLargeMessage: "语音不能超过 10MB",
      unsupportedMessage: "仅支持上传常见音频格式",
    });
    const transcript = await transcribeChatVoice({
      buffer: voiceBuffer,
      filename: voiceUpload.safeUploadName,
      mimeType: voiceUpload.allowed?.mimeType || voiceUpload.mimeType,
    });
    sendJson(res, 200, await createUserVoiceMessage({
      characterId: decodeURIComponent(voicesMatch[1]),
      userId: user.id,
      transcriptText: transcript.text,
      asr: transcript,
    }));
    return true;
  }

  const voiceReplyMatch = path.match(/^\/api\/characters\/([^/]+)\/voices\/([^/]+)\/reply$/);
  if (req.method === "POST" && voiceReplyMatch) {
    const user = await requireAuth(req, readAuthToken);
    sendJson(res, 200, await createUserVoiceReply({
      characterId: decodeURIComponent(voiceReplyMatch[1]),
      userId: user.id,
      messageId: decodeURIComponent(voiceReplyMatch[2]),
    }));
    return true;
  }
  return false;
}
