import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { MEMORY_JOB_TYPES } from "../server/memory-job-service.js";
import { scanAndEnqueueProactiveMessages } from "../server/proactive-message-scheduler-service.js";

await initializeDatabase();

const suffix = Date.now();
const now = new Date("2026-06-29T02:15:00.000Z");
const deliveryDateUtc = "2026-06-29";
const deliveryDateShanghai = "2026-06-29";
const ids = buildIds(suffix);
let scopedJobs = [];

try {
  await seed();

  const result = await scanAndEnqueueProactiveMessages({
    now,
    batchSize: 20,
  });
  const jobs = await listScopedJobs();

  const dailyRequiredJob = jobs.find((job) => job.internal_uid === ids.users.dailyRequired);
  const rotationJob = jobs.find((job) => job.internal_uid === ids.users.repliedRotation);
  const quietJob = jobs.find((job) => job.internal_uid === ids.users.quietIdle);

  assertEqual(result.enqueuedCount, 3, "scheduler should enqueue exactly three account-level jobs");
  assertEqual(Boolean(dailyRequiredJob), true, "account with no proactive today should enqueue first daily slot");
  assertEqual(readPayload(dailyRequiredJob).deliveryMode, "daily_required", "first daily job should use daily_required mode");
  assertEqual(readPayload(dailyRequiredJob).slotIndex, 1, "first daily job should claim slot 1");

  assertEqual(Boolean(rotationJob), true, "replied account should enqueue a second proactive slot");
  assertEqual(readPayload(rotationJob).deliveryMode, "idle_followup", "second job should use idle_followup mode");
  assertEqual(readPayload(rotationJob).slotIndex, 2, "second job should claim slot 2");
  assertEqual(rotationJob.character_id, ids.characters.rotationMascot, "second job should rotate away from the previous creator character");

  assertEqual(Boolean(quietJob), true, "quiet-hours account should still enqueue a deferred second slot");
  assertEqual(new Date(quietJob.available_at).getTime() > now.getTime(), true, "quiet-hours job should be deferred into the morning");

  assertEqual(jobExists(ids.users.maxedTwoToday), false, "account already at two deliveries should not enqueue a third job");
  assertEqual(jobExists(ids.users.unansweredToday), false, "account without a reply after the last proactive should not enqueue slot two");
  assertEqual(jobExists(ids.users.commonOnly), false, "non mascot/creator characters should never enqueue");
  assertEqual(countJobs(ids.users.duplicateQueued), 1, "existing queued proactive job should block duplicate enqueue");

  console.log(JSON.stringify({
    ok: true,
    result,
    scopedJobCount: jobs.length,
  }, null, 2));
} finally {
  await cleanup();
  await closeDbPool();
}

function readPayload(job) {
  return typeof job.payload_json === "string" ? JSON.parse(job.payload_json) : job.payload_json || {};
}

function jobExists(userId) {
  return scopedJobs.some((job) => job.internal_uid === userId);
}

function countJobs(userId) {
  return scopedJobs.filter((job) => job.internal_uid === userId).length;
}

async function listScopedJobs() {
  const [rows] = await getDbPool().execute(
    `SELECT id, internal_uid, character_id, session_id, available_at, payload_json
     FROM memory_jobs
     WHERE internal_uid IN (?, ?, ?, ?, ?, ?, ?)
     ORDER BY created_at ASC`,
    Object.values(ids.users)
  );
  scopedJobs = rows;
  return rows;
}

