import { initializeDatabase, getDbPool } from "../server/db.js";
import { MEMORY_JOB_TYPES, enqueueMemoryJob, listMemoryJobs } from "../server/memory-job-service.js";
import { runMemoryJobBatch } from "../server/memory-job-runner-service.js";

const phase = String(process.argv[2] || "all").trim().toLowerCase();

await initializeDatabase();

if (phase === "cleanup") {
  await cleanupSelfCheckData();
  process.exit(0);
}

if (phase === "phase1" || phase === "all") {
  await checkPhase1();
}

if (phase === "phase2" || phase === "all") {
  await checkPhase2();
}

if (phase === "phase3" || phase === "all") {
  await checkPhase3();
}

if (phase === "phase4" || phase === "all") {
  await checkPhase4();
}

if (phase === "phase5" || phase === "all") {
  await checkPhase5();
}

process.exit(0);

async function checkPhase1() {
  const jobId = await enqueueMemoryJob({
    jobType: MEMORY_JOB_TYPES.NOOP,
    priority: 1,
    payload: { selfCheck: "phase1" },
    maxRetries: 0,
  });
  await runMemoryJobBatch();
  const jobs = await listMemoryJobs({ limit: 10 });
  const job = jobs.find((item) => item.id === jobId);
  const result = {
    phase: "phase1",
    jobId,
    status: job?.jobStatus,
    completed: job?.jobStatus === "completed",
  };
  printResult(result);
  assert(result.completed, "phase1 noop job did not complete");
}

async function checkPhase2() {
  const db = getDbPool();
  const suffix = Date.now();
  const userId = `u_mem_cleanup_${suffix}`;
  const sessionId = `chat_mem_cleanup_${suffix}`;
  const oldMsgId = `msg_mem_cleanup_old_${suffix}`;
  const freshMsgId = `msg_mem_cleanup_fresh_${suffix}`;
  const oldMsgAt = daysAgo(181);
  const freshMsgAt = daysAgo(5);
  const oldDay = daysAgo(50);
  const oldWeek = daysAgo(130);
  const oldMonth = daysAgo(400);
  const freshDay = daysAgo(10);

  await db.execute(
    `INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type)
     VALUES (?, ?, ?, ?, ?, 'active', 'personal')`,
    [userId, userId, userId, "x", `${userId}@example.local`]
  );

  try {
    await db.execute(
      `INSERT INTO chat_sessions (
         id, internal_uid, character_id, session_title, session_status, source_type, source_ref, last_message_at
       ) VALUES (?, ?, 'fan', 'cleanup self check', 'active', 'user', 'cleanup-self-check', NOW(3))`,
      [sessionId, userId]
    );
    await db.execute(
      `INSERT INTO chat_messages (
         id, session_id, character_id, sender_type, sender_label, content_type, text_content,
         display_order, delivery_status, source_type, source_ref, sent_at
       ) VALUES
         (?, ?, NULL, 'user', 'You', 'text', 'old cleanup message', 10, 'sent', 'user', 'cleanup-self-check', ?),
         (?, ?, NULL, 'user', 'You', 'text', 'fresh cleanup message', 20, 'sent', 'user', 'cleanup-self-check', ?)`,
      [oldMsgId, sessionId, oldMsgAt, freshMsgId, sessionId, freshMsgAt]
    );
    await db.execute(
      `INSERT INTO chat_message_index (
         message_id, session_id, internal_uid, character_id, sender_type, content_type, text_preview,
         keywords_json, topics_json, entities_json, emotion_tags_json, intent_tags_json, importance_score, retrieval_weight
       ) VALUES
         (?, ?, ?, 'fan', 'user', 'text', 'old cleanup message', JSON_ARRAY('old'), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), 50, 50),
         (?, ?, ?, 'fan', 'user', 'text', 'fresh cleanup message', JSON_ARRAY('fresh'), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), 50, 50)`,
      [oldMsgId, sessionId, userId, freshMsgId, sessionId, userId]
    );
    await db.execute(
      `INSERT INTO conversation_summaries (
         internal_uid, character_id, character_scope_id, period_type, period_start, period_end, summary_text, source_message_count
       ) VALUES
         (?, 'fan', 'fan', 'day', ?, ?, 'old day', 1),
         (?, 'fan', 'fan', 'week', ?, ?, 'old week', 1),
         (?, 'fan', 'fan', 'month', ?, ?, 'old month', 1),
         (?, 'fan', 'fan', 'day', ?, ?, 'fresh day', 1)`,
      [userId, oldDay, oldDay, userId, oldWeek, oldWeek, userId, oldMonth, oldMonth, userId, freshDay, freshDay]
    );
    await db.execute(
      `INSERT INTO user_memory_records (
         internal_uid, character_id, scope, memory_type, title, content, summary, memory_status, source_kind, expires_at
       ) VALUES
         (?, 'fan', 'character_private', 'ongoing_topic', 'expired self check', 'expired memory', 'expired memory', 'active', 'chat_text', ?),
         (?, 'fan', 'character_private', 'ongoing_topic', 'fresh self check', 'fresh memory', 'fresh memory', 'active', 'chat_text', ?)`,
      [userId, daysAgo(1), userId, daysFromNow(1)]
    );

    await enqueueMemoryJob({ jobType: MEMORY_JOB_TYPES.CLEANUP_MESSAGES, priority: 1, payload: { selfCheck: "phase2_messages", sessionId }, maxRetries: 0 });
    await enqueueMemoryJob({ jobType: MEMORY_JOB_TYPES.CLEANUP_MEMORIES, priority: 1, payload: { selfCheck: "phase2_memories" }, maxRetries: 0 });
    await enqueueMemoryJob({ jobType: MEMORY_JOB_TYPES.CLEANUP_SUMMARIES, priority: 1, payload: { selfCheck: "phase2_summaries" }, maxRetries: 0 });
    await runMemoryJobBatch();
    await runMemoryJobBatch();

    const result = {
      phase: "phase2",
      oldMessageDeleted: await countRows("chat_messages", "id = ?", [oldMsgId]) === 0,
      freshMessageKept: await countRows("chat_messages", "id = ?", [freshMsgId]) === 1,
      oldIndexDeleted: await countRows("chat_message_index", "message_id = ?", [oldMsgId]) === 0,
      freshIndexKept: await countRows("chat_message_index", "message_id = ?", [freshMsgId]) === 1,
      oldSummariesDeleted: await countRows("conversation_summaries", "internal_uid = ? AND summary_text IN ('old day', 'old week', 'old month')", [userId]) === 0,
      freshSummaryKept: await countRows("conversation_summaries", "internal_uid = ? AND summary_text = 'fresh day'", [userId]) === 1,
      expiredMemoryMarked: await countRows("user_memory_records", "internal_uid = ? AND title = 'expired self check' AND memory_status = 'expired'", [userId]) === 1,
      freshMemoryKept: await countRows("user_memory_records", "internal_uid = ? AND title = 'fresh self check' AND memory_status = 'active'", [userId]) === 1,
    };
    printResult(result);
    assert(Object.values(result).every(Boolean), "phase2 cleanup chain failed");
  } finally {
    await db.execute("DELETE FROM users WHERE id = ?", [userId]);
  }
}

