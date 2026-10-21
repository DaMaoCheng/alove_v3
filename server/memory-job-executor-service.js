import { cleanupGuestVisitorHistory } from './guest-visitor-cleanup-service.js';
import {
  cleanupConversationSummaries,
  cleanupExpiredMemoryRecords,
  cleanupRawChatMessages,
} from "./memory-cleanup-service.js";
import { extractUserMemoryFromJob } from "./memory-extraction-job-service.js";
import { sendProactiveMessageFromJob } from "./proactive-message-job-service.js";
import { rebuildSummaryFromJob } from "./memory-summary-job-service.js";
import { generateChatImageFromJob } from "./chat-image-job-service.js";
import { generateChatImageFailureReplyFromJob } from "./chat-image-failure-reply-job-service.js";
import { backfillClaimedGuestContextFromJob } from "./guest-claim-context-job-service.js";
import { sendMascotCampaignBatchFromJob } from "./mascot-campaign-delivery-job-service.js";
import { cleanupExpiredGuestNetworkLimits } from "./guest-network-rate-limit-service.js";
import { cleanupExpiredGuestSessions } from "./guest-session-cleanup-service.js";
import { MEMORY_JOB_TYPES } from "./memory-job-service.js";
export async function executeMemoryJob(job) {
  if (job.jobType === MEMORY_JOB_TYPES.NOOP) {
    return {
      ok: true,
      handledBy: "noop",
    };
  }
  if (job.jobType === MEMORY_JOB_TYPES.CLEANUP_MESSAGES) {
    return cleanupRawChatMessages(job.payload || {});
  }
  if (job.jobType === MEMORY_JOB_TYPES.CLEANUP_MEMORIES) {
    const [memoryResult, guestNetworkResult, guestSessionResult] = await Promise.all([
      cleanupExpiredMemoryRecords(job.payload || {}),
      cleanupExpiredGuestNetworkLimits(),
      cleanupExpiredGuestSessions(),
    ]);
    let guestVisitorResult;
    try {
      guestVisitorResult = await cleanupGuestVisitorHistory();
    } catch (error) {
      console.warn('[aiove] guest visitor cleanup unavailable', /^[A-Z0-9_]{1,64}$/.test(String(error?.code || '')) ? error.code : 'CLEANUP_FAILED');
      guestVisitorResult = { guestVisitorCleanupFailed: true };
    }
    return { ...memoryResult, ...guestNetworkResult, ...guestSessionResult, ...guestVisitorResult };
  }
  if (job.jobType === MEMORY_JOB_TYPES.CLEANUP_SUMMARIES) {
    return cleanupConversationSummaries(job.payload || {});
  }
  if (
    job.jobType === MEMORY_JOB_TYPES.REBUILD_DAILY_SUMMARY ||
    job.jobType === MEMORY_JOB_TYPES.REBUILD_WEEKLY_SUMMARY ||
    job.jobType === MEMORY_JOB_TYPES.REBUILD_MONTHLY_SUMMARY
  ) {
    return rebuildSummaryFromJob(job);
  }
  if (job.jobType === MEMORY_JOB_TYPES.EXTRACT_USER_MEMORY) {
    return extractUserMemoryFromJob(job);
  }
  if (job.jobType === MEMORY_JOB_TYPES.SEND_PROACTIVE_MESSAGE) {
    return sendProactiveMessageFromJob(job);
  }
  if (job.jobType === MEMORY_JOB_TYPES.SEND_MASCOT_CAMPAIGN_BATCH) {
    return sendMascotCampaignBatchFromJob(job);
  }
  if (job.jobType === MEMORY_JOB_TYPES.GENERATE_CHAT_IMAGE) {
    return generateChatImageFromJob(job);
  }
  if (job.jobType === MEMORY_JOB_TYPES.GENERATE_CHAT_IMAGE_FAILURE_REPLY) {
    return generateChatImageFailureReplyFromJob(job);
  }
  if (job.jobType === MEMORY_JOB_TYPES.BACKFILL_CLAIMED_GUEST_CONTEXT) {
    return backfillClaimedGuestContextFromJob(job);
  }
  throw new Error(`Unsupported memory job type: ${job.jobType}`);
}
