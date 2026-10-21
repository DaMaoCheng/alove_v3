import { initializeDatabase, getDbPool } from "../server/db.js";
import { buildChatWakeUpContext } from "../server/chat-wakeup-context-service.js";
import { deleteStoredAiVoiceAsset } from "../server/chat-voice-asset-service.js";
import { hashSecret } from "../server/security.js";

const baseUrl = String(process.env.RUNTIME_SELF_CHECK_BASE_URL || "http://127.0.0.1:4173").replace(/\/+$/, "");
const email = `runtime-chat-${Date.now()}@example.local`;
const password = "Runtime12345";
const seededUserId = `u_runtime_chat_${Date.now()}`;
let cookie = "";
let userId = "";
let cleanupError = null;

try {
  await seedRuntimeUser();
  const loginResult = await requestJson("/api/auth/login", {
    method: "POST",
    body: {
      email,
      password,
      remember: false,
    },
  });
  userId = loginResult.userId || seededUserId;

  const chatResult = await requestJson("/api/characters/fan/messages", {
    method: "POST",
    body: {
      text: "我支持阿森纳，以后别这样叫我，这对我很重要",
    },
  });
  const userMessage = Array.isArray(chatResult.items)
    ? chatResult.items.find((item) => item.senderType === "user" && item.contentType === "text")
    : null;
  if (!chatResult.ok || !userMessage?.id) {
    throw new Error("chat response did not include user message");
  }

  const replyResult = await requestJson("/api/characters/fan/messages/reply", {
    method: "POST",
    body: {
      sinceMessageId: userMessage.id,
    },
  });
  if (!replyResult.ok || !Array.isArray(replyResult.items) || !replyResult.items.some((item) => item.senderType === "character")) {
    throw new Error("chat reply response did not include assistant message");
  }

  await sleep(6500);
  const dbResult = await verifyDatabaseChain();
  printResult({
    ok: true,
    email,
    userId,
    ...dbResult,
  });
} finally {
  try {
    await cleanupRuntimeUser();
  } catch (error) {
    cleanupError = error;
  }
}

if (cleanupError) throw cleanupError;
process.exit(0);