async function seed() {
  const db = getDbPool();
  await db.execute(
    `INSERT INTO character_categories (id, label, description, avatar_url, display_order, source_type, source_ref)
     VALUES (?, 'Scheduler Common', 'self-check', 'assets/char_coach.png', 999, 'self-check', 'proactive-scheduler')
     ON DUPLICATE KEY UPDATE label = VALUES(label), updated_at = CURRENT_TIMESTAMP(3)`,
    [ids.commonCategoryId]
  );

  await insertSite(ids.sites.day, `scheduler-day-${suffix}`, "Asia/Shanghai");
  await insertSite(ids.sites.quiet, `scheduler-quiet-${suffix}`, "UTC");

  await insertCharacter(ids.characters.creatorPrimary, "creator", "Rotation Creator", ids.sites.day);
  await insertCharacter(ids.characters.rotationMascot, "mascot", "Rotation Mascot", ids.sites.day);
  await insertCharacter(ids.characters.dailyCreator, "creator", "Daily Creator", ids.sites.day);
  await insertCharacter(ids.characters.maxCreator, "creator", "Max Creator", ids.sites.day);
  await insertCharacter(ids.characters.unansweredCreator, "creator", "Unanswered Creator", ids.sites.day);
  await insertCharacter(ids.characters.duplicateCreator, "creator", "Duplicate Creator", ids.sites.day);
  await insertCharacter(ids.characters.quietMascot, "mascot", "Quiet Mascot", ids.sites.quiet);
  await insertCharacter(ids.characters.common, ids.commonCategoryId, "Common Character", ids.sites.day);

  await insertUser(ids.users.dailyRequired, ids.sites.day);
  await insertUser(ids.users.maxedTwoToday, ids.sites.day);
  await insertUser(ids.users.unansweredToday, ids.sites.day);
  await insertUser(ids.users.repliedRotation, ids.sites.day);
  await insertUser(ids.users.commonOnly, ids.sites.day);
  await insertUser(ids.users.duplicateQueued, ids.sites.day);
  await insertUser(ids.users.quietIdle, ids.sites.quiet);

  await insertActivation(ids.activations.dailyRequired, ids.users.dailyRequired, ids.characters.dailyCreator);
  await insertActivation(ids.activations.maxedTwoToday, ids.users.maxedTwoToday, ids.characters.maxCreator);
  await insertActivation(ids.activations.unansweredToday, ids.users.unansweredToday, ids.characters.unansweredCreator);
  await insertActivation(ids.activations.rotationCreator, ids.users.repliedRotation, ids.characters.creatorPrimary);
  await insertActivation(ids.activations.rotationMascot, ids.users.repliedRotation, ids.characters.rotationMascot);
  await insertActivation(ids.activations.commonOnly, ids.users.commonOnly, ids.characters.common);
  await insertActivation(ids.activations.duplicateQueued, ids.users.duplicateQueued, ids.characters.duplicateCreator);
  await insertActivation(ids.activations.quietIdle, ids.users.quietIdle, ids.characters.quietMascot);

  await insertSession(ids.sessions.dailyRequired, ids.users.dailyRequired, ids.characters.dailyCreator, 1);
  await insertSession(ids.sessions.maxedTwoToday, ids.users.maxedTwoToday, ids.characters.maxCreator, 7);
  await insertSession(ids.sessions.unansweredToday, ids.users.unansweredToday, ids.characters.unansweredCreator, 7);
  await insertSession(ids.sessions.rotationCreator, ids.users.repliedRotation, ids.characters.creatorPrimary, 7);
  await insertSession(ids.sessions.rotationMascot, ids.users.repliedRotation, ids.characters.rotationMascot, 7);
  await insertSession(ids.sessions.commonOnly, ids.users.commonOnly, ids.characters.common, 7);
  await insertSession(ids.sessions.duplicateQueued, ids.users.duplicateQueued, ids.characters.duplicateCreator, 7);
  await insertSession(ids.sessions.quietIdle, ids.users.quietIdle, ids.characters.quietMascot, 7);

  await insertCharacterMessage(ids.messages.dailyRequiredSeed, ids.sessions.dailyRequired, ids.characters.dailyCreator, "recent chat", 10, subtractHours(now, 1), "openai-responses");
  await insertCharacterMessage(ids.messages.maxedSeed, ids.sessions.maxedTwoToday, ids.characters.maxCreator, "old chat", 10, subtractHours(now, 7), "openai-responses");
  await insertCharacterMessage(ids.messages.unansweredSeed, ids.sessions.unansweredToday, ids.characters.unansweredCreator, "old chat", 10, subtractHours(now, 7), "openai-responses");
  await insertCharacterMessage(ids.messages.rotationSeedCreator, ids.sessions.rotationCreator, ids.characters.creatorPrimary, "rotation creator seed", 10, subtractHours(now, 7), "openai-responses");
  await insertCharacterMessage(ids.messages.rotationSeedMascot, ids.sessions.rotationMascot, ids.characters.rotationMascot, "rotation mascot seed", 10, subtractHours(now, 7), "openai-responses");
  await insertCharacterMessage(ids.messages.commonSeed, ids.sessions.commonOnly, ids.characters.common, "common seed", 10, subtractHours(now, 7), "openai-responses");
  await insertCharacterMessage(ids.messages.duplicateSeed, ids.sessions.duplicateQueued, ids.characters.duplicateCreator, "duplicate seed", 10, subtractHours(now, 7), "openai-responses");
  await insertCharacterMessage(ids.messages.quietSeed, ids.sessions.quietIdle, ids.characters.quietMascot, "quiet seed", 10, subtractHours(now, 7), "openai-responses");

  await insertSentDelivery(ids.deliveries.maxedFirst, ids.users.maxedTwoToday, ids.sites.day, ids.characters.maxCreator, ids.sessions.maxedTwoToday, ids.messages.maxedFirst, 1, subtractHours(now, 3));
  await insertUserReply(ids.messages.maxedReply, ids.sessions.maxedTwoToday, ids.characters.maxCreator, 20, subtractHours(now, 2));
  await insertSentDelivery(ids.deliveries.maxedSecond, ids.users.maxedTwoToday, ids.sites.day, ids.characters.maxCreator, ids.sessions.maxedTwoToday, ids.messages.maxedSecond, 2, subtractHours(now, 1));

  await insertSentDelivery(ids.deliveries.unansweredFirst, ids.users.unansweredToday, ids.sites.day, ids.characters.unansweredCreator, ids.sessions.unansweredToday, ids.messages.unansweredFirst, 1, subtractHours(now, 3));

  await insertSentDelivery(ids.deliveries.rotationFirst, ids.users.repliedRotation, ids.sites.day, ids.characters.creatorPrimary, ids.sessions.rotationCreator, ids.messages.rotationFirst, 1, subtractHours(now, 3));
  await insertUserReply(ids.messages.rotationReply, ids.sessions.rotationCreator, ids.characters.creatorPrimary, 20, subtractHours(now, 2));

  await insertSentDelivery(ids.deliveries.quietFirst, ids.users.quietIdle, ids.sites.quiet, ids.characters.quietMascot, ids.sessions.quietIdle, ids.messages.quietFirst, 1, subtractHours(now, 7));
  await insertUserReply(ids.messages.quietReply, ids.sessions.quietIdle, ids.characters.quietMascot, 20, subtractHours(now, 6));

  await db.execute(
    `INSERT INTO memory_jobs (
       id, internal_uid, character_id, session_id, job_type, job_status, priority,
       available_at, retry_count, max_retries, payload_json
     ) VALUES (?, ?, ?, ?, ?, 'queued', 80, ?, 0, 0, JSON_OBJECT('source', 'self-check-existing'))`,
    [
      ids.jobs.existingDuplicate,
      ids.users.duplicateQueued,
      ids.characters.duplicateCreator,
      ids.sessions.duplicateQueued,
      MEMORY_JOB_TYPES.SEND_PROACTIVE_MESSAGE,
      subtractHours(now, 1),
    ]
  );
}

