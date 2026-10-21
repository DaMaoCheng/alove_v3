import { initializeDatabase, getDbPool } from "../server/db.js";
import { deleteStoredAiVoiceAsset } from "../server/chat-voice-asset-service.js";
import { MEMORY_JOB_TYPES, enqueueMemoryJob, listMemoryJobs } from "../server/memory-job-service.js";
import { runMemoryJobBatch } from "../server/memory-job-runner-service.js";
import { getDeliveryDateForTimeZone } from "../server/proactive-message-delivery-service.js";

await initializeDatabase();

const suffix = Date.now();
const userId = `u_proactive_${suffix}`;
const sessionId = `chat_proactive_${suffix}`;
const seedMessageId = `msg_proactive_seed_${suffix}`;
const deliveryDate = getDeliveryDateForTimeZone(new Date(), "UTC");

try {
  await seedConversation();

  const sendJobId = await enqueueMemoryJob({
    userId,
    characterId: "fan",
    sessionId,
    jobType: MEMORY_JOB_TYPES.SEND_PROACTIVE_MESSAGE,
    priority: 1,
    maxRetries: 0,
    payload: {
      selfCheck: "proactive_send",
      userId,
      characterId: "fan",
      sessionId,
      deliveryMode: "daily_required",
      slotIndex: 1,
      deliveryDate,
      selectedBy: "self_check",
      minIdleMinutes: 0,
      maxUnansweredProactive: 1,
      ignoreQuietHours: true,
      reason: "self_check",
    },
  });
  await runMemoryJobBatch();

  const firstResult = await inspectJob(sendJobId);
  const firstMessage = await latestMessage();
  assert(firstResult.jobStatus === "completed", "send proactive job did not complete");
  assert(firstResult.result?.sent === true, "send proactive job did not send");
  assert(firstMessage?.source_ref === "proactive-nudge", "latest message is not proactive nudge");
  assert(firstMessage?.sender_type === "character", "proactive nudge sender is not character");
  assert(String(firstMessage?.text_content || "").trim(), "proactive nudge text is empty");
  assert(!/displayText|speechText|voiceMeta|internal analysis|prompt|memory_jobs/i.test(firstMessage.text_content || ""), "proactive nudge leaked internal text");

  const skipJobId = await enqueueMemoryJob({
    userId,
    characterId: "fan",
    sessionId,
    jobType: MEMORY_JOB_TYPES.SEND_PROACTIVE_MESSAGE,
    priority: 1,
    maxRetries: 0,
    payload: {
      selfCheck: "proactive_skip",
      userId,
      characterId: "fan",
      sessionId,
      deliveryMode: "idle_followup",
      slotIndex: 2,
      deliveryDate,
      selectedBy: "self_check",
      minIdleMinutes: 0,
      maxUnansweredProactive: 1,
      ignoreQuietHours: true,
      reason: "self_check_repeat",
    },
  });
  await runMemoryJobBatch();

  const secondResult = await inspectJob(skipJobId);
  const proactiveCount = await countProactiveMessages();
  assert(secondResult.jobStatus === "completed", "skip proactive job did not complete");
  assert(secondResult.result?.sent === false, "repeat proactive job should be skipped");
  assert(secondResult.result?.reason === "previous_proactive_unanswered", "repeat proactive skip reason mismatch");
  assert(proactiveCount === 1, "repeat proactive job inserted another message");

  printJson({
    ok: true,
    userId,
    sessionId,
    sendJob: {
      id: sendJobId,
      status: firstResult.jobStatus,
      result: firstResult.result,
    },
    skipJob: {
      id: skipJobId,
      status: secondResult.jobStatus,
      result: secondResult.result,
    },
    proactiveMessage: {
      id: firstMessage.id,
      text: firstMessage.text_content,
    },
  });
} finally {
  await cleanup();
}

process.exit(0);

async function seedConversation() {
  const db = getDbPool();
  await db.execute(
    `INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type)
     VALUES (?, ?, ?, ?, ?, 'active', 'personal')`,
    [userId, userId, userId, "x", `${userId}@example.local`]
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, character_id, session_title, session_status, source_type, source_ref, last_message_at
     ) VALUES (?, ?, 'fan', 'proactive self check', 'active', 'user', 'proactive-self-check', DATE_SUB(NOW(3), INTERVAL 5 HOUR))`,
    [sessionId, userId]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, 'fan', 'character', 'Dani Ultra', 'text', 'Catch you after the match talk.', 10, 'sent', 'ai', 'openai-responses', DATE_SUB(NOW(3), INTERVAL 5 HOUR))`,
    [seedMessageId, sessionId]
  );
}

async function inspectJob(jobId) {
  const jobs = await listMemoryJobs({ limit: 50 });
  const job = jobs.find((item) => item.id === jobId);
  return job || null;
}

async function latestMessage() {
  const [rows] = await getDbPool().execute(
    `SELECT id, sender_type, source_ref, text_content
     FROM chat_messages
     WHERE session_id = ?
     ORDER BY display_order DESC, sent_at DESC
     LIMIT 1`,
    [sessionId]
  );
  return rows[0] || null;
}

async function countProactiveMessages() {
  const [rows] = await getDbPool().execute(
    "SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ? AND source_ref = 'proactive-nudge'",
    [sessionId]
  );
  return Number(rows[0]?.count || 0);
}

async function cleanup() {
  const db = getDbPool();
  const [voiceAssets] = await db.execute(
    "SELECT id, audio_url, attempt_token FROM character_voice_assets WHERE source_ref = ?",
    [`ai-reply:${userId}`]
  );
  await db.execute("UPDATE chat_messages SET voice_asset_id = NULL WHERE session_id = ?", [sessionId]);
  await db.execute("DELETE FROM character_voice_assets WHERE source_ref = ?", [`ai-reply:${userId}`]);
  await db.execute("DELETE FROM proactive_message_deliveries WHERE internal_uid = ?", [userId]);
  await db.execute("DELETE FROM memory_jobs WHERE internal_uid = ?", [userId]);
  await db.execute("DELETE FROM chat_messages WHERE session_id = ?", [sessionId]);
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [sessionId]);
  await db.execute("DELETE FROM users WHERE id = ?", [userId]);
  for (const voiceAsset of voiceAssets) {
    await deleteStoredAiVoiceAsset({
      assetId: voiceAsset.id,
      audioUrl: voiceAsset.audio_url,
      attemptToken: voiceAsset.attempt_token,
    });
  }
}

function assert(condition, message) {
  if (condition) return;
  throw new Error(message);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