async function checkPhase3() {
  const db = getDbPool();
  const suffix = Date.now();
  const userId = `u_mem_summary_${suffix}`;
  const sessionId = `chat_mem_summary_${suffix}`;
  const userMsgId = `msg_mem_summary_user_${suffix}`;
  const botMsgId = `msg_mem_summary_bot_${suffix}`;

  await db.execute(
    `INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type)
     VALUES (?, ?, ?, ?, ?, 'active', 'personal')`,
    [userId, userId, userId, "x", `${userId}@example.local`]
  );

  try {
    await db.execute(
      `INSERT INTO chat_sessions (
         id, internal_uid, character_id, session_title, session_status, source_type, source_ref, last_message_at
       ) VALUES (?, ?, 'fan', 'summary self check', 'active', 'user', 'summary-self-check', NOW(3))`,
      [sessionId, userId]
    );
    await db.execute(
      `INSERT INTO chat_messages (
         id, session_id, character_id, sender_type, sender_label, content_type, text_content,
         display_order, delivery_status, source_type, source_ref, sent_at
       ) VALUES
         (?, ?, NULL, 'user', 'You', 'text', '我支持阿森纳，最近一直在看英超裁判争议', 10, 'sent', 'user', 'summary-self-check', NOW(3)),
         (?, ?, 'fan', 'character', 'Dani Ultra', 'text', '阿森纳和裁判争议都很适合继续聊。', 20, 'sent', 'ai', 'summary-self-check', NOW(3))`,
      [userMsgId, sessionId, botMsgId, sessionId]
    );

    await enqueueMemoryJob({
      userId,
      characterId: "fan",
      sessionId,
      jobType: MEMORY_JOB_TYPES.REBUILD_DAILY_SUMMARY,
      priority: 1,
      payload: { userId, characterId: "fan", sessionId },
      maxRetries: 0,
    });
    await enqueueMemoryJob({
      userId,
      characterId: "fan",
      sessionId,
      jobType: MEMORY_JOB_TYPES.REBUILD_WEEKLY_SUMMARY,
      priority: 1,
      payload: { userId, characterId: "fan", sessionId },
      maxRetries: 0,
    });
    await enqueueMemoryJob({
      userId,
      characterId: "fan",
      sessionId,
      jobType: MEMORY_JOB_TYPES.REBUILD_MONTHLY_SUMMARY,
      priority: 1,
      payload: { userId, characterId: "fan", sessionId },
      maxRetries: 0,
    });
    await runMemoryJobBatch();
    await runMemoryJobBatch();

    const daySummaryId = await findSummaryId(userId, "fan", "day");
    const weekSummaryId = await findSummaryId(userId, "fan", "week");
    const monthSummaryId = await findSummaryId(userId, "fan", "month");
    const result = {
      phase: "phase3",
      dailySummaryWritten: Boolean(daySummaryId),
      weeklySummaryWritten: Boolean(weekSummaryId),
      monthlySummaryWritten: Boolean(monthSummaryId),
      dailyLinksWritten: daySummaryId ? await countRows("conversation_summary_links", "summary_id = ?", [daySummaryId]) > 0 : false,
      weeklyLinksWritten: weekSummaryId ? await countRows("conversation_summary_links", "summary_id = ?", [weekSummaryId]) > 0 : false,
      monthlyLinksWritten: monthSummaryId ? await countRows("conversation_summary_links", "summary_id = ?", [monthSummaryId]) > 0 : false,
    };
    printResult(result);
    assert(Object.values(result).every(Boolean), "phase3 summary job chain failed");
  } finally {
    await db.execute("DELETE FROM users WHERE id = ?", [userId]);
  }
}