async function insertSite(id, slug, timeZone) {
  await getDbPool().execute(
    `INSERT INTO sites (id, name, slug, site_url, default_language, currency, time_zone, site_status, is_default, mascot_character_id, product_api_url, description)
     VALUES (?, 'Scheduler Site', ?, '', 'English', 'USD', ?, 'active', 0, NULL, '', 'proactive scheduler self-check')`,
    [id, slug, timeZone]
  );
}

async function insertCharacter(id, categoryId, name, siteId) {
  await getDbPool().execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, tags_json, profile_json, metrics_json,
       visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, ?, NULL, ?, ?, ?, 'Self Check', 'self-check', 'assets/char_fan.png', 'assets/banner_hero.png',
       'hello', 'self-check prompt', 'friendly', JSON_ARRAY('self-check'), JSON_OBJECT(), JSON_OBJECT(),
       'public', 'published', 'self-check', 'proactive-scheduler-self-check', NOW(3))`,
    [id, categoryId, siteId, `${id}-slug`, name]
  );
}

async function insertUser(id, siteId) {
  await getDbPool().execute(
    `INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type, site_id)
     VALUES (?, ?, ?, 'x', ?, 'active', 'personal', ?)`,
    [id, id, id, `${id}@example.local`, siteId]
  );
}

async function insertActivation(id, userId, characterId) {
  await getDbPool().execute(
    `INSERT INTO user_character_activations (
       id, internal_uid, character_id, activation_status, source_type, source_ref, activated_at
     ) VALUES (?, ?, ?, 'active', 'self-check', 'proactive-scheduler-self-check', NOW(3))`,
    [id, userId, characterId]
  );
}

async function insertSession(id, userId, characterId, idleHours) {
  await getDbPool().execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at
     ) VALUES (?, ?, ?, 'scheduler self-check', 'active', 'user', 'proactive-scheduler-self-check', 'English', DATE_SUB(?, INTERVAL ? HOUR))`,
    [id, userId, characterId, now, idleHours]
  );
}

