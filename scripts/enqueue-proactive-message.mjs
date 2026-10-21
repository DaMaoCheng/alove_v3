import { initializeDatabase, getDbPool } from "../server/db.js";
import { MEMORY_JOB_TYPES, enqueueMemoryJob } from "../server/memory-job-service.js";
import { runMemoryJobBatch } from "../server/memory-job-runner-service.js";

const args = parseArgs(process.argv.slice(2));
const email = String(args.email || "").trim();
const userIdArg = String(args.userId || args.user || "").trim();
const characterId = String(args.characterId || args.character || "fan").trim();
const minIdleMinutes = Number(args.minIdleMinutes ?? 240);
const maxUnansweredProactive = Number(args.maxUnansweredProactive ?? 1);
const ignoreQuietHours = Boolean(args.ignoreQuietHours || args.runNow);
const runNow = Boolean(args.run || args.runNow);

await initializeDatabase();

const db = getDbPool();
const user = await resolveUser({ email, userId: userIdArg });
if (!user) {
  printJson({ ok: false, error: "user_not_found", email, userId: userIdArg });
  process.exit(1);
}

const session = await resolveLatestSession({ userId: user.id, characterId });
if (!session) {
  printJson({ ok: false, error: "session_not_found", userId: user.id, characterId });
  process.exit(1);
}

const jobId = await enqueueMemoryJob({
  userId: user.id,
  characterId,
  sessionId: session.id,
  jobType: MEMORY_JOB_TYPES.SEND_PROACTIVE_MESSAGE,
  priority: Number(args.priority || 75),
  payload: {
    userId: user.id,
    characterId,
    sessionId: session.id,
    minIdleMinutes,
    maxUnansweredProactive,
    ignoreQuietHours,
    quietHours: args.quietHours || "1-8",
    reason: args.reason || "manual_enqueue",
  },
});

if (runNow) {
  await runMemoryJobBatch();
}

printJson({
  ok: true,
  jobId,
  runNow,
  user,
  session,
});

process.exit(0);

async function resolveUser({ email, userId }) {
  if (userId) {
    const [rows] = await db.execute(
      "SELECT id, email, nickname, account_type FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    return rows[0] || null;
  }
  if (email) {
    const [rows] = await db.execute(
      "SELECT id, email, nickname, account_type FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    return rows[0] || null;
  }
  return null;
}

async function resolveLatestSession({ userId, characterId }) {
  const [rows] = await db.execute(
    `SELECT id, character_id, session_title, last_message_at
     FROM chat_sessions
     WHERE internal_uid = ?
       AND character_id = ?
       AND session_status = 'active'
       AND source_type = 'user'
     ORDER BY last_message_at DESC, updated_at DESC
     LIMIT 1`,
    [userId, characterId]
  );
  return rows[0] || null;
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

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
