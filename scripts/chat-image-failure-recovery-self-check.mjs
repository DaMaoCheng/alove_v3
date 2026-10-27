import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.IMAGE_GENERATION_PROVIDER = "openai";
process.env.IMAGE_GENERATION_API_KEY = "chat-image-failure-self-check";
process.env.IMAGE_GENERATION_BASE_URL = "https://chat-image-failure-self-check.invalid/v1";
process.env.IMAGE_GENERATION_MODEL = "self-check";
process.env.OPENAI_API_KEY = "chat-image-failure-reply-self-check";
process.env.OPENAI_BASE_URL = "https://chat-image-failure-reply-self-check.invalid/v1";
process.env.OPENAI_MODEL = "self-check";

const { closeDbPool, getDbPool, initializeDatabase, withTransaction } = await import("../server/db.js");
const { createId, createToken, hashSessionToken } = await import("../server/security.js");
const { createChatImagePlaceholder } = await import("../server/chat-image-generation-service.js");
const { claimNextMemoryJob } = await import("../server/memory-job-service.js");
const { generateChatImageFromJob } = await import("../server/chat-image-job-service.js");
const { enqueueChatImageFailureReplyIfNeeded, generateChatImageFailureReplyFromJob, registerChatImageInitialReplyForDb } = await import("../server/chat-image-failure-reply-job-service.js");
const { insertMessage, mapMessageRow, buildMessageSelectSql } = await import("../server/chat-message-store.js");
const { renderChatImageMessage } = await import("../src/features/chat/chat-image-message.js");
const { renderChatMessages } = await import("../src/features/chat/chat-message-renderer.js");

const suffix = randomUUID().replaceAll("-", "");
const USER_ID = `user_img_failure_${suffix}`.slice(0, 64);
const GUEST_ID = `guest_img_failure_${suffix}`.slice(0, 64);
const USER_SESSION_ID = `chat_img_failure_user_${suffix}`.slice(0, 64);
const GUEST_SESSION_ID = `chat_img_failure_guest_${suffix}`.slice(0, 64);
const USER_MESSAGE_ID = createId("msg");
const GUEST_MESSAGE_ID = createId("msg");
const db = getDbPool();
const originalFetch = globalThis.fetch;
let imageProviderCalls = 0;

await initializeDatabase();
globalThis.fetch = async (_url, options = {}) => {
  if (String(_url).includes("chat-image-failure-self-check.invalid")) {
    imageProviderCalls++;
    return new Response(JSON.stringify({ error: { message: "Not found" } }), { status: 404, headers: { "content-type": "application/json" } });
  }
  const body = JSON.parse(options.body || "{}");
  const content = JSON.stringify({
    displayText: "Sorry, the photo didn’t come through. Want me to try again?",
    speechText: "Sorry, the photo didn’t come through. Want me to try again?",
  });
  const responseBody = body.input
    ? { output_text: content }
    : { choices: [{ message: { content } }] };
  return new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } });
};