async function insertCharacterMessage(id, sessionId, characterId, text, displayOrder, sentAt, sourceRef) {
  await getDbPool().execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, 'character', 'Scheduler Self Check', 'text', ?, ?, 'sent', 'ai', ?, ?)`,
    [id, sessionId, characterId, text, displayOrder, sourceRef, sentAt]
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

async function insertSentDelivery(deliveryId, userId, siteId, characterId, sessionId, messageId, slotIndex, sentAt) {
  await insertCharacterMessage(
    messageId,
    sessionId,
    characterId,
    `sent slot ${slotIndex}`,
    slotIndex === 1 ? 15 : 30,
    sentAt,
    "proactive-nudge"
  );
  await getDbPool().execute(
    `INSERT INTO proactive_message_deliveries (
       id, internal_uid, site_id, character_id, session_id, message_id, delivery_date,
       delivery_status, source_type, source_ref, campaign_id, slot_index, sent_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', 'proactive_nudge', 'proactive-nudge', NULL, ?, ?)`,
    [deliveryId, userId, siteId, characterId, sessionId, messageId, siteId === ids.sites.quiet ? deliveryDateUtc : deliveryDateShanghai, slotIndex, sentAt]
  );
}

async function cleanup() {
  const db = getDbPool();
  await db.execute("DELETE FROM memory_jobs WHERE internal_uid IN (?, ?, ?, ?, ?, ?, ?)", Object.values(ids.users)).catch(() => {});
  await db.execute("DELETE FROM proactive_message_deliveries WHERE internal_uid IN (?, ?, ?, ?, ?, ?, ?)", Object.values(ids.users)).catch(() => {});
  await db.execute("DELETE FROM chat_messages WHERE session_id IN (?, ?, ?, ?, ?, ?, ?, ?)", Object.values(ids.sessions)).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id IN (?, ?, ?, ?, ?, ?, ?, ?)", Object.values(ids.sessions)).catch(() => {});
  await db.execute("DELETE FROM user_character_activations WHERE id IN (?, ?, ?, ?, ?, ?, ?, ?)", Object.values(ids.activations)).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id IN (?, ?, ?, ?, ?, ?, ?, ?)", Object.values(ids.characters)).catch(() => {});
  await db.execute("DELETE FROM users WHERE id IN (?, ?, ?, ?, ?, ?, ?)", Object.values(ids.users)).catch(() => {});
  await db.execute("DELETE FROM character_categories WHERE id = ?", [ids.commonCategoryId]).catch(() => {});
  await db.execute("DELETE FROM sites WHERE id IN (?, ?)", [ids.sites.day, ids.sites.quiet]).catch(() => {});
}

function subtractHours(base, hours) {
  return new Date(base.getTime() - Number(hours || 0) * 60 * 60 * 1000);
}

