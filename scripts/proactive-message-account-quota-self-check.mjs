import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import {
  getDeliveryDateForTimeZone,
  inspectAccountProactiveDeliveryGate,
  selectProactiveDeliveryCandidate,
} from "../server/proactive-message-delivery-service.js";

await initializeDatabase();

const suffix = Date.now();
const now = new Date("2026-06-29T10:00:00.000Z");
const timeZone = "UTC";
const deliveryDate = getDeliveryDateForTimeZone(now, timeZone);
const ids = buildIds(suffix);

try {
  await seed();

  const firstGate = await inspectAccountProactiveDeliveryGate(getDbPool(), {
    userId: ids.user,
    deliveryDate,
    timeZone,
    deliveryMode: "daily_required",
    slotIndex: 1,
    now,
  });
  assertEqual(firstGate.allowed, true, "first daily slot should be allowed when no delivery exists");

  const twoCandidateSelection = selectProactiveDeliveryCandidate({
    userId: ids.user,
    deliveryDate,
    slotIndex: 2,
    candidates: [
      { characterId: ids.characters.creatorA, sessionId: ids.sessions.creatorA },
      { characterId: ids.characters.creatorB, sessionId: ids.sessions.creatorB },
    ],
    eligibleCharacterIds: [ids.characters.creatorA, ids.characters.creatorB],
    lastCharacterId: ids.characters.creatorA,
    historicalCounts: {
      [ids.characters.creatorA]: 5,
      [ids.characters.creatorB]: 1,
    },
  });
  assertEqual(twoCandidateSelection?.characterId, ids.characters.creatorB, "two candidates should rotate away from previous character");

  const threeCandidateSelection = selectProactiveDeliveryCandidate({
    userId: ids.user,
    deliveryDate,
    slotIndex: 2,
    candidates: [
      { characterId: ids.characters.creatorA, sessionId: ids.sessions.creatorA },
      { characterId: ids.characters.creatorB, sessionId: ids.sessions.creatorB },
      { characterId: ids.characters.mascotC, sessionId: ids.sessions.mascotC },
    ],
    eligibleCharacterIds: [ids.characters.creatorB, ids.characters.mascotC],
    lastCharacterId: ids.characters.creatorA,
    historicalCounts: {
      [ids.characters.creatorA]: 9,
      [ids.characters.creatorB]: 3,
      [ids.characters.mascotC]: 1,
    },
  });
  assertEqual(threeCandidateSelection?.characterId, ids.characters.mascotC, "three candidates should prefer lower historical send count after excluding previous character");

  await insertSentProactiveDelivery({
    deliveryId: ids.deliveries.first,
    characterId: ids.characters.creatorA,
    sessionId: ids.sessions.creatorA,
    messageId: ids.messages.firstProactive,
    slotIndex: 1,
  });
  const secondGateBeforeReply = await inspectAccountProactiveDeliveryGate(getDbPool(), {
    userId: ids.user,
    deliveryDate,
    timeZone,
    deliveryMode: "idle_followup",
    slotIndex: 2,
    now,
  });
  assertEqual(secondGateBeforeReply.allowed, false, "second slot should be blocked before the user replies");
  assertEqual(secondGateBeforeReply.reason, "previous_proactive_unanswered", "second slot should wait for a user reply");

  await insertUserReply(ids.messages.replyAfterFirst, ids.sessions.creatorA, ids.characters.creatorA, 20, now);
  const secondGateAfterReply = await inspectAccountProactiveDeliveryGate(getDbPool(), {
    userId: ids.user,
    deliveryDate,
    timeZone,
    deliveryMode: "idle_followup",
    slotIndex: 2,
    now,
  });
  assertEqual(secondGateAfterReply.allowed, true, "second slot should be allowed after the user replies");

  await insertSentProactiveDelivery({
    deliveryId: ids.deliveries.second,
    characterId: ids.characters.creatorB,
    sessionId: ids.sessions.creatorB,
    messageId: ids.messages.secondProactive,
    slotIndex: 2,
  });
  const quotaGate = await inspectAccountProactiveDeliveryGate(getDbPool(), {
    userId: ids.user,
    deliveryDate,
    timeZone,
    deliveryMode: "idle_followup",
    slotIndex: 2,
    now,
  });
  assertEqual(quotaGate.allowed, false, "third proactive send should be blocked by account daily quota");
  assertEqual(quotaGate.reason, "daily_quota_reached", "third proactive send should report daily quota reached");

  console.log(JSON.stringify({
    ok: true,
    deliveryDate,
    firstGate,
    secondGateBeforeReply,
    secondGateAfterReply,
    quotaGate,
    twoCandidateSelection,
    threeCandidateSelection,
  }, null, 2));
} finally {
  await cleanup();
  await closeDbPool();
}

