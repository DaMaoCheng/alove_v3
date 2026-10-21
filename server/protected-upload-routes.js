import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { requireAuth } from "./auth-service.js";
import { getDbPool } from "./db.js";
import { readAuthToken, readCookie, sendJson } from "./http-utils.js";
import { securityHeaders } from "./security-response-utils.js";
import { CHAT_ATTACHMENT_UPLOAD_POLICY, CHAT_IMAGE_UPLOAD_POLICY, CHAT_VOICE_UPLOAD_POLICY } from "./upload-policies.js";
import {
  extractFileName,
  protectedAiVoiceUrl,
  protectedChatAttachmentUrl,
  protectedChatImageUrl,
  protectedUserVoiceUrl,
  publicAiVoiceUrl,
  publicChatAttachmentUrl,
  publicChatImageUrl,
  publicUserVoiceUrl,
} from "./protected-upload-url-service.js";
import { getOptionalRequestUser } from "./request-user-service.js";
import { GUEST_COOKIE_NAME, requireGuest } from "./guest-chat-service.js";

const PRIVATE_FILE_TYPES = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".rtf": "application/rtf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
});

export async function handleProtectedUploadRoute(req, res, { path }) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  const chatMatch = path.match(/^\/api\/uploads\/chat\/([^/]+)$/);
  if (chatMatch) {
    const fileName = normalizeRequestedFileName(chatMatch[1]);
    const authToken = readAuthToken(req);
    if (authToken) {
      const user = await requireAuth(req, readAuthToken);
      await requireChatAttachmentAccess(user, fileName);
    } else {
      await requireGuestChatAttachmentAccess(readCookie(req, GUEST_COOKIE_NAME), fileName);
    }
    await sendPrivateFile(req, res, resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, fileName));
    return true;
  }

  const chatImageMatch = path.match(/^\/api\/uploads\/chat-images\/([^/]+)$/);
  if (chatImageMatch) {
    const fileName = normalizeRequestedFileName(chatImageMatch[1]);
    const user = await getOptionalRequestUser(req);
    if (user) {
      await requireChatImageAccess(user, fileName);
    } else {
      await requireGuestChatImageAccess(readCookie(req, GUEST_COOKIE_NAME), fileName);
    }
    await sendPrivateFile(req, res, resolve(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, fileName));
    return true;
  }

  const aiVoiceMatch = path.match(/^\/api\/uploads\/voice\/ai\/([^/]+)$/);
  if (aiVoiceMatch) {
    const fileName = normalizeRequestedFileName(aiVoiceMatch[1]);
    const authToken = readAuthToken(req);
    if (authToken) {
      const user = await requireAuth(req, readAuthToken);
      await requireVoiceAccess(user.id, {
        fileName,
        publicUrl: publicAiVoiceUrl(fileName),
        protectedUrl: protectedAiVoiceUrl(fileName),
      });
    } else {
      await requireGuestVoiceAccess(readCookie(req, GUEST_COOKIE_NAME), {
        fileName,
        publicUrl: publicAiVoiceUrl(fileName),
        protectedUrl: protectedAiVoiceUrl(fileName),
      });
    }
    await sendPrivateFile(req, res, resolve(CHAT_VOICE_UPLOAD_POLICY.uploadDir, "ai", fileName));
    return true;
  }

  const userVoiceMatch = path.match(/^\/api\/uploads\/voice\/([^/]+)$/);
  if (userVoiceMatch) {
    const user = await requireAuth(req, readAuthToken);
    const fileName = normalizeRequestedFileName(userVoiceMatch[1]);
    await requireVoiceAccess(user.id, {
      fileName,
      publicUrl: publicUserVoiceUrl(fileName),
      protectedUrl: protectedUserVoiceUrl(fileName),
    });
    await sendPrivateFile(req, res, resolve(CHAT_VOICE_UPLOAD_POLICY.uploadDir, fileName));
    return true;
  }

  return false;
}

export async function requireGuestChatAttachmentAccess(token, fileName) {
  const guest = await requireGuest(token);
  const [rows] = await getDbPool().execute(
    `SELECT m.id
     FROM chat_messages m
     JOIN chat_sessions s ON s.id = m.session_id AND s.guest_session_id = m.guest_session_id
     WHERE m.guest_session_id = ?
       AND m.content_type = 'attachment'
       AND (
         JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.storedName')) = ?
         OR JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.url')) IN (?, ?)
       )
     LIMIT 1`,
    [guest.id, fileName, publicChatAttachmentUrl(fileName), protectedChatAttachmentUrl(fileName)]
  );
  if (rows[0]) return;
  throwForbidden();
}

