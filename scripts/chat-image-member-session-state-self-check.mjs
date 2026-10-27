import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SERVER_CONFIG } from "../server/config.js";
import { getDbPool, closeDbPool } from "../server/db-core.js";
import { createId, hashSecret } from "../server/security.js";
import { findLatestUserSessionForDb, findOrCreateUserSession, mapSessionRow } from "../server/chat-session-service.js";
import { resolveChatImageStatusContext, withChatImageReplySnapshot } from "../server/chat-image-status-context-service.js";
import { registerChatImageInitialReplyForDb, enqueueChatImageTerminalReplyIfNeeded } from "../server/chat-image-failure-reply-job-service.js";

// Exercise actual SELECT projections, scoped image reads and terminal registration.
// All fixture writes are uncommitted and rolled back; no seed/worker/provider runs.
assert.ok(["127.0.0.1", "localhost", "::1"].includes(SERVER_CONFIG.db.host));
assert.equal(SERVER_CONFIG.db.port, 3307, "member session state check requires the local development database");
const userId = `dedup_retest_${randomUUID()}`;
const email = `image-session-${randomUUID()}@example.test`;
const db = await getDbPool().getConnection();
try {
  await db.beginTransaction();
  const [[character]] = await db.query("SELECT id, name FROM ai_characters WHERE category_id = 'mascot' AND character_status = 'published' LIMIT 1");
  assert.ok(character, "local fixture requires a published mascot");
  await db.execute("INSERT INTO users (id, platform_uid, username, password_hash, email) VALUES (?, ?, ?, ?, ?)",
    [userId, email, email, hashSecret(randomUUID()), email]);
  const created = await findOrCreateUserSession(db, { character, userId });
  const session = await findLatestUserSessionForDb(db, { characterId: character.id, userId });
  const triggerId = createId("msg"), imageId = createId("msg"), assetId = createId("chat_img"), replyId = createId("msg");
  for (const [id, order, sender, type] of [[triggerId, 70, "user", "text"], [imageId, 71, "character", "image_generation"], [replyId, 80, "character", "text"]]) {
    await db.execute("INSERT INTO chat_messages (id, session_id, character_id, sender_type, content_type, display_order, text_content) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, session.id, sender === "user" ? null : character.id, sender, type, order, sender === "user" ? "Send that outfit photo" : "Fixture"]);
  }
  await db.execute("INSERT INTO chat_image_assets (id, message_id, session_id, character_id, internal_uid, status, prompt_context_json) VALUES (?, ?, ?, ?, ?, 'ready', ?)",
    [assetId, imageId, session.id, character.id, userId, JSON.stringify({ _terminalReply: { version: 1, coordinated: true } })]);
  const options = { session, character, userDisplayOrder: 70,
    directive: { taskCreated: true, reason: "image_task_created", trigger: { requestScope: "mixed" } } };
  const context = await resolveChatImageStatusContext(db, options);
  const reply = withChatImageReplySnapshot({ text: "Image reply", sourceRef: "reply-boundary-guard" }, context);
  assert.equal(reply._imageDeliveryReply?.assetId, assetId,
    "actual member-session SELECT must preserve owner fields so a ready image receives its initial-reply registration snapshot");
  assert.equal(context.imageStatus.currentTurn, true);
  assert.equal(session.internal_uid, userId);
  assert.equal(session.guest_session_id, null);
  assert.equal(created.internal_uid, userId, "new and existing sessions must have the same private owner shape");
  assert.equal(created.guest_session_id, null);
  assert.equal(mapSessionRow(session).internal_uid, undefined, "private ownership must not leak into the public session projection");
  assert.equal(await findLatestUserSessionForDb(db, { characterId: character.id, userId: "missing-local-owner" }), null);
  for (const foreign of [{ ...session, internal_uid: "different-owner" }, { ...session, guest_session_id: "different-guest" }]) {
    const denied = await resolveChatImageStatusContext(db, { ...options, session: foreign });
    assert.equal(withChatImageReplySnapshot({}, denied)._imageDeliveryReply, undefined, "owner/guest guards must remain closed");
  }
  const persistedReply = { id: replyId, sessionId: session.id, characterId: character.id };
  const jobId = await registerChatImageInitialReplyForDb(db, { snapshot: reply._imageDeliveryReply, replyMessage: persistedReply, triggerMessageId: triggerId });
  assert.ok(jobId, "ready image plus registered initial reply must enqueue the terminal caption");
  assert.equal(await registerChatImageInitialReplyForDb(db, { snapshot: reply._imageDeliveryReply, replyMessage: persistedReply, triggerMessageId: triggerId }), jobId);
  assert.equal(await enqueueChatImageTerminalReplyIfNeeded(db, { assetId, messageId: imageId }), jobId);
  const [[asset]] = await db.execute("SELECT prompt_context_json FROM chat_image_assets WHERE id = ?", [assetId]);
  const metadata = typeof asset.prompt_context_json === "string" ? JSON.parse(asset.prompt_context_json) : asset.prompt_context_json;
  assert.equal(metadata._terminalReply.initialReply.messageId, replyId);
  const [[count]] = await db.execute("SELECT COUNT(*) AS total FROM memory_jobs WHERE session_id = ? AND job_type = 'generate_chat_image_failure_reply'", [session.id]);
  assert.equal(count.total, 1, "repeated registration must not create a second caption task");
  console.log("member image session state check passed (real session projection → scoped image → terminal registration/dedup; transaction rollback)");
} finally {
  await db.rollback();
  db.release();
  await closeDbPool();
}