async function seed() {
  const db = getDbPool();
  await db.execute(
    `INSERT INTO sites (id, name, slug, site_url, default_language, currency, time_zone, site_status, is_default, mascot_character_id, product_api_url, description)
     VALUES (?, 'Account Quota Site', ?, '', 'English', 'USD', ?, 'active', 0, NULL, '', 'proactive account quota self-check')`,
    [ids.site, `account-quota-${suffix}`, timeZone]
  );
  await db.execute(
    `INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type, site_id)
     VALUES (?, ?, ?, 'x', ?, 'active', 'personal', ?)`,
    [ids.user, ids.user, ids.user, `${ids.user}@example.local`, ids.site]
  );

  await insertCharacter(ids.characters.creatorA, "creator", "Quota Creator A");
  await insertCharacter(ids.characters.creatorB, "creator", "Quota Creator B");
  await insertCharacter(ids.characters.mascotC, "mascot", "Quota Mascot C");

  await insertActivation(ids.activations.creatorA, ids.characters.creatorA);
  await insertActivation(ids.activations.creatorB, ids.characters.creatorB);
  await insertActivation(ids.activations.mascotC, ids.characters.mascotC);

  await insertSession(ids.sessions.creatorA, ids.characters.creatorA);
  await insertSession(ids.sessions.creatorB, ids.characters.creatorB);
  await insertSession(ids.sessions.mascotC, ids.characters.mascotC);

  await insertCharacterMessage(ids.messages.seedA, ids.sessions.creatorA, ids.characters.creatorA, "Seed A", 10, new Date("2026-06-29T04:00:00.000Z"));
  await insertCharacterMessage(ids.messages.seedB, ids.sessions.creatorB, ids.characters.creatorB, "Seed B", 10, new Date("2026-06-29T03:00:00.000Z"));
  await insertCharacterMessage(ids.messages.seedC, ids.sessions.mascotC, ids.characters.mascotC, "Seed C", 10, new Date("2026-06-29T02:00:00.000Z"));
}

async function insertCharacter(id, categoryId, name) {
  await getDbPool().execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, tags_json, profile_json, metrics_json,
       visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, ?, NULL, ?, ?, ?, 'Self Check', 'self-check', 'assets/char_fan.png', 'assets/banner_hero.png',
       'hello', 'self-check prompt', 'friendly', JSON_ARRAY('self-check'), JSON_OBJECT(), JSON_OBJECT(),
       'public', 'published', 'self-check', 'proactive-account-quota-self-check', NOW(3))`,
    [id, categoryId, ids.site, `${id}-slug`, name]
  );
}

async function insertActivation(id, characterId) {
  await getDbPool().execute(
    `INSERT INTO user_character_activations (
       id, internal_uid, character_id, activation_status, source_type, source_ref, activated_at
     ) VALUES (?, ?, ?, 'active', 'self-check', 'proactive-account-quota-self-check', NOW(3))`,
    [id, ids.user, characterId]
  );
}

async function insertSession(id, characterId) {
  await getDbPool().execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at
     ) VALUES (?, ?, ?, 'account quota self-check', 'active', 'user', 'proactive-account-quota-self-check', 'English', DATE_SUB(?, INTERVAL 6 HOUR))`,
    [id, ids.user, characterId, now]
  );
}

async function insertCharacterMessage(id, sessionId, characterId, text, displayOrder, sentAt) {
  await getDbPool().execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, 'character', 'Quota Self Check', 'text', ?, ?, 'sent', 'ai', 'self-check', ?)`,
    [id, sessionId, characterId, text, displayOrder, sentAt]
  );
}

async function insertUserReply(id, sessionId, characterId, displayOrder, sentAt) {
  await getDbPool().execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, 'user', 'You', 'text', 'reply', ?, 'sent', 'user', 'self-check-reply', ?)`,
    [id, sessionId, characterId, displayOrder, sentAt]
  );
}

async function insertSentProactiveDelivery({
  deliveryId,
  characterId,
  sessionId,
  messageId,
  slotIndex,
} = {}) {
  await insertCharacterMessage(
    messageId,
    sessionId,
    characterId,
    `Proactive slot ${slotIndex}`,
    slotIndex === 1 ? 15 : 30,
    now
  );
  await getDbPool().execute(
    `INSERT INTO proactive_message_deliveries (
       id, internal_uid, site_id, character_id, session_id, message_id, delivery_date,
       delivery_status, source_type, source_ref, campaign_id, slot_index, sent_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', 'proactive_nudge', 'proactive-nudge', NULL, ?, ?)`,
    [deliveryId, ids.user, ids.site, characterId, sessionId, messageId, deliveryDate, slotIndex, now]
  );
}

async function cleanup() {
  const db = getDbPool();
  await db.execute("DELETE FROM proactive_message_deliveries WHERE internal_uid = ?", [ids.user]).catch(() => {});
  await db.execute("DELETE FROM chat_messages WHERE session_id IN (?, ?, ?)", Object.values(ids.sessions)).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id IN (?, ?, ?)", Object.values(ids.sessions)).catch(() => {});
  await db.execute("DELETE FROM user_character_activations WHERE id IN (?, ?, ?)", Object.values(ids.activations)).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id IN (?, ?, ?)", Object.values(ids.characters)).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [ids.user]).catch(() => {});
  await db.execute("DELETE FROM sites WHERE id = ?", [ids.site]).catch(() => {});
}

function buildIds(value) {
  return {
    site: `site_proactive_account_${value}`,
    user: `u_proactive_account_${value}`,
    characters: {
      creatorA: `creator_account_a_${value}`,
      creatorB: `creator_account_b_${value}`,
      mascotC: `mascot_account_c_${value}`,
    },
    activations: {
      creatorA: `activation_account_a_${value}`,
      creatorB: `activation_account_b_${value}`,
      mascotC: `activation_account_c_${value}`,
    },
    sessions: {
      creatorA: `chat_account_a_${value}`,
      creatorB: `chat_account_b_${value}`,
      mascotC: `chat_account_c_${value}`,
    },
    messages: {
      seedA: `msg_account_seed_a_${value}`,
      seedB: `msg_account_seed_b_${value}`,
      seedC: `msg_account_seed_c_${value}`,
      firstProactive: `msg_account_proactive_first_${value}`,
      replyAfterFirst: `msg_account_reply_${value}`,
      secondProactive: `msg_account_proactive_second_${value}`,
    },
    deliveries: {
      first: `delivery_account_first_${value}`,
      second: `delivery_account_second_${value}`,
    },
  };
}

function assertEqual(actual, expected, message) {
  if (actual === expected) return;
  throw new Error(`${message}: expected ${expected}, received ${actual}`);
}