export async function requireChatAttachmentAccess(user, fileName) {
  const userId = user?.id || "";
  const ownerWhere = isAdminUser(user) ? "1 = 1" : "s.internal_uid = ?";
  const params = isAdminUser(user)
    ? [fileName, publicChatAttachmentUrl(fileName), protectedChatAttachmentUrl(fileName)]
    : [userId, fileName, publicChatAttachmentUrl(fileName), protectedChatAttachmentUrl(fileName)];
  const [rows] = await getDbPool().execute(
    `SELECT m.id
     FROM chat_messages m
     JOIN chat_sessions s ON s.id = m.session_id
     WHERE ${ownerWhere}
       AND m.content_type = 'attachment'
       AND (
         JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.storedName')) = ?
         OR JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.url')) IN (?, ?)
       )
     LIMIT 1`,
    params
  );
  if (rows[0]) return;
  throwForbidden();
}

export async function requireChatImageAccess(user, fileName) {
  const userId = user?.id || "";
  const ownerWhere = isAdminUser(user) ? "1 = 1" : "s.internal_uid = ?";
  const params = isAdminUser(user)
    ? [fileName, publicChatImageUrl(fileName), protectedChatImageUrl(fileName)]
    : [userId, fileName, publicChatImageUrl(fileName), protectedChatImageUrl(fileName)];
  const [rows] = await getDbPool().execute(
    `SELECT a.id
     FROM chat_image_assets a
     JOIN chat_sessions s ON s.id = a.session_id
     WHERE ${ownerWhere}
       AND a.status = 'ready'
       AND (
         a.storage_path = ?
         OR a.protected_path IN (?, ?)
       )
     LIMIT 1`,
    params
  );
  if (rows[0]) return;
  throwForbidden();
}

export async function requireGuestChatImageAccess(token, fileName) {
  const guest = await requireGuest(token);
  const [rows] = await getDbPool().execute(
    `SELECT a.id
     FROM chat_image_assets a
     JOIN chat_sessions s ON s.id = a.session_id AND s.guest_session_id = a.guest_session_id
     WHERE a.guest_session_id = ?
       AND a.status = 'ready'
       AND (
         a.storage_path = ?
         OR a.protected_path IN (?, ?)
       )
     LIMIT 1`,
    [guest.id, fileName, publicChatImageUrl(fileName), protectedChatImageUrl(fileName)]
  );
  if (rows[0]) return;
  throwForbidden();
}

function isAdminUser(user) {
  return String(user?.account_type || "").trim().toLowerCase() === "admin";
}

async function requireVoiceAccess(userId, { fileName, publicUrl, protectedUrl }) {
  const [rows] = await getDbPool().execute(
    `SELECT v.id
     FROM character_voice_assets v
     JOIN chat_messages m ON m.voice_asset_id = v.id
     JOIN chat_sessions s ON s.id = m.session_id
     WHERE s.internal_uid = ?
       AND (
         v.audio_url IN (?, ?)
         OR v.id = ?
       )
     LIMIT 1`,
    [userId, publicUrl, protectedUrl, fileName]
  );
  if (rows[0]) return;
  throwForbidden();
}

export async function requireGuestVoiceAccess(token, { fileName, publicUrl, protectedUrl }) {
  const guest = await requireGuest(token);
  const [rows] = await getDbPool().execute(
    `SELECT v.id
     FROM character_voice_assets v
     JOIN chat_messages m ON m.voice_asset_id = v.id
     JOIN chat_sessions s ON s.id = m.session_id AND s.guest_session_id = m.guest_session_id
     WHERE m.guest_session_id = ?
       AND v.asset_status = 'ready'
       AND (
         v.audio_url IN (?, ?)
         OR v.id = ?
       )
     LIMIT 1`,
    [guest.id, publicUrl, protectedUrl, fileName]
  );
  if (rows[0]) return;
  throwForbidden();
}

async function sendPrivateFile(req, res, filePath) {
  const content = await readPrivateFile(filePath);
  const contentType = PRIVATE_FILE_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    ...securityHeaders(),
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(content);
}

async function readPrivateFile(filePath) {
  if (!isWithinPrivateUploadRoot(filePath)) {
    throwForbidden();
  }
  try {
    return await readFile(filePath);
  } catch {
    const error = new Error("文件不存在");
    error.statusCode = 404;
    throw error;
  }
}

function isWithinPrivateUploadRoot(filePath) {
  const normalizedPath = resolve(filePath);
  const roots = [
    resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir),
    resolve(CHAT_IMAGE_UPLOAD_POLICY.uploadDir),
    resolve(CHAT_VOICE_UPLOAD_POLICY.uploadDir),
  ];
  return roots.some((root) => normalizedPath === root || normalizedPath.startsWith(`${root}${sep}`));
}

function normalizeRequestedFileName(value = "") {
  const fileName = extractFileName(value);
  if (!fileName || fileName !== String(value || "").trim().replace(/[/\\]/g, "")) {
    throwForbidden();
  }
  return fileName;
}

function throwForbidden() {
  const error = new Error("无权访问该文件");
  error.statusCode = 403;
  throw error;
}