async function checkPhase4() {
  const db = getDbPool();
  const suffix = Date.now();
  const userId = `u_mem_extract_${suffix}`;
  const sessionId = `chat_mem_extract_${suffix}`;
  const messageId = `msg_mem_extract_${suffix}`;

  await db.execute(
    `INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type)
     VALUES (?, ?, ?, ?, ?, 'active', 'personal')`,
    [userId, userId, userId, "x", `${userId}@example.local`]
  );

  try {
    await db.execute(
      `INSERT INTO chat_sessions (
         id, internal_uid, character_id, session_title, session_status, source_type, source_ref, last_message_at
       ) VALUES (?, ?, 'fan', 'extract self check', 'active', 'user', 'extract-self-check', NOW(3))`,
      [sessionId, userId]
    );
    await db.execute(
      `INSERT INTO chat_messages (
         id, session_id, character_id, sender_type, sender_label, content_type, text_content,
         display_order, delivery_status, source_type, source_ref, sent_at
       ) VALUES (?, ?, NULL, 'user', 'You', 'text', '我支持阿森纳，也经常看英超', 10, 'sent', 'user', 'extract-self-check', NOW(3))`,
      [messageId, sessionId]
    );
    await enqueueMemoryJob({
      userId,
      characterId: "fan",
      sessionId,
      jobType: MEMORY_JOB_TYPES.EXTRACT_USER_MEMORY,
      priority: 1,
      payload: {
        messageId,
        userId,
        characterId: "fan",
        sessionId,
      },
      maxRetries: 0,
    });
    await runMemoryJobBatch();

    const [memoryRows] = await db.execute(
      `SELECT id, memory_type, summary
       FROM user_memory_records
       WHERE internal_uid = ?
         AND memory_status = 'active'
       ORDER BY id ASC`,
      [userId]
    );
    const memoryIds = memoryRows.map((row) => Number(row.id || 0)).filter(Boolean);
    const [linkRows] = memoryIds.length
      ? await db.execute(
        `SELECT memory_id
         FROM user_memory_links
         WHERE memory_id IN (${memoryIds.map(() => "?").join(",")})
           AND source_message_id = ?`,
        [...memoryIds, messageId]
      )
      : [[]];
    const result = {
      phase: "phase4",
      extractionJobWroteMemories: memoryRows.length > 0,
      favoriteClubExtracted: memoryRows.some((row) => row.memory_type === "favorite_club" && String(row.summary || "").includes("Arsenal")),
      sourceLinksWritten: linkRows.length > 0,
    };
    printResult(result);
    assert(Object.values(result).every(Boolean), "phase4 memory extraction job chain failed");
  } finally {
    await db.execute("DELETE FROM users WHERE id = ?", [userId]);
  }
}

