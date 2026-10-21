import { SUMMARY_PERIOD_TYPES } from "./chat-memory-taxonomy.js";
import { refreshConversationSummaryForPeriod } from "./chat-summary-service.js";
import { withTransaction } from "./db.js";

export async function rebuildSummaryFromJob(job) {
  const payload = job?.payload && typeof job.payload === "object" ? job.payload : {};
  const userId = String(payload.userId || job?.userId || "").trim();
  const characterId = String(payload.characterId || job?.characterId || "").trim();
  const sessionId = String(payload.sessionId || job?.sessionId || "").trim();
  const periodType = normalizeJobPeriodType(job?.jobType, payload.periodType);
  if (!userId || !characterId || !sessionId || !periodType) {
    throw new Error("summary job missing required userId, characterId, sessionId, or periodType");
  }

  const summary = await withTransaction((db) => refreshConversationSummaryForPeriod(db, {
    userId,
    characterId,
    sessionId,
    periodType,
    now: payload.now ? new Date(payload.now) : new Date(),
    textOnly: payload.textOnly === true,
  }));

  return {
    ok: true,
    periodType,
    summaryId: summary?.id || null,
    sourceMessageCount: summary?.sourceMessageCount || 0,
  };
}

function normalizeJobPeriodType(jobType, payloadPeriodType) {
  const explicit = String(payloadPeriodType || "").trim();
  if (Object.values(SUMMARY_PERIOD_TYPES).includes(explicit)) return explicit;
  if (jobType === "rebuild_daily_summary") return SUMMARY_PERIOD_TYPES.DAY;
  if (jobType === "rebuild_weekly_summary") return SUMMARY_PERIOD_TYPES.WEEK;
  if (jobType === "rebuild_monthly_summary") return SUMMARY_PERIOD_TYPES.MONTH;
  return "";
}