let characterId = "";
let siteId = "";
try {
  const [[character]] = await db.execute(
    `SELECT id, name, avatar_url, role_title, short_bio, opening_line, persona_prompt, speaking_style,
            voice_provider, voice_id, voice_style, tags_json, profile_json
     FROM ai_characters WHERE character_status = 'published' ORDER BY created_at LIMIT 1`
  );
  const [[site]] = await db.execute("SELECT id FROM sites ORDER BY created_at LIMIT 1");
  assert.ok(character?.id && site?.id, "a published character and site are required for this self-check");
  characterId = character.id;
  siteId = site.id;

  await seedUserSession();
  await seedGuestSession();
  const userImage = await createFailedImage({
    session: { id: USER_SESSION_ID, internal_uid: USER_ID, preferred_language: "English" },
    userId: USER_ID,
    messageId: USER_MESSAGE_ID,
    userText: "Please send me a photo",
  });
  const guestImage = await createFailedImage({
    session: { id: GUEST_SESSION_ID, guest_session_id: GUEST_ID, preferred_language: "English" },
    guestSessionId: GUEST_ID,
    messageId: GUEST_MESSAGE_ID,
    userText: "Can you show me a picture?",
  });

  for (const image of [userImage, guestImage]) {
    const [[imageJobRow]] = await db.execute(
      "SELECT id, retry_count, max_retries, payload_json FROM memory_jobs WHERE session_id = ? AND job_type = 'generate_chat_image' ORDER BY created_at DESC LIMIT 1",
      [image.sessionId]
    );
    assert.ok(imageJobRow, "image generation job should exist before terminal failure");
    if (image.guestSessionId) {
      // The guest fixture intentionally omits a live site entitlement; use the same terminal state
      // that markChatImageFailed writes, then exercise the guest failure-reply branch below.
      await db.execute("UPDATE chat_image_assets SET status = 'failed', error_message = 'Not found', updated_at = NOW(3) WHERE id = ?", [image.assetId]);
      await db.execute("UPDATE chat_messages SET delivery_status = 'failed', text_content = 'Could not finish the photo.' WHERE id = ?", [image.messageId]);
    } else {
      const [[beforeFailure]] = await db.execute("SELECT status FROM chat_image_assets WHERE id = ?", [image.assetId]);
      assert.equal(beforeFailure.status, "queued", "provider failure must start from a live queued image");
      const claimedImageJob = await claimNextMemoryJob({ jobId: imageJobRow.id });
      assert.ok(claimedImageJob?.claimToken);
      const terminalAttempt = {
        ...claimedImageJob,
        retryCount: Number(imageJobRow.max_retries || 1),
        maxRetries: Number(imageJobRow.max_retries || 1),
        payload: { ...parseJson(imageJobRow.payload_json, {}), phase: "real" },
      };
      await assert.rejects(generateChatImageFromJob(terminalAttempt), /Not found|404/i);
      const attemptsAfterFailure = imageProviderCalls;
      assert.ok(attemptsAfterFailure > 0, "the failing provider transport must really be exercised");
      const terminalReplay = await generateChatImageFromJob(terminalAttempt);
      assert.equal(terminalReplay.reason, "image_already_failed", "terminal failed assets must never be revived by replay");
      assert.equal(imageProviderCalls, attemptsAfterFailure, "failed replay must not call the provider again");
    }
    const [[failedRow]] = await db.execute("SELECT status, error_message FROM chat_image_assets WHERE id = ?", [image.assetId]);
    assert.equal(failedRow.status, "failed", "provider failure should move the asset to terminal failed state");
    assert.match(failedRow.error_message || "", /Not found|404/i, `raw provider failure should remain in the database: ${JSON.stringify({ failedRow, image })}`);
    const firstJobId = await enqueueChatImageFailureReplyIfNeeded(db, image.enqueue);
    const duplicateJobId = await enqueueChatImageFailureReplyIfNeeded(db, image.enqueue);
    assert.equal(duplicateJobId, firstJobId, "duplicate failure enqueue must reuse one job");
    await db.execute("UPDATE memory_jobs SET available_at = NOW(3) WHERE id = ?", [firstJobId]);
    const job = await claimNextMemoryJob({ jobId: firstJobId });
    assert.ok(job?.claimToken, "failure reply fixture must claim its own job");
    const result = await generateChatImageFailureReplyFromJob(job);
    assert.equal(result.ok, true);
    const repeated = await generateChatImageFailureReplyFromJob(job);
    assert.equal(repeated.reason, "reply_already_exists");
    const [[replyCount]] = await db.execute(
      "SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ? AND source_ref = ?",
      [image.sessionId, `chat-image-failure:${image.assetId}`]
    );
    assert.equal(Number(replyCount.count), 1, "failure reply must be persisted once");
    const [[reply]] = await db.execute(
      "SELECT text_content, source_ref FROM chat_messages WHERE session_id = ? AND source_ref = ? LIMIT 1",
      [image.sessionId, `chat-image-failure:${image.assetId}`]
    );
    assert.match(reply.text_content, /photo|picture|try again/i);
    assert.doesNotMatch(reply.text_content, /Not found|provider|quota|backend/i);
  }

  const [[publicRow]] = await db.execute(buildMessageSelectSql("m.id = ?"), [userImage.messageId]);
  assert.equal(mapMessageRow(publicRow).image.errorMessage, "", "public chat mapping must not expose provider errors");
  assert.equal(renderChatImageMessage({
    message: { id: "failed", contentType: "image_generation", image: { status: "failed", errorMessage: "Not found" } },
    pageLanguage: "English", copy: { t: (key) => key }, escapeHtml: String, escapeAttribute: String,
  }), "", "failed image card must be hidden from the user");
  const failedMarkup = renderChatMessages({
    character: { name: "Check", avatarUrl: "" },
    messages: [{ id: "failed", contentType: "image_generation", image: { status: "failed" }, sentAt: new Date() }],
    loading: false, error: null, pageLanguage: "English", escapeHtml: String, escapeAttribute: String,
  });
  assert.equal(failedMarkup, "", "failed image must not leave an empty avatar/time wrapper");
  console.log("chat image failure recovery self-check passed");
} finally {
  globalThis.fetch = originalFetch;
  await cleanup();
  await closeDbPool();
}