async function checkPhase5() {
  const db = getDbPool();
  const suffix = Date.now();
  const userId = `u_mem_episode_${suffix}`;
  const sessionId = `chat_mem_episode_${suffix}`;
  const messageId = `msg_mem_episode_${suffix}`;

  await db.execute(
    `INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type)
     VALUES (?, ?, ?, ?, ?, 'active', 'personal')`,
    [userId, userId, userId, "x", `${userId}@example.local`]
  );

  try {
    await db.execute(
      `INSERT INTO chat_sessions (
         id, internal_uid, character_id, session_title, session_status, source_type, source_ref, last_message_at
       ) VALUES (?, ?, 'fan', 'episode self check', 'active', 'user', 'episode-self-check', NOW(3))`,
      [sessionId, userId]
    );
    await db.execute(
      `INSERT INTO chat_messages (
         id, session_id, character_id, sender_type, sender_label, content_type, text_content,
         display_order, delivery_status, source_type, source_ref, sent_at
       ) VALUES (?, ?, NULL, 'user', 'You', 'text', '以后别这样叫我，这对我很重要', 10, 'sent', 'user', 'episode-self-check', NOW(3))`,
      [messageId, sessionId]
    );
    await enqueueMemoryJob({
      userId,
      characterId: "fan",
      sessionId,
      jobType: MEMORY_JOB_TYPES.EXTRACT_USER_MEMORY,
      priority: 1,
      payload: {
        messageId,
        userId,
        characterId: "fan",
        sessionId,
      },
      maxRetries: 0,
    });
    await runMemoryJobBatch();

    const [rawRows] = await db.execute(
      `SELECT id, summary
       FROM user_memory_records
       WHERE internal_uid = ?
         AND memory_type = 'raw_episode'
         AND memory_status = 'active'
       ORDER BY id DESC`,
      [userId]
    );
    const { buildChatWakeUpContext } = await import("../server/chat-wakeup-context-service.js");
    const context = await buildChatWakeUpContext(db, {
      userId,
      characterId: "fan",
      sessionId,
      queryText: "你还记得吗",
      excludeMessageIds: [],
    });
    const result = {
      phase: "phase5",
      rawEpisodeWritten: rawRows.length > 0,
      rawEpisodeHasExpectedText: rawRows.some((row) => String(row.summary || "").includes("别这样叫我") || String(row.summary || "").includes("这对我很重要")),
      wakeUpContextIncludesEpisode: String(context.wakeUpContext || "").includes("Key raw episodes") || String(context.wakeUpContext || "").includes("raw episodes"),
    };
    printResult(result);
    assert(Object.values(result).every(Boolean), "phase5 raw episode chain failed");
  } finally {
    await db.execute("DELETE FROM users WHERE id = ?", [userId]);
  }
}

async function findSummaryId(userId, characterId, periodType) {
  const [rows] = await getDbPool().execute(
    `SELECT id
     FROM conversation_summaries
     WHERE internal_uid = ?
       AND character_scope_id = ?
       AND period_type = ?
       AND summary_status = 'active'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId, characterId, periodType]
  );
  return Number(rows[0]?.id || 0);
}

async function countRows(tableName, whereClause, params) {
  const [rows] = await getDbPool().execute(
    `SELECT COUNT(*) AS count FROM ${tableName} WHERE ${whereClause}`,
    params
  );
  return Number(rows[0]?.count || 0);
}

async function cleanupSelfCheckData() {
  const db = getDbPool();
  const [jobResult] = await db.execute(
    `DELETE FROM memory_jobs
     WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.selfCheck')) IS NOT NULL`
  );
  const [userResult] = await db.execute(
    `DELETE FROM users
     WHERE id LIKE 'u_mem_cleanup_%'
        OR id LIKE 'u_mem_summary_%'
        OR id LIKE 'u_mem_extract_%'
        OR id LIKE 'u_mem_episode_%'
        OR id LIKE 'u_runtime_chat_%'
        OR email LIKE 'runtime-chat-%@example.local'`
  );
  printResult({
    cleanup: true,
    deletedSelfCheckJobs: Number(jobResult.affectedRows || 0),
    deletedSelfCheckUsers: Number(userResult.affectedRows || 0),
  });
}

function daysAgo(days) {
  return new Date(Date.now() - Number(days || 0) * 24 * 60 * 60 * 1000);
}

function daysFromNow(days) {
  return new Date(Date.now() + Number(days || 0) * 24 * 60 * 60 * 1000);
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
}

function assert(condition, message) {
  if (condition) return;
  throw new Error(message);
}
