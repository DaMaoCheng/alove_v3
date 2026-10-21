import { createId } from "./security.js";
import { generateElevenLabsSpeech, resolveElevenLabsTtsConfig } from "./elevenlabs-tts-service.js";
import { getElevenLabsVoicePreset } from "../shared/voice-presets.js";
import { extractFileName, toProtectedVoiceUrl } from "./protected-upload-url-service.js";
import { getDbPool } from "./db.js";
import { readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { CHAT_VOICE_UPLOAD_POLICY } from "./upload-policies.js";

export async function createAiReplyVoiceAssetForDb(db, {
  messageId = "",
  characterId = "",
  userId = "",
  speechText = "",
  voiceMeta = {},
  generateAudio = null,
} = {}) {
  const normalizedVoiceMeta = normalizeVoiceMeta(voiceMeta);
  const basePayload = buildAiVoiceBasePayload({
    id: createId("voice"), messageId, characterId, userId, speechText, voiceMeta: normalizedVoiceMeta,
  });

  try {
    const audio = await runAudioGeneration({
      generateAudio,
      speechText: basePayload.speechText,
      voiceMeta: normalizedVoiceMeta,
    });
    const readyPayload = {
      ...basePayload,
      assetStatus: audio.status || "ready",
      audioUrl: safeString(audio.audioUrl),
      audioBytes: Math.max(0, Number(audio.audioBytes || 0)),
      durationSeconds: Math.max(0, Math.round(Number(audio.durationSeconds || 0))),
      outputFormat: safeString(audio.outputFormat),
      providerRequestId: safeString(audio.providerRequestId),
      providerErrorRaw: "",
      retryCount: 0,
      errorMessage: "",
    };
    await insertAiVoiceAsset(db, readyPayload);
    return exposeAiVoiceAssetToClient(readyPayload);
  } catch (error) {
    const failedPayload = {
      ...basePayload,
      assetStatus: "failed",
      audioUrl: "",
      audioBytes: 0,
      durationSeconds: 0,
      outputFormat: "",
      providerRequestId: "",
      providerErrorRaw: normalizeProviderErrorRaw(error),
      retryCount: 0,
      errorMessage: safeString(error?.message).slice(0, 500),
    };
    await insertAiVoiceAsset(db, failedPayload);
    return failedPayload;
  }
}

export async function reserveAiReplyVoiceAssetForDb(db, {
  messageId = "",
  characterId = "",
  userId = "",
  speechText = "",
  voiceMeta = {},
  deterministic = false,
} = {}) {
  const normalizedMessageId = safeString(messageId);
  if (!normalizedMessageId) throw new Error("Voice message id is required");
  const [existingRows] = await db.execute(
    "SELECT * FROM character_voice_assets WHERE message_id = ? AND asset_type = 'ai_reply' ORDER BY created_at ASC LIMIT 1",
    [normalizedMessageId]
  );
  if (existingRows[0]) return mapAiReplyVoiceAssetRow(existingRows[0]);

  const normalizedVoiceMeta = normalizeVoiceMeta(voiceMeta);
  const payload = {
    ...buildAiVoiceBasePayload({
      id: deterministic ? `voice_${normalizedMessageId}`.slice(0, 64) : createId("voice"),
      messageId: normalizedMessageId,
      characterId,
      userId,
      speechText,
      voiceMeta: normalizedVoiceMeta,
    }),
    assetStatus: "pending",
    audioUrl: "",
    audioBytes: 0,
    durationSeconds: 0,
    outputFormat: "",
    providerRequestId: "",
    providerErrorRaw: "",
    retryCount: 0,
    errorMessage: "",
  };
  try {
    await insertAiVoiceAsset(db, payload);
  } catch (error) {
    if (error?.code !== "ER_DUP_ENTRY") throw error;
    const [racedRows] = await db.execute("SELECT * FROM character_voice_assets WHERE id = ? LIMIT 1", [payload.id]);
    if (!racedRows[0]) throw error;
    return mapAiReplyVoiceAssetRow(racedRows[0]);
  }
  return exposeAiVoiceAssetToClient(payload);
}

export async function generateReservedAiReplyVoiceAsset({ assetId = "", generateAudio = null, maxAttempts = 2, beforeReadyCommit = null } = {}) {
  const normalizedAssetId = safeString(assetId);
  if (!normalizedAssetId) return null;
  const [[currentRow]] = await getDbPool().execute("SELECT * FROM character_voice_assets WHERE id = ? LIMIT 1", [normalizedAssetId]);
  if (!currentRow) return null;
  const current = mapAiReplyVoiceAssetRow(currentRow);
  if (current.assetStatus === "ready" && current.audioUrl) return current;
  if (current.assetStatus === "finalizing" && isStaleVoiceAttempt(current.lastAttemptAt)) {
    return recoverFinalizingAiVoiceAsset(current);
  }
  if (current.retryCount >= Math.max(1, Number(maxAttempts || 2))) return current;

  const attemptToken = createId("voice_attempt");
  const [claimed] = await getDbPool().execute(
    `UPDATE character_voice_assets
     SET asset_status = 'generating', attempt_token = ?, retry_count = retry_count + 1, last_attempt_at = NOW(3), updated_at = NOW(3)
     WHERE id = ?
       AND (
         asset_status IN ('pending', 'failed')
         OR (asset_status = 'generating' AND last_attempt_at < DATE_SUB(NOW(3), INTERVAL 30 SECOND))
       )
       AND retry_count < ?`,
    [attemptToken, normalizedAssetId, Math.max(1, Number(maxAttempts || 2))]
  );
  if (Number(claimed.affectedRows || 0) !== 1) {
    const [[latestRow]] = await getDbPool().execute("SELECT * FROM character_voice_assets WHERE id = ? LIMIT 1", [normalizedAssetId]);
    return latestRow ? mapAiReplyVoiceAssetRow(latestRow) : null;
  }

  const [[reservedRow]] = await getDbPool().execute("SELECT * FROM character_voice_assets WHERE id = ? LIMIT 1", [normalizedAssetId]);
  if (!reservedRow) return null;
  const reserved = mapAiReplyVoiceAssetRow(reservedRow);
  await deleteHistoricalAiVoiceTemporaryFiles(normalizedAssetId);
  const voiceMeta = {
    provider: reserved.provider,
    model: reserved.model,
    voiceId: reserved.voiceId,
    languageCode: reserved.languageCode,
    languageLabel: reserved.languageLabel,
  };

  let audio = null;
  let failureStatus = "generating";
  try {
    audio = await runAudioGeneration({
      generateAudio,
      speechText: reserved.transcript,
      voiceMeta,
      outputFileName: `${normalizedAssetId}.mp3`,
      temporaryFileSuffix: attemptToken,
      deferFinalize: true,
    });
    const [finalizing] = await getDbPool().execute(
      `UPDATE character_voice_assets
       SET asset_status = 'finalizing', updated_at = NOW(3)
       WHERE id = ? AND asset_status = 'generating' AND attempt_token = ?`,
      [normalizedAssetId, attemptToken]
    );
    if (Number(finalizing.affectedRows || 0) !== 1) {
      await removeTemporaryVoiceOutput(audio);
      const [[latestRow]] = await getDbPool().execute("SELECT * FROM character_voice_assets WHERE id = ? LIMIT 1", [normalizedAssetId]);
      return latestRow ? mapAiReplyVoiceAssetRow(latestRow) : null;
    }
    failureStatus = "finalizing";
    if (audio.temporaryPath && audio.outputPath) await rename(audio.temporaryPath, audio.outputPath);
    if (typeof beforeReadyCommit === "function") await beforeReadyCommit({ assetId: normalizedAssetId, attemptToken, audio });
    const payload = {
      ...reserved,
      assetStatus: audio.status || "ready",
      audioUrl: safeString(audio.audioUrl),
      audioBytes: Math.max(0, Number(audio.audioBytes || 0)),
      durationSeconds: Math.max(0, Math.round(Number(audio.durationSeconds || 0))),
      outputFormat: safeString(audio.outputFormat),
      providerRequestId: safeString(audio.providerRequestId),
      providerErrorRaw: "",
      errorMessage: "",
    };
    const updated = await updateAiVoiceAsset(getDbPool(), payload, { expectedStatus: "finalizing", attemptToken });
    if (!updated) {
      return reconcileLostAiVoiceFinalize({ assetId: normalizedAssetId, audioUrl: payload.audioUrl, attemptToken });
    }
    await deleteHistoricalAiVoiceTemporaryFiles(normalizedAssetId);
    return exposeAiVoiceAssetToClient(payload);
  } catch (error) {
    const payload = {
      ...reserved,
      assetStatus: "failed",
      audioUrl: "",
      audioBytes: 0,
      durationSeconds: 0,
      outputFormat: "",
      providerRequestId: "",
      providerErrorRaw: normalizeProviderErrorRaw(error),
      errorMessage: safeString(error?.message).slice(0, 500),
    };
    await removeTemporaryVoiceOutput(audio);
    const updated = await updateAiVoiceAsset(getDbPool(), payload, { expectedStatus: failureStatus, attemptToken });
    if (!updated) return getAiVoiceAssetById(normalizedAssetId);
    return payload;
  }
}

export async function deleteStoredAiVoiceAsset({ assetId = "", audioUrl = "", attemptToken = "" } = {}) {
  const fileNames = new Set();
  const audioFileName = extractFileName(audioUrl);
  if (audioFileName) fileNames.add(audioFileName);
  const normalizedAssetId = safeString(assetId);
  if (normalizedAssetId) fileNames.add(`${normalizedAssetId}.mp3`);
  if (!fileNames.size) return false;
  const config = resolveElevenLabsTtsConfig();
  let deleted = false;
  for (const fileName of fileNames) {
    const outputPath = join(config.outputDir, fileName);
    deleted = await removeExistingFile(outputPath) || deleted;
    const normalizedAttemptToken = safeString(attemptToken);
    if (normalizedAttemptToken) deleted = await removeExistingFile(`${outputPath}.${normalizedAttemptToken}.tmp`) || deleted;
  }
  if (normalizedAssetId) deleted = await deleteHistoricalAiVoiceTemporaryFiles(normalizedAssetId) || deleted;
  return deleted;
}

export async function deleteStoredChatVoiceAsset({ assetId = "", assetType = "", audioUrl = "", attemptToken = "" } = {}) {
  if (String(assetType || "").trim().toLowerCase() !== "user_message") {
    return deleteStoredAiVoiceAsset({ assetId, audioUrl, attemptToken });
  }

  const rawUrl = String(audioUrl || "").trim().split(/[?#]/, 1)[0];
  const match = rawUrl.match(/^\/(?:api\/)?uploads\/voice\/([^/]+)$/);
  if (!match) return false;
  const fileName = extractFileName(rawUrl);
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,179}\.(?:webm|ogg|m4a|mp3|wav)$/i.test(fileName)) return false;
  return removeExistingFile(join(CHAT_VOICE_UPLOAD_POLICY.uploadDir, fileName));
}

export async function retryAiReplyVoiceAssetForDb(db, {
  messageId = "",
  generateAudio = null,
} = {}) {
  const normalizedMessageId = safeString(messageId);
  if (!normalizedMessageId) {
    const error = new Error("Voice message id is required");
    error.statusCode = 400;
    throw error;
  }

  const [[row]] = await db.execute(
    `SELECT *
     FROM character_voice_assets
     WHERE message_id = ? AND asset_type = 'ai_reply'
     ORDER BY created_at DESC
     LIMIT 1`,
    [normalizedMessageId]
  );
  if (!row?.id) {
    const error = new Error("Voice asset not found");
    error.statusCode = 404;
    throw error;
  }

  const current = mapAiReplyVoiceAssetRow(row);
  if (current.assetStatus === "ready" && current.audioUrl) {
    return { ...current, skipped: true };
  }

  const voiceMeta = {
    provider: current.provider,
    model: current.model,
    voiceId: current.voiceId,
    languageCode: current.languageCode,
    languageLabel: current.languageLabel,
  };
  const nextRetryCount = current.retryCount + 1;

  try {
    const audio = await runAudioGeneration({
      generateAudio,
      speechText: current.transcript,
      voiceMeta,
    });
    const payload = {
      ...current,
      assetStatus: audio.status || "ready",
      audioUrl: safeString(audio.audioUrl),
      audioBytes: Math.max(0, Number(audio.audioBytes || 0)),
      durationSeconds: Math.max(0, Math.round(Number(audio.durationSeconds || 0))),
      outputFormat: safeString(audio.outputFormat),
      providerRequestId: safeString(audio.providerRequestId),
      providerErrorRaw: "",
      retryCount: nextRetryCount,
      errorMessage: "",
    };
    await updateAiVoiceAsset(db, payload);
    return exposeAiVoiceAssetToClient(payload);
  } catch (error) {
    const payload = {
      ...current,
      assetStatus: "failed",
      audioUrl: "",
      audioBytes: 0,
      durationSeconds: 0,
      outputFormat: "",
      providerRequestId: "",
      providerErrorRaw: normalizeProviderErrorRaw(error),
      retryCount: nextRetryCount,
      errorMessage: safeString(error?.message).slice(0, 500),
    };
    await updateAiVoiceAsset(db, payload);
    return payload;
  }
}

export async function getAiReplyVoiceUsageSummary(db, {
  characterId = "",
  userId = "",
  startDate = "",
  endDate = "",
} = {}) {
  const filters = ["asset_type = 'ai_reply'"];
  const params = [];
  const normalizedCharacterId = safeString(characterId);
  const normalizedUserId = safeString(userId);
  if (normalizedCharacterId) {
    filters.push("character_id = ?");
    params.push(normalizedCharacterId);
  }
  if (normalizedUserId) {
    filters.push("source_ref = ?");
    params.push(`ai-reply:${normalizedUserId}`);
  }
  if (safeString(startDate)) {
    filters.push("created_at >= ?");
    params.push(safeString(startDate));
  }
  if (safeString(endDate)) {
    filters.push("created_at < ?");
    params.push(safeString(endDate));
  }

  const [[row]] = await db.execute(
    `SELECT
       COUNT(*) AS total_requests,
       SUM(CASE WHEN asset_status = 'ready' THEN 1 ELSE 0 END) AS ready_count,
       SUM(CASE WHEN asset_status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
       COALESCE(SUM(character_count), 0) AS character_count,
       COALESCE(SUM(audio_bytes), 0) AS audio_bytes,
       COALESCE(SUM(duration_seconds), 0) AS duration_seconds,
       COALESCE(SUM(estimated_credits), 0) AS estimated_credits,
       COALESCE(SUM(retry_count), 0) AS retry_count
     FROM character_voice_assets
     WHERE ${filters.join(" AND ")}`,
    params
  );

  return {
    totalRequests: Number(row?.total_requests || 0),
    readyCount: Number(row?.ready_count || 0),
    failedCount: Number(row?.failed_count || 0),
    characterCount: Number(row?.character_count || 0),
    audioBytes: Number(row?.audio_bytes || 0),
    durationSeconds: Number(row?.duration_seconds || 0),
    estimatedCredits: Number(row?.estimated_credits || 0),
    retryCount: Number(row?.retry_count || 0),
  };
}

export function estimateElevenLabsCredits({ provider = "elevenlabs", model = "", characterCount = 0, multiplier = null } = {}) {
  if (safeString(provider) !== "elevenlabs") return 0;
  const normalizedCharacterCount = Math.max(0, countCharacters(String(characterCount ? "x".repeat(Number(characterCount) || 0) : "")));
  const normalizedMultiplier = Number.isFinite(Number(multiplier)) && Number(multiplier) > 0
    ? Number(multiplier)
    : getModelCreditMultiplier(model);
  return Math.ceil(normalizedCharacterCount * normalizedMultiplier);
}

export function mapAiReplyVoiceAssetRow(row = {}) {
  return {
    id: row.id || "",
    messageId: row.message_id || "",
    characterId: row.character_id || "",
    transcript: row.transcript || "",
    durationSeconds: Number(row.duration_seconds || 0),
    provider: row.provider || "",
    model: row.model || "",
    voiceId: row.voice_id || "",
    languageCode: row.language_code || "",
    languageLabel: row.language_label || "",
    audioUrl: toProtectedVoiceUrl(row.audio_url || ""),
    audioBytes: Number(row.audio_bytes || 0),
    characterCount: Number(row.character_count || 0),
    estimatedCredits: Number(row.estimated_credits || 0),
    outputFormat: row.output_format || "",
    errorMessage: row.error_message || "",
    providerRequestId: row.provider_request_id || "",
    providerErrorRaw: row.provider_error_raw || "",
    retryCount: Number(row.retry_count || 0),
    lastAttemptAt: row.last_attempt_at || null,
    attemptToken: row.attempt_token || "",
    assetStatus: row.asset_status || "",
    sourceType: row.source_type || "",
    sourceRef: row.source_ref || "",
  };
}

function exposeAiVoiceAssetToClient(payload = {}) {
  return {
    ...payload,
    audioUrl: toProtectedVoiceUrl(payload.audioUrl || ""),
  };
}

async function runAudioGeneration({ generateAudio, speechText, voiceMeta, outputFileName = "", temporaryFileSuffix = "", deferFinalize = false }) {
  if (typeof generateAudio === "function") return generateAudio({ speechText, voiceMeta, outputFileName, temporaryFileSuffix, deferFinalize });
  if (voiceMeta.provider !== "elevenlabs") throw new Error(`Unsupported TTS provider: ${voiceMeta.provider || "unknown"}`);
  const config = resolveElevenLabsTtsConfig();
  if (!config.enabled) throw new Error("ElevenLabs TTS is not configured");
  return generateElevenLabsSpeech({
    text: speechText,
    voiceId: voiceMeta.voiceId,
    model: voiceMeta.model,
    config,
    outputFileName,
    temporaryFileSuffix,
    deferFinalize,
  });
}

async function removeTemporaryVoiceOutput(audio) {
  if (!audio?.temporaryPath) return false;
  return removeExistingFile(audio.temporaryPath);
}

async function getAiVoiceAssetById(assetId) {
  const [[row]] = await getDbPool().execute("SELECT * FROM character_voice_assets WHERE id = ? LIMIT 1", [assetId]);
  return row ? mapAiReplyVoiceAssetRow(row) : null;
}

async function recoverFinalizingAiVoiceAsset(current) {
  const recoveryToken = safeString(current.attemptToken);
  if (!recoveryToken) return current;
  const [claimed] = await getDbPool().execute(
    `UPDATE character_voice_assets
     SET last_attempt_at = NOW(3), updated_at = NOW(3)
     WHERE id = ?
       AND asset_status = 'finalizing'
       AND attempt_token = ?
       AND last_attempt_at < DATE_SUB(NOW(3), INTERVAL 30 SECOND)`,
    [current.id, recoveryToken]
  );
  if (Number(claimed.affectedRows || 0) !== 1) return getAiVoiceAssetById(current.id);

  const output = await findRecoverableAiVoiceOutput({ assetId: current.id, attemptToken: current.attemptToken });
  if (!output) {
    const failedPayload = {
      ...current,
      assetStatus: "failed",
      audioUrl: "",
      audioBytes: 0,
      durationSeconds: 0,
      outputFormat: current.outputFormat || "",
      providerRequestId: "",
      providerErrorRaw: "Interrupted before voice output was finalized.",
      errorMessage: "Voice generation was interrupted before completion.",
    };
    await updateAiVoiceAsset(getDbPool(), failedPayload, { expectedStatus: "finalizing", attemptToken: recoveryToken });
    await deleteHistoricalAiVoiceTemporaryFiles(current.id);
    return getAiVoiceAssetById(current.id);
  }

  if (output.temporaryPath) await rename(output.temporaryPath, output.outputPath);
  const readyPayload = {
    ...current,
    assetStatus: "ready",
    audioUrl: output.audioUrl,
    audioBytes: output.audioBytes,
    durationSeconds: current.durationSeconds,
    outputFormat: current.outputFormat || output.outputFormat,
    providerErrorRaw: "",
    errorMessage: "",
  };
  const updated = await updateAiVoiceAsset(getDbPool(), readyPayload, { expectedStatus: "finalizing", attemptToken: recoveryToken });
  if (!updated) {
    return reconcileLostAiVoiceFinalize({ assetId: current.id, audioUrl: readyPayload.audioUrl, attemptToken: recoveryToken });
  }
  await deleteHistoricalAiVoiceTemporaryFiles(current.id);
  return exposeAiVoiceAssetToClient(readyPayload);
}

async function findRecoverableAiVoiceOutput({ assetId, attemptToken }) {
  const normalizedAssetId = normalizeAiVoiceAssetId(assetId);
  if (!normalizedAssetId) return null;
  const config = resolveElevenLabsTtsConfig();
  const fileName = `${normalizedAssetId}.mp3`;
  const outputPath = join(config.outputDir, fileName);
  const finalFile = await stat(outputPath).catch(() => null);
  if (finalFile?.isFile() && finalFile.size > 0) {
    return { audioUrl: `${config.publicPath}/${fileName}`, audioBytes: finalFile.size, outputFormat: config.outputFormat, outputPath, temporaryPath: "" };
  }
  const normalizedAttemptToken = safeString(attemptToken);
  if (!/^[a-zA-Z0-9_-]+$/.test(normalizedAttemptToken)) return null;
  const temporaryPath = `${outputPath}.${normalizedAttemptToken}.tmp`;
  const temporaryFile = await stat(temporaryPath).catch(() => null);
  if (!temporaryFile?.isFile() || temporaryFile.size <= 0) return null;
  return { audioUrl: `${config.publicPath}/${fileName}`, audioBytes: temporaryFile.size, outputFormat: config.outputFormat, outputPath, temporaryPath };
}

async function deleteHistoricalAiVoiceTemporaryFiles(assetId) {
  const normalizedAssetId = normalizeAiVoiceAssetId(assetId);
  if (!normalizedAssetId) return false;
  const config = resolveElevenLabsTtsConfig();
  const prefix = `${normalizedAssetId}.mp3.`;
  const entries = await readdir(config.outputDir, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  let deleted = false;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
    const suffix = entry.name.slice(prefix.length);
    if (!/^[a-zA-Z0-9_-]+\.tmp$/.test(suffix)) continue;
    deleted = await removeExistingFile(join(config.outputDir, entry.name)) || deleted;
  }
  return deleted;
}

function normalizeAiVoiceAssetId(value = "") {
  const normalized = safeString(value);
  return /^[a-zA-Z0-9_-]+$/.test(normalized) ? normalized : "";
}

function isStaleVoiceAttempt(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 && timestamp < Date.now() - 30_000;
}

async function reconcileLostAiVoiceFinalize({ assetId, audioUrl, attemptToken }) {
  const latest = await getAiVoiceAssetById(assetId);
  if (!latest || ["cancelled", "failed"].includes(latest.assetStatus)) {
    await deleteStoredAiVoiceAsset({ assetId, audioUrl, attemptToken });
    return latest;
  }
  await removeExistingFile(getAiVoiceTemporaryPath({ assetId, attemptToken }));
  return latest;
}

function getAiVoiceTemporaryPath({ assetId, attemptToken }) {
  const normalizedAssetId = normalizeAiVoiceAssetId(assetId);
  const normalizedAttemptToken = safeString(attemptToken);
  if (!normalizedAssetId || !/^[a-zA-Z0-9_-]+$/.test(normalizedAttemptToken)) return "";
  return join(resolveElevenLabsTtsConfig().outputDir, `${normalizedAssetId}.mp3.${normalizedAttemptToken}.tmp`);
}

async function removeExistingFile(filePath) {
  if (!filePath) return false;
  try {
    const existing = await stat(filePath);
    if (!existing.isFile()) return false;
    await rm(filePath, { force: true });
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    console.warn("[aiove] failed to delete AI voice file:", error.message);
    return false;
  }
}

function buildAiVoiceBasePayload({ id, messageId, characterId, userId, speechText, voiceMeta }) {
  const normalizedSpeechText = safeString(speechText);
  const payload = {
    id: safeString(id),
    messageId: safeString(messageId),
    characterId: safeString(characterId),
    userId: safeString(userId),
    speechText: normalizedSpeechText,
    provider: voiceMeta.provider,
    model: voiceMeta.model,
    voiceId: voiceMeta.voiceId,
    languageCode: voiceMeta.languageCode,
    languageLabel: voiceMeta.languageLabel,
    characterCount: countCharacters(normalizedSpeechText),
  };
  payload.estimatedCredits = estimateElevenLabsCredits({
    provider: payload.provider,
    model: payload.model,
    characterCount: payload.characterCount,
  });
  return payload;
}

async function insertAiVoiceAsset(db, payload) {
  await db.execute(
    `INSERT INTO character_voice_assets (
       id, character_id, asset_type, title, transcript, duration_seconds, provider, voice_id,
       model, language_code, language_label, audio_url, audio_bytes, character_count,
       estimated_credits, output_format, error_message, provider_request_id, provider_error_raw,
       retry_count, last_attempt_at, message_id, waveform_json, asset_status, source_type, source_ref
     ) VALUES (?, ?, 'ai_reply', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, JSON_ARRAY(), ?, 'ai', ?)`,
    [
      payload.id,
      payload.characterId,
      "AI reply voice",
      payload.speechText,
      payload.durationSeconds,
      payload.provider,
      payload.voiceId,
      payload.model,
      payload.languageCode,
      payload.languageLabel,
      payload.audioUrl,
      payload.audioBytes,
      payload.characterCount,
      payload.estimatedCredits,
      payload.outputFormat,
      payload.errorMessage,
      payload.providerRequestId,
      payload.providerErrorRaw,
      payload.retryCount || 0,
      payload.messageId || null,
      payload.assetStatus,
      payload.userId ? `ai-reply:${payload.userId}` : "ai-reply",
    ]
  );
}

async function updateAiVoiceAsset(db, payload, { expectedStatus = "", attemptToken = "" } = {}) {
  const [result] = await db.execute(
    `UPDATE character_voice_assets
     SET duration_seconds = ?,
         audio_url = ?,
         audio_bytes = ?,
         character_count = ?,
         estimated_credits = ?,
         output_format = ?,
         error_message = ?,
         provider_request_id = ?,
         provider_error_raw = ?,
         retry_count = ?,
         last_attempt_at = NOW(3),
         attempt_token = NULL,
         asset_status = ?,
         updated_at = NOW(3)
     WHERE id = ?${expectedStatus ? " AND asset_status = ? AND attempt_token = ?" : ""}`,
    [
      payload.durationSeconds,
      payload.audioUrl,
      payload.audioBytes,
      payload.characterCount,
      payload.estimatedCredits,
      payload.outputFormat,
      payload.errorMessage,
      payload.providerRequestId,
      payload.providerErrorRaw,
      payload.retryCount,
      payload.assetStatus,
      payload.id,
      ...(expectedStatus ? [expectedStatus, attemptToken] : []),
    ]
  );
  if (Number(result.affectedRows || 0) !== 1) return false;
  if (payload.assetStatus === "ready" && payload.messageId) {
    await db.execute(
      "UPDATE chat_messages SET voice_asset_id = ?, updated_at = NOW(3) WHERE id = ?",
      [payload.id, payload.messageId]
    );
  }
  return true;
}

function normalizeVoiceMeta(value = {}) {
  const legacyPreset = getElevenLabsVoicePreset(value.voiceId || value.voiceStyle || value.voice || "");
  const provider = safeString(value.provider || (legacyPreset ? legacyPreset.provider : "elevenlabs"));
  return {
    provider: provider === "system" && legacyPreset ? legacyPreset.provider : (provider || "elevenlabs"),
    model: safeString(value.model) || resolveElevenLabsTtsConfig().qualityModel,
    voiceId: safeString(legacyPreset?.voiceId || value.voiceId),
    languageCode: safeString(value.languageCode || "en"),
    languageLabel: safeString(value.languageLabel || "English"),
  };
}

function countCharacters(value = "") {
  return Array.from(safeString(value)).length;
}

function getModelCreditMultiplier(model = "") {
  const normalized = safeString(model).toLowerCase();
  if (!normalized) return 1;
  if (normalized === "eleven_v4_turbo") return 0.5;
  return 1;
}

function normalizeProviderErrorRaw(error) {
  return safeString(error?.providerErrorRaw || error?.providerResponse || error?.rawBody || error?.body || error?.message).slice(0, 2000);
}

function safeString(value = "") {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}