async function seedUserSession() {
  await db.execute(
    `INSERT INTO users (id, platform, platform_uid, locale, username, password_hash, email, email_auth_provider, account_type, account_status)
     VALUES (?, 'web', ?, 'en', ?, 'self-check', ?, 'email', 'personal', 'active')`,
    [USER_ID, USER_ID, USER_ID, `${USER_ID}@example.test`]
  );
  await db.execute(
    `INSERT INTO chat_sessions (id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language)
     VALUES (?, ?, ?, 'Image failure user check', 'active', 'self-check', 'image-failure-self-check', 'English')`,
    [USER_SESSION_ID, USER_ID, characterId]
  );
}

async function seedGuestSession() {
  await db.execute(
    `INSERT INTO guest_sessions (id, token_hash, site_id, mascot_character_id, chat_session_id, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 1 DAY))`,
    [GUEST_ID, hashSessionToken(createToken()), siteId, characterId, GUEST_SESSION_ID]
  );
  await db.execute(
    `INSERT INTO chat_sessions (id, internal_uid, guest_session_id, character_id, session_title, session_status, source_type, source_ref, preferred_language)
     VALUES (?, NULL, ?, ?, 'Image failure guest check', 'active', 'self-check', 'image-failure-self-check', 'English')`,
    [GUEST_SESSION_ID, GUEST_ID, characterId]
  );
}

async function createFailedImage({ session, userId = "", guestSessionId = "", messageId, userText }) {
  const triggerMessage = await insertMessage(db, {
    sessionId: session.id, guestSessionId, characterId: null, senderType: "user", senderLabel: "You", contentType: "text", text: userText,
    displayOrder: 10, sourceType: "self-check", sourceRef: `image-failure-user:${messageId}`,
  });
  const placeholder = await createChatImagePlaceholder(db, {
    session, character: { id: characterId, name: "Image Failure Check" }, userId, guestSessionId,
    userText: "photo request", afterDisplayOrder: 10, sourceType: "self-check", sourceRef: "image-failure-placeholder",
  });
  assert.ok(placeholder?.image?.id, "placeholder should be created");
  const assetId = placeholder.image.id;
  const initialReply = await insertMessage(db, {
    sessionId: session.id, guestSessionId, characterId, senderType: "character", senderLabel: "Image Failure Check",
    contentType: "text", text: "Your photo is being prepared.", displayOrder: 20,
    sourceType: "self-check", sourceRef: `image-failure-initial:${messageId}`,
  });
  await withTransaction(connection => registerChatImageInitialReplyForDb(connection, {
    snapshot: { assetId, messageId: placeholder.id, status: "queued", userDisplayOrder: 10, natural: true, requestScope: "image_only" },
    replyMessage: initialReply, triggerMessageId: triggerMessage.id,
  }));
  return {
    assetId, messageId: placeholder.id, sessionId: session.id,
    guestSessionId,
    enqueue: { assetId, messageId: placeholder.id, sessionId: session.id, userId, guestSessionId, characterId },
  };
}

async function cleanup() {
  const [voiceRows] = await db.execute(
    "SELECT voice_asset_id FROM chat_messages WHERE session_id IN (?, ?) AND voice_asset_id IS NOT NULL",
    [USER_SESSION_ID, GUEST_SESSION_ID]
  ).catch(() => [[]]);
  const voiceIds = voiceRows.map((row) => row.voice_asset_id).filter(Boolean);
  if (voiceIds.length) {
    await db.query(`DELETE FROM character_voice_assets WHERE id IN (${voiceIds.map(() => "?").join(",")})`, voiceIds).catch(() => {});
  }
  await db.execute("DELETE FROM memory_jobs WHERE session_id IN (?, ?)", [USER_SESSION_ID, GUEST_SESSION_ID]).catch(() => {});
  await db.execute("DELETE FROM guest_image_entitlements WHERE guest_session_id = ?", [GUEST_ID]).catch(() => {});
  await db.execute("DELETE FROM guest_image_daily_quotas WHERE guest_session_id = ?", [GUEST_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_messages WHERE session_id IN (?, ?)", [USER_SESSION_ID, GUEST_SESSION_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id IN (?, ?)", [USER_SESSION_ID, GUEST_SESSION_ID]).catch(() => {});
  await db.execute("DELETE FROM guest_sessions WHERE id = ?", [GUEST_ID]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [USER_ID]).catch(() => {});
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
