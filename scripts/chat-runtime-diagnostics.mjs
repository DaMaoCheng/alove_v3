import { initializeDatabase, getDbPool } from "../server/db.js";
import { buildChatWakeUpContext } from "../server/chat-wakeup-context-service.js";

const args = parseArgs(process.argv.slice(2));
const email = String(args.email || "").trim();
const userIdArg = String(args.userId || args.user || "").trim();
const characterId = String(args.characterId || args.character || "fan").trim();
const limit = Math.max(1, Math.min(30, Number(args.limit || 8)));

await initializeDatabase();

const db = getDbPool();
const user = await resolveUser({ email, userId: userIdArg });
if (!user) {
  printJson({
    ok: false,
    error: "user_not_found",
    email,
    userId: userIdArg,
  });
  process.exit(1);
}

const session = await resolveLatestSession({
  userId: user.id,
  characterId,
});
const messages = session ? await listLatestMessages(session.id, limit) : [];
const jobs = await listLatestJobs({
  userId: user.id,
  characterId,
  limit,
});
const memories = await listActiveMemories({
  userId: user.id,
  characterId,
  limit,
});
const summaries = await listLatestSummaries({
  userId: user.id,
  characterId,
});
const wakeUpContext = session
  ? await buildChatWakeUpContext(db, {
    userId: user.id,
    characterId,
    sessionId: session.id,
    queryText: messages.at(-1)?.text || "",
  })
  : null;

printJson({
  ok: true,
  user,
  characterId,
  session,
  latestMessages: messages,
  latestJobs: jobs,
  activeMemories: memories,
  latestSummaries: summaries,
  wakeUpContext: wakeUpContext
    ? {
      hasContext: Boolean(wakeUpContext.wakeUpContext),
      chars: String(wakeUpContext.wakeUpContext || "").length,
      text: wakeUpContext.wakeUpContext,
    }
    : null,
});

process.exit(0);

async function resolveUser({ email, userId }) {
  if (userId) {
    const [rows] = await db.execute(
      "SELECT id, email, nickname, account_type, created_at, last_seen_at FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    return mapUser(rows[0]);
  }
  if (email) {
    const [rows] = await db.execute(
      "SELECT id, email, nickname, account_type, created_at, last_seen_at FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    return mapUser(rows[0]);
  }
  const [rows] = await db.execute(
    `SELECT id, email, nickname, account_type, created_at, last_seen_at
     FROM users
     WHERE account_status = 'active'
     ORDER BY last_seen_at DESC, created_at DESC
     LIMIT 1`
  );
  return mapUser(rows[0]);
}

async function resolveLatestSession({ userId, characterId }) {
  const [rows] = await db.execute(
    `SELECT id, character_id, session_title, session_status, source_type, source_ref, last_message_at, created_at, updated_at
     FROM chat_sessions
     WHERE internal_uid = ?
       AND character_id = ?
       AND session_status = 'active'
       AND source_type = 'user'
     ORDER BY last_message_at DESC, updated_at DESC
     LIMIT 1`,
    [userId, characterId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    characterId: row.character_id,
    title: row.session_title || "",
    status: row.session_status || "",
    sourceType: row.source_type || "",
    sourceRef: row.source_ref || "",
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listLatestMessages(sessionId, rowLimit) {
  const [rows] = await db.execute(
    `SELECT id, sender_type, content_type, text_content, source_type, source_ref, sent_at, created_at
     FROM chat_messages
     WHERE session_id = ?
     ORDER BY sent_at DESC, display_order DESC
     LIMIT ${rowLimit}`,
    [sessionId]
  );
  return rows.reverse().map((row) => ({
    id: row.id,
    senderType: row.sender_type || "",
    contentType: row.content_type || "",
    text: row.text_content || "",
    sourceType: row.source_type || "",
    sourceRef: row.source_ref || "",
    sentAt: row.sent_at,
    createdAt: row.created_at,
  }));
}

async function listLatestJobs({ userId, characterId, limit: rowLimit }) {
  const [rows] = await db.execute(
    `SELECT id, job_type, job_status, retry_count, last_error, result_json, created_at, updated_at
     FROM memory_jobs
     WHERE internal_uid = ?
       AND (character_id IS NULL OR character_id = ?)
     ORDER BY created_at DESC
     LIMIT ${rowLimit}`,
    [userId, characterId]
  );
  return rows.map((row) => ({
    id: row.id,
    type: row.job_type || "",
    status: row.job_status || "",
    retryCount: Number(row.retry_count || 0),
    lastError: row.last_error || "",
    result: parseJsonValue(row.result_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function listActiveMemories({ userId, characterId, limit: rowLimit }) {
  const [rows] = await db.execute(
    `SELECT id, memory_type, scope, summary, content, importance_score, freshness_score, expires_at, updated_at
     FROM user_memory_records
     WHERE internal_uid = ?
       AND memory_status = 'active'
       AND (character_id IS NULL OR character_id = ?)
       AND (expires_at IS NULL OR expires_at > NOW(3))
     ORDER BY importance_score DESC, freshness_score DESC, updated_at DESC
     LIMIT ${rowLimit}`,
    [userId, characterId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    type: row.memory_type || "",
    scope: row.scope || "",
    summary: row.summary || "",
    content: row.content || "",
    importanceScore: Number(row.importance_score || 0),
    freshnessScore: Number(row.freshness_score || 0),
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  }));
}

async function listLatestSummaries({ userId, characterId }) {
  const [rows] = await db.execute(
    `SELECT id, period_type, period_start, period_end, summary_text, source_message_count, updated_at
     FROM conversation_summaries
     WHERE internal_uid = ?
       AND character_scope_id = ?
       AND summary_status = 'active'
     ORDER BY period_start DESC, updated_at DESC
     LIMIT 9`,
    [userId, characterId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    periodType: row.period_type || "",
    periodStart: row.period_start,
    periodEnd: row.period_end,
    text: row.summary_text || "",
    sourceMessageCount: Number(row.source_message_count || 0),
    updatedAt: row.updated_at,
  }));
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email || "",
    nickname: row.nickname || "",
    accountType: row.account_type || "",
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function parseJsonValue(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
