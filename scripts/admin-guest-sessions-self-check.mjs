import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getDbPool } from "../server/db.js";
import { createId } from "../server/security.js";
import {
  getAdminGuestConversation,
  getAdminGuestConversationDetail,
  listAdminGuestConversations,
  listAdminGuestSessions,
} from "../server/admin-guest-session-service.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";
import { readSourceBundle } from "./source-bundle.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "admin guest sessions self-check" });
const db = getDbPool();
const guestId = createId("guest_admin_check");
const chatSessionId = createId("chat_admin_check");
const userMessageId = createId("msg_admin_check");
const replyMessageId = createId("msg_admin_check");
const attachmentMessageId = createId("msg_admin_check");
const feedbackActionMessageId = createId("msg_admin_check");
const openingMessageId = createId("msg_admin_check");
const greetingImageMessageId = createId("msg_admin_check");
const callId = createId("call_admin_check");
const unrelatedMessageId = createId("msg_admin_check");
const marker = guestId.slice(-12);

try {
  const [[fixtureSource]] = await db.execute(
    `SELECT s.id AS site_id, c.id AS character_id
     FROM sites s
     INNER JOIN ai_characters c ON c.site_id = s.id AND c.category_id = 'mascot'
     WHERE s.site_status = 'active'
     ORDER BY s.is_default DESC, s.created_at ASC
     LIMIT 1`
  );
  assert.ok(fixtureSource?.site_id, "an active site is required");
  assert.ok(fixtureSource?.character_id, "an active site mascot is required");

  await db.execute(
    `INSERT INTO guest_sessions (
       id, token_hash, site_id, mascot_character_id, chat_session_id,
       session_status, message_window_started_at, message_window_count,
       last_ip, last_ip_region, last_ip_at, expires_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'active', NOW(3), 1, '203.0.113.10', '英国', NOW(3), DATE_ADD(NOW(3), INTERVAL 1 DAY), NOW(3), NOW(3))`,
    [guestId, `sha256:${marker.padEnd(64, "0")}`, fixtureSource.site_id, fixtureSource.character_id, chatSessionId]
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, guest_session_id, character_id, session_title,
       session_status, source_type, source_ref, last_message_at
     ) VALUES (?, NULL, ?, ?, 'Admin guest check', 'active', 'guest', ?, NOW(3))`,
    [chatSessionId, guestId, fixtureSource.character_id, guestId]
  );
  await db.execute(
    `INSERT INTO guest_character_sessions (
       guest_session_id, character_id, chat_session_id,
       message_window_started_at, message_window_count
     ) VALUES (?, ?, ?, NOW(3), 1)`,
    [guestId, fixtureSource.character_id, chatSessionId]
  );
  await db.execute("INSERT INTO guest_image_entitlements (guest_session_id) VALUES (?)", [guestId]);
  await db.execute(
    `INSERT INTO chat_messages (
       id, client_message_id, session_id, guest_session_id, character_id, sender_type, sender_label,
       content_type, text_content, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, ?, NULL, 'user', 'You', 'text', ?, 50, 'sent', 'guest', 'voice-asr', NOW(3))`,
    [userMessageId, `admin-check-${marker}`, chatSessionId, guestId, `admin guest ${marker}`]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, guest_session_id, character_id, sender_type, sender_label,
       content_type, text_content, product_payload_json, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, NULL, 'user', 'You', 'attachment', 'fixture.txt', JSON_OBJECT('name', 'fixture.txt'), 15, 'sent', 'guest', 'guest-attachment', DATE_SUB(NOW(3), INTERVAL 1 DAY))`,
    [attachmentMessageId, chatSessionId, guestId]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, guest_session_id, character_id, sender_type, sender_label,
       content_type, text_content, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, ?, 'character', 'Mascot', 'text', 'admin guest reply', 20, 'sent', 'ai', ?, DATE_SUB(NOW(3), INTERVAL 1 DAY))`,
    [replyMessageId, chatSessionId, guestId, fixtureSource.character_id, `guest-reply:${userMessageId}`]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, guest_session_id, character_id, sender_type, sender_label,
       content_type, text_content, product_payload_json, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, ?, 'character', 'Mascot', 'feedback_action', '', JSON_OBJECT('kind', 'feedback', 'label', 'Click here'), 25, 'sent', 'system', ?, DATE_SUB(NOW(3), INTERVAL 1 DAY))`,
    [feedbackActionMessageId, chatSessionId, guestId, fixtureSource.character_id, `feedback-action:${userMessageId}`]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, guest_session_id, character_id, sender_type, sender_label,
       content_type, text_content, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, ?, 'character', 'Mascot', 'text', 'admin opening line', 40, 'sent', 'system', 'opening-line', DATE_SUB(NOW(3), INTERVAL 2 MINUTE))`,
    [openingMessageId, chatSessionId, guestId, fixtureSource.character_id]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, guest_session_id, character_id, sender_type, sender_label,
       content_type, text_content, product_payload_json, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, ?, 'character', 'Mascot', 'mascot_greeting_image', '',
       JSON_OBJECT('imageId', 'admin-greeting-image', 'imageUrl', '/uploads/mascot-greetings/admin-order.webp', 'mediaType', 'image'),
       30, 'sent', 'system', 'mascot-greeting-image:admin-greeting-image', DATE_SUB(NOW(3), INTERVAL 1 MINUTE))`,
    [greetingImageMessageId, chatSessionId, guestId, fixtureSource.character_id]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, guest_session_id, character_id, sender_type, sender_label,
       content_type, text_content, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, NULL, ?, 'user', 'Formal user', 'text', 'must stay outside guest history', 30, 'sent', 'user', 'admin-check', NOW(3))`,
    [unrelatedMessageId, chatSessionId, fixtureSource.character_id]
  );
  await db.execute(
    `INSERT INTO guest_call_sessions (
       id, guest_session_id, site_id, character_id, network_hash, lease_token, call_status,
       duration_milliseconds, turn_count, started_at, last_accounted_at, ended_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, 'admin-check', 'ended', 12345, 2, NOW(3), NOW(3), NOW(3), DATE_ADD(NOW(3), INTERVAL 1 DAY))`,
    [callId, guestId, fixtureSource.site_id, fixtureSource.character_id, marker.padEnd(64, "a").slice(0, 64)]
  );

  const result = await listAdminGuestSessions({
    query: marker,
    site: fixtureSource.site_id,
    status: "active",
    page: 1,
    limit: 10,
  });
  assert.equal(result.ok, true);
  assert.equal(result.total, 1, "query, site and active status filters should isolate the fixture");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, guestId);
  assert.equal(result.items[0].userMessageCount, 2);
  assert.equal(result.items[0].quotaMessageCount, 1);
  assert.equal(result.items[0].voiceInputCount, 1);
  assert.equal(result.items[0].attachmentMessageCount, 1);
  assert.equal(result.items[0].callCount, 1);
  assert.equal(result.items[0].callDurationMilliseconds, 12345);
  assert.equal(result.items[0].callTurnCount, 2);
  assert.equal(result.items[0].imageEntitlementStatus, "available");
  assert.equal(result.items[0].lastIp, "203.0.113.10", "guest admin data should expose only the latest recorded IP");
  assert.equal(result.items[0].lastIpRegion, "英国", "guest admin data should expose the saved Chinese region name");
  assert.equal("tokenHash" in result.items[0], false, "token hash must never reach the admin response");
  assert.equal("token" in result.items[0], false, "raw guest token must never reach the admin response");
  assert.ok(Number(result.summary.totalGuestSessions) >= 1);
  assert.ok(Number(result.summary.guestSessionsWithUserMessages) >= 1, "guest summary should count sessions with user messages separately");
  assert.ok(Number(result.summary.validGuestSessions) >= 1);
  assert.ok(Number(result.summary.participatedToday) >= 1);

  const normalizedPaging = await listAdminGuestSessions({ page: "Infinity", limit: "not-a-number", query: marker });
  assert.equal(normalizedPaging.page, 1);
  assert.equal(normalizedPaging.limit, 10);

  const conversation = await getAdminGuestConversation(guestId);
  assert.equal(conversation.ok, true);
  assert.equal(conversation.item.id, chatSessionId);
  assert.equal(conversation.item.messages.length, 6);
  assert.equal(conversation.item.hasMore, false);
  assert.equal(conversation.item.messages[0].contentType, "attachment");
  assert.equal(conversation.item.messages[1].text, "admin guest reply");
  assert.equal(conversation.item.messages[2].contentType, "feedback_action");
  assert.equal(conversation.item.messages[3].contentType, "mascot_greeting_image", "admin guest conversation must honor display order when greeting media is inserted after its opening text");
  assert.equal(conversation.item.messages[4].text, "admin opening line");
  assert.equal(conversation.item.messages[5].text, `admin guest ${marker}`);
  assert.deepEqual(conversation.item.messages[2].feedbackAction, { kind: "feedback", label: "Click here" });

  const conversations = await listAdminGuestConversations(guestId);
  assert.equal(conversations.items.length, 2, "the same guest session should be split into one conversation segment per day with user messages");
  assert.match(conversations.items[0].id, new RegExp(`^${chatSessionId}::\\d{4}-\\d{2}-\\d{2}$`));
  assert.match(conversations.items[1].id, new RegExp(`^${chatSessionId}::\\d{4}-\\d{2}-\\d{2}$`));
  assert.notEqual(conversations.items[0].id, conversations.items[1].id);
  assert.equal(conversations.items[0].userMessageCount, 1);
  assert.equal(conversations.items[1].userMessageCount, 1);
  const conversationDetail = await getAdminGuestConversationDetail(guestId, chatSessionId);
  assert.equal(conversationDetail.item.messages.length, 6, "guest role detail should reuse the formal conversation payload");
  assert.equal(conversationDetail.item.messages[3].contentType, "mascot_greeting_image", "dated guest detail must use the same canonical display order");
  assert.equal(conversationDetail.item.messages[4].text, "admin opening line");
  assert.deepEqual(conversationDetail.item.messages[2].feedbackAction, { kind: "feedback", label: "Click here" });
  const priorDayConversation = await getAdminGuestConversationDetail(guestId, conversations.items[1].id);
  assert.equal(priorDayConversation.item.messages.length, 3, "a dated guest segment should open only that day's messages");
  assert.deepEqual(priorDayConversation.item.messages[2].feedbackAction, { kind: "feedback", label: "Click here" });

  // A delayed reply can land on a day without a new user message. Keep that
  // day selectable, while still hiding sessions that only received greetings.
  const delayedReplyId = createId("msg_admin_check");
  const earlierUserId = createId("msg_admin_check");
  const greetingOnlySessionId = createId("chat_admin_check");
  await db.execute(
    `INSERT INTO chat_messages (id, session_id, guest_session_id, sender_type, sender_label,
       content_type, text_content, display_order, delivery_status, source_type, source_ref, sent_at)
     VALUES (?, ?, ?, 'user', 'You', 'text', 'earlier image request', 1, 'sent', 'guest', 'admin-check', DATE_SUB(NOW(3), INTERVAL 3 DAY)),
            (?, ?, ?, 'character', 'Mascot', 'text', 'delayed image reply', 2, 'sent', 'ai', 'admin-check', DATE_SUB(NOW(3), INTERVAL 2 DAY))`,
    [earlierUserId, chatSessionId, guestId, delayedReplyId, chatSessionId, guestId]
  );
  try {
    await db.execute(
      `INSERT INTO chat_sessions (id, guest_session_id, character_id, session_title, session_status, source_type, last_message_at)
       VALUES (?, ?, ?, 'Greeting only', 'active', 'guest', NOW(3))`,
      [greetingOnlySessionId, guestId, fixtureSource.character_id]
    );
    await db.execute(
      `INSERT INTO chat_messages (id, session_id, guest_session_id, sender_type, sender_label,
         content_type, text_content, display_order, delivery_status, source_type, source_ref, sent_at)
       VALUES (?, ?, ?, 'character', 'Mascot', 'text', 'welcome only', 1, 'sent', 'system', 'opening-line', NOW(3))`,
      [createId("msg_admin_check"), greetingOnlySessionId, guestId]
    );
    const expanded = await listAdminGuestConversations(guestId);
    assert.equal(expanded.items.length, 4, "a delayed assistant-only day must remain selectable after user participation");
    assert.ok(expanded.items.every((item) => item.id.startsWith(`${chatSessionId}::`)), "greeting-only sessions must stay hidden");
    const delayedSegment = expanded.items.find((item) => item.userMessageCount === 0);
    assert.ok(delayedSegment, "include the day with only a delayed reply");
    const delayedDetail = await getAdminGuestConversationDetail(guestId, delayedSegment.id);
    assert.deepEqual(delayedDetail.item.messages.map((message) => message.id), [delayedReplyId]);
    const filtered = await listAdminGuestConversations(guestId, { query: 'Greeting only' });
    assert.equal(filtered.items.length, 0, "search must not expose greeting-only sessions");
    await assert.rejects(() => getAdminGuestConversationDetail(createId('guest_admin_check'), delayedSegment.id), /不存在/, "guest ownership must still be enforced");
    await db.execute(
      `INSERT INTO chat_messages (id, session_id, guest_session_id, sender_type, sender_label,
         content_type, text_content, display_order, delivery_status, source_type, source_ref, sent_at)
       VALUES (?, ?, ?, 'user', 'You', 'text', 'expired participation', 0, 'sent', 'guest', 'admin-check', DATE_SUB(NOW(3), INTERVAL 31 DAY))`,
      [createId("msg_admin_check"), greetingOnlySessionId, guestId]
    );
    const retained = await listAdminGuestConversations(guestId);
    assert.equal(retained.items.length, 4, "participation outside the retention window must not expose an assistant-only session");
  } finally {
    await db.execute("DELETE FROM chat_messages WHERE session_id = ?", [greetingOnlySessionId]);
    await db.execute("DELETE FROM chat_sessions WHERE id = ?", [greetingOnlySessionId]);
  }

  const guestServiceSource = readSourceBundle([
    "server/guest-chat-service.js",
    "server/guest-session-service.js",
  ]);
  const [routeSource, controllerSource, templateSource, conversationTemplateSource, switchSource] = await Promise.all([
    readFile(new URL("../server/admin-account-routes.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/admin-console/admin-accounts-controller.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/admin-console/admin-guest-sessions-template.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/admin-console/admin-console-accounts-template.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/admin-console/admin-account-management-switch.js", import.meta.url), "utf8"),
  ]);
  assert.match(routeSource, /\/api\/admin\/accounts\/guests/, "admin guest list route should exist");
  assert.match(routeSource, /requireAdmin\(req\)/, "admin guest reads should require admin access");
  assert.match(routeSource, /decodePathSegment/, "malformed guest path segments should be rejected safely");
  assert.match(controllerSource, /createAdminGuestSessionsController/, "account management should compose the guest controller");
  assert.match(switchSource, /data-account-management-view="\$\{value\}"/, "shared management switch should expose deterministic view values");
  assert.match(switchSource, /data-account-guest-conversation-count/, "guest card should render the user-message guest count separately from the total");
  assert.match(templateSource, /accountManagementSwitchHtml\("guests"/, "guest view should render the shared management switch");
  assert.match(templateSource, /data-guest-session-toggle/, "guest rows should support the existing inline detail interaction");
  assert.match(conversationTemplateSource, /conversationFeedbackActionHtml/, "reused conversation detail should visibly identify feedback actions");
  assert.doesNotMatch(conversationTemplateSource, /<small>\$\{escapeHtml\(detail\)\}<\/small>/, "admin conversation detail must not render internal feedback annotations");
  assert.match(conversationTemplateSource, /const grouped = conversations\.reduce/, "the existing admin conversation modal should keep grouping dated guest segments by character");
  assert.match(conversationTemplateSource, /\$\{list\.length\} 段/, "the existing admin conversation modal should show every returned guest date segment");
  assert.match(conversationTemplateSource, /list\.map\(\(item\) => conversationItemHtml\(item\)\)/, "the existing admin conversation modal should render every guest date segment as a selectable row");
  assert.match(templateSource, /最近 IP/, "guest inline detail should display the latest IP without changing the table layout");
  assert.doesNotMatch(templateSource, /guestAvatarHtml|class="acc-av"/, "guest account rows should not render an avatar");
  assert.match(templateSource, /实时通话/, "guest details should expose call usage in the existing detail layout");
  assert.match(
    guestServiceSource,
    /ensureOpeningMessageForSession\(db,\s*\{[\s\S]*?sessionId,\s*guestSessionId:\s*guestId,/,
    "guest opening lines should retain guest provenance"
  );

  console.log("admin guest sessions self-check passed");
} finally {
  await db.execute("DELETE FROM chat_messages WHERE session_id = ?", [chatSessionId]).catch(() => {});
  await db.execute("DELETE FROM guest_call_sessions WHERE guest_session_id = ?", [guestId]).catch(() => {});
  await db.execute("DELETE FROM guest_character_sessions WHERE guest_session_id = ?", [guestId]).catch(() => {});
  await db.execute("DELETE FROM guest_image_entitlements WHERE guest_session_id = ?", [guestId]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [chatSessionId]).catch(() => {});
  await db.execute("DELETE FROM guest_sessions WHERE id = ?", [guestId]).catch(() => {});
  await db.end();
}
