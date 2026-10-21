import { initializeDatabase, getDbPool } from "../server/db.js";
import { listPublicCharacters } from "../server/character-public-service.js";

await initializeDatabase();

const suffix = Date.now();
const userA = `u_card_metrics_a_${suffix}`;
const userB = `u_card_metrics_b_${suffix}`;
const characterId = `char_card_metrics_${suffix}`;
const sessionA = `chat_card_metrics_a_${suffix}`;
const sessionB = `chat_card_metrics_b_${suffix}`;

let exitCode = 0;

try {
  await seed();
  const result = await listPublicCharacters({});
  const mascotCategory = (result.categories || []).find((item) => String(item.id || item.label || "").toLowerCase() === "mascot");
  const mascotCharacter = (result.items || []).find((item) => String(item.category?.id || item.category?.label || "").toLowerCase() === "mascot");
  const character = (result.items || []).find((item) => item.id === characterId);
  const count = Number(character?.metrics?.userMessageCount || 0);
  const label = String(character?.metrics?.chatCountLabel || "");
  const activationCount = Number(character?.metrics?.activationCount || 0);
  const activationLabel = String(character?.metrics?.activationCountLabel || "");

  console.log(JSON.stringify({
    ok: count >= 3 && activationCount >= 2,
    metrics: character?.metrics || null,
  }, null, 2));

  if (count < 3) {
    exitCode = 1;
  }

  if (mascotCategory || mascotCharacter) {
    exitCode = 1;
  }

  if (!label || /96k/.test(label)) {
    exitCode = 1;
  }

  if (activationCount < 2 || activationLabel !== String(activationCount)) {
    exitCode = 1;
  }

  await assertDiscoverCardUsesActivationMetric();
} finally {
  await cleanup();
}

process.exit(exitCode);

async function seed() {
  const db = getDbPool();
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, slug, name, role_title, short_bio, avatar_url, opening_line,
       persona_prompt, speaking_style, tags_json, profile_json, metrics_json,
       visibility, character_status, source_type, source_ref, published_at
     ) VALUES (
       ?, 'fan', ?, 'Metrics Test Fan', 'Fan', 'Metrics self-check character.', 'assets/char_fan.png', 'Hey.',
       'Metrics self-check persona.', 'Casual.', JSON_ARRAY('self-check'), JSON_OBJECT('language', 'English'), JSON_OBJECT('chatCountLabel', '96k', 'ratingLabel', 'New'),
       'public', 'published', 'self-check', 'discover-card-metrics', NOW(3)
     )`,
    [characterId, `metrics-test-fan-${suffix}`]
  );

  await db.execute(
    `INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type)
     VALUES
     (?, ?, ?, ?, ?, 'active', 'personal'),
     (?, ?, ?, ?, ?, 'active', 'personal')`,
    [userA, userA, userA, "x", `${userA}@example.local`, userB, userB, userB, "x", `${userB}@example.local`]
  );

  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, character_id, session_title, session_status, source_type, source_ref, last_message_at
     ) VALUES
       (?, ?, ?, 'metrics check a', 'active', 'user', 'self-check', NOW(3)),
       (?, ?, ?, 'metrics check b', 'active', 'user', 'self-check', NOW(3))`,
    [sessionA, userA, characterId, sessionB, userB, characterId]
  );

  await db.execute(
    `INSERT INTO user_character_activations (
       id, internal_uid, character_id, activation_status, source_type, source_ref, activated_at
     ) VALUES
       (?, ?, ?, 'active', 'self-check', 'discover-metrics', NOW(3)),
       (?, ?, ?, 'active', 'self-check', 'discover-metrics', NOW(3))`,
    [`act_card_metrics_1_${suffix}`, userA, characterId, `act_card_metrics_2_${suffix}`, userB, characterId]
  );

  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES
       (?, ?, NULL, 'user', 'You', 'text', 'first user msg', 10, 'sent', 'user', 'self-check', NOW(3)),
       (?, ?, ?, 'character', 'Metrics Test Fan', 'text', 'first ai msg', 20, 'sent', 'ai', 'self-check', NOW(3)),
       (?, ?, NULL, 'user', 'You', 'text', 'second user msg', 30, 'sent', 'user', 'self-check', NOW(3)),
       (?, ?, NULL, 'user', 'You', 'text', 'third user msg', 10, 'sent', 'user', 'self-check', NOW(3)),
       (?, ?, ?, 'character', 'Metrics Test Fan', 'text', 'second ai msg', 20, 'sent', 'ai', 'self-check', NOW(3))`,
    [
      `msg_card_metrics_1_${suffix}`, sessionA,
      `msg_card_metrics_2_${suffix}`, sessionA, characterId,
      `msg_card_metrics_3_${suffix}`, sessionA,
      `msg_card_metrics_4_${suffix}`, sessionB,
      `msg_card_metrics_5_${suffix}`, sessionB, characterId,
    ]
  );
}

async function cleanup() {
  const db = getDbPool();
  await db.execute("DELETE FROM chat_sessions WHERE id IN (?, ?)", [sessionA, sessionB]).catch(() => {});
  await db.execute("DELETE FROM user_character_activations WHERE id IN (?, ?)", [`act_card_metrics_1_${suffix}`, `act_card_metrics_2_${suffix}`]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [characterId]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id IN (?, ?)", [userA, userB]).catch(() => {});
}

async function assertDiscoverCardUsesActivationMetric() {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/features/discover/discover-page.js", import.meta.url), "utf8");
  if (!/activationCountLabel/.test(source)) {
    throw new Error("discover character card should show activationCountLabel next to the star");
  }
  if (/ratingLabel/.test(source)) {
    throw new Error("discover character card should not show ratingLabel next to the star");
  }
  if (!/isMascotCharacter/.test(source) || !/isMascotCategory/.test(source)) {
    throw new Error("discover page should keep a client-side mascot filter");
  }
}