async function verifyDatabaseChain() {
  await initializeDatabase();
  const db = getDbPool();
  const [sessions] = await db.execute(
    "SELECT id FROM chat_sessions WHERE internal_uid = ? AND character_id = 'fan' ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  const sessionId = String(sessions[0]?.id || "").trim();
  if (!sessionId) throw new Error("runtime chat session missing");

  const [[messages]] = await db.execute("SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ?", [sessionId]);
  const [[indexes]] = await db.execute("SELECT COUNT(*) AS count FROM chat_message_index WHERE internal_uid = ? AND session_id = ?", [userId, sessionId]);
  const [jobs] = await db.execute(
    "SELECT job_type, job_status FROM memory_jobs WHERE internal_uid = ? ORDER BY created_at ASC",
    [userId]
  );
  const [[memories]] = await db.execute(
    "SELECT COUNT(*) AS count FROM user_memory_records WHERE internal_uid = ? AND memory_status = 'active'",
    [userId]
  );
  const [[rawEpisodes]] = await db.execute(
    "SELECT COUNT(*) AS count FROM user_memory_records WHERE internal_uid = ? AND memory_type = 'raw_episode' AND memory_status = 'active'",
    [userId]
  );
  const [[summaries]] = await db.execute(
    "SELECT COUNT(*) AS count FROM conversation_summaries WHERE internal_uid = ? AND summary_status = 'active'",
    [userId]
  );
  const context = await buildChatWakeUpContext(db, {
    userId,
    characterId: "fan",
    sessionId,
    queryText: "你记得我说过什么吗",
  });

  const result = {
    sessionId,
    messageCount: Number(messages.count || 0),
    indexCount: Number(indexes.count || 0),
    jobs: jobs.map((job) => ({ type: job.job_type, status: job.job_status })),
    activeMemoryCount: Number(memories.count || 0),
    rawEpisodeCount: Number(rawEpisodes.count || 0),
    summaryCount: Number(summaries.count || 0),
    wakeUpHasRawEpisode: String(context.wakeUpContext || "").includes("Key raw episodes"),
  };

  if (result.messageCount < 2) throw new Error("runtime chat messages not persisted");
  if (result.indexCount < 2) throw new Error("runtime chat indexes not written");
  if (result.jobs.some((job) => job.status === "failed")) {
    throw new Error(`runtime memory jobs did not complete: ${JSON.stringify(result.jobs)}`);
  }
  if (!result.jobs.some((job) => job.type === "extract_user_memory" && job.status === "completed")) {
    throw new Error(`runtime memory extraction job did not complete: ${JSON.stringify(result.jobs)}`);
  }
  if (result.activeMemoryCount < 1) throw new Error("runtime memory extraction did not write active memories");
  if (result.rawEpisodeCount < 1) throw new Error("runtime raw episode missing");
  if (result.summaryCount < 1) throw new Error("runtime summaries missing");
  if (!result.wakeUpHasRawEpisode) throw new Error("wake-up context missing raw episode");

  return result;
}

async function cleanupRuntimeUser() {
  await initializeDatabase();
  const db = getDbPool();
  const cleanupUserId = userId || seededUserId;
  const [voiceAssets] = await db.execute(
    `SELECT DISTINCT voice.id, voice.audio_url, voice.attempt_token
     FROM character_voice_assets voice
     INNER JOIN chat_messages message ON message.voice_asset_id = voice.id
     INNER JOIN chat_sessions session ON session.id = message.session_id
     WHERE session.internal_uid = ?`,
    [cleanupUserId]
  );
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [cleanupUserId]);
  await db.execute("DELETE FROM chat_sessions WHERE internal_uid = ?", [cleanupUserId]);
  if (voiceAssets.length) {
    await db.execute(
      `DELETE FROM character_voice_assets WHERE id IN (${voiceAssets.map(() => "?").join(", ")})`,
      voiceAssets.map((asset) => asset.id)
    );
    for (const asset of voiceAssets) {
      await deleteStoredAiVoiceAsset({ assetId: asset.id, audioUrl: asset.audio_url, attemptToken: asset.attempt_token });
    }
  }
  await db.execute("DELETE FROM users WHERE id = ? OR email = ?", [cleanupUserId, email]);
  await db.execute("DELETE FROM email_verification_codes WHERE email = ?", [email]);
  const [[leftovers]] = await db.execute(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE id = ? OR email = ?) AS user_count,
       (SELECT COUNT(*) FROM chat_sessions WHERE internal_uid = ?) AS session_count,
       (SELECT COUNT(*) FROM character_voice_assets WHERE id IN (${voiceAssets.length ? voiceAssets.map(() => "?").join(", ") : "NULL"})) AS voice_count`,
    [cleanupUserId, email, cleanupUserId, ...voiceAssets.map((asset) => asset.id)]
  );
  if (Number(leftovers.user_count || 0) || Number(leftovers.session_count || 0) || Number(leftovers.voice_count || 0)) {
    throw new Error(`runtime self-check cleanup incomplete: ${JSON.stringify(leftovers)}`);
  }
}

async function seedRuntimeUser() {
  await initializeDatabase();
  const db = getDbPool();
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, account_status, last_seen_at
     ) VALUES (?, 'web', ?, 'en', ?, ?, 'Runtime Self Check',
       ?, NOW(3), 'email', 'personal', 'active', NOW(3))`,
    [seededUserId, email, email, hashSecret(password), email]
  );
  await db.execute(
    "INSERT INTO billing_accounts (internal_uid, balance, currency) VALUES (?, 0, 'credits')",
    [seededUserId]
  );
}

async function requestJson(path, { method = "GET", body = null } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const payload = await response.json().catch(async () => ({ raw: await response.text().catch(() => "") }));
  if (!response.ok) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
}