function buildIds(value) {
  return {
    commonCategoryId: `category_scheduler_common_${value}`,
    sites: {
      day: `site_scheduler_day_${value}`,
      quiet: `site_scheduler_quiet_${value}`,
    },
    users: {
      dailyRequired: `u_scheduler_daily_${value}`,
      maxedTwoToday: `u_scheduler_maxed_${value}`,
      unansweredToday: `u_scheduler_unanswered_${value}`,
      repliedRotation: `u_scheduler_rotation_${value}`,
      commonOnly: `u_scheduler_common_${value}`,
      duplicateQueued: `u_scheduler_duplicate_${value}`,
      quietIdle: `u_scheduler_quiet_${value}`,
    },
    characters: {
      dailyCreator: `creator_scheduler_daily_${value}`,
      maxCreator: `creator_scheduler_max_${value}`,
      unansweredCreator: `creator_scheduler_unanswered_${value}`,
      creatorPrimary: `creator_scheduler_rotation_${value}`,
      rotationMascot: `mascot_scheduler_rotation_${value}`,
      common: `common_scheduler_${value}`,
      duplicateCreator: `creator_scheduler_duplicate_${value}`,
      quietMascot: `mascot_scheduler_quiet_${value}`,
    },
    activations: {
      dailyRequired: `activation_scheduler_daily_${value}`,
      maxedTwoToday: `activation_scheduler_max_${value}`,
      unansweredToday: `activation_scheduler_unanswered_${value}`,
      rotationCreator: `activation_scheduler_rotation_creator_${value}`,
      rotationMascot: `activation_scheduler_rotation_mascot_${value}`,
      commonOnly: `activation_scheduler_common_${value}`,
      duplicateQueued: `activation_scheduler_duplicate_${value}`,
      quietIdle: `activation_scheduler_quiet_${value}`,
    },
    sessions: {
      dailyRequired: `chat_scheduler_daily_${value}`,
      maxedTwoToday: `chat_scheduler_max_${value}`,
      unansweredToday: `chat_scheduler_unanswered_${value}`,
      rotationCreator: `chat_scheduler_rotation_creator_${value}`,
      rotationMascot: `chat_scheduler_rotation_mascot_${value}`,
      commonOnly: `chat_scheduler_common_${value}`,
      duplicateQueued: `chat_scheduler_duplicate_${value}`,
      quietIdle: `chat_scheduler_quiet_${value}`,
    },
    messages: {
      dailyRequiredSeed: `msg_scheduler_daily_seed_${value}`,
      maxedSeed: `msg_scheduler_max_seed_${value}`,
      maxedFirst: `msg_scheduler_max_first_${value}`,
      maxedReply: `msg_scheduler_max_reply_${value}`,
      maxedSecond: `msg_scheduler_max_second_${value}`,
      unansweredSeed: `msg_scheduler_unanswered_seed_${value}`,
      unansweredFirst: `msg_scheduler_unanswered_first_${value}`,
      rotationSeedCreator: `msg_scheduler_rotation_creator_seed_${value}`,
      rotationSeedMascot: `msg_scheduler_rotation_mascot_seed_${value}`,
      rotationFirst: `msg_scheduler_rotation_first_${value}`,
      rotationReply: `msg_scheduler_rotation_reply_${value}`,
      commonSeed: `msg_scheduler_common_seed_${value}`,
      duplicateSeed: `msg_scheduler_duplicate_seed_${value}`,
      quietSeed: `msg_scheduler_quiet_seed_${value}`,
      quietFirst: `msg_scheduler_quiet_first_${value}`,
      quietReply: `msg_scheduler_quiet_reply_${value}`,
    },
    deliveries: {
      maxedFirst: `delivery_scheduler_max_first_${value}`,
      maxedSecond: `delivery_scheduler_max_second_${value}`,
      unansweredFirst: `delivery_scheduler_unanswered_${value}`,
      rotationFirst: `delivery_scheduler_rotation_${value}`,
      quietFirst: `delivery_scheduler_quiet_${value}`,
    },
    jobs: {
      existingDuplicate: `mem_job_scheduler_existing_${value}`,
    },
  };
}

function assertEqual(actual, expected, message) {
  if (actual === expected) return;
  throw new Error(`${message}: expected ${expected}, received ${actual}`);
}
