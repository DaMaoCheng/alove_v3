import { SERVER_CONFIG } from './config.js';
import { MAX_AI_REPLY_REQUEST_ATTEMPTS, AI_REPLY_RETRY_DELAY_MS } from './ai-reply-request-policy.js';

export const CHAT_IMAGE_QUEUE_WAIT_MS = 5 * 60 * 1000;
export const CHAT_IMAGE_REQUEST_MAX_MS = 15 * 60 * 1000;
export const IMAGE_MEMORY_JOB_TYPES = Object.freeze(['generate_chat_image', 'generate_chat_image_failure_reply']);
export const MEMORY_JOB_CONTROL_TIMEOUT_MS = 30_000;
export const MEMORY_JOB_HEARTBEAT_MS = 30_000;
export const MEMORY_JOB_STALE_MS = 90_000;

export function memoryJobClaimFilter(lane) {
  if (lane === 'image') return { includeTypes: IMAGE_MEMORY_JOB_TYPES };
  if (lane === 'background') return { excludeTypes: IMAGE_MEMORY_JOB_TYPES };
  throw new Error('Unknown memory job lane');
}

export function getMemoryJobExecutionBudgetMs(job = {}) {
  if (job.jobType === 'generate_chat_image') {
    const attemptBudget = Math.max(5 * 60 * 1000, Number(SERVER_CONFIG.imageGeneration.openai.timeoutMs || 180_000) + 90_000);
    const created = new Date(job.createdAt).getTime();
    return Number.isFinite(created) ? Math.max(1, Math.min(attemptBudget, CHAT_IMAGE_REQUEST_MAX_MS - (Date.now() - created))) : attemptBudget;
  }
  // Preserve the existing ten total reply attempts and proactive's two
  // candidate generations; the outer watchdog must not shrink their budget.
  const replyTimeout = Math.max(20000, SERVER_CONFIG.aiReply.chatTimeouts.generation, ...(SERVER_CONFIG.aiReply.replyChain || []).map(model => Number(model.timeoutMs) || 20000));
  const replyWindow = MAX_AI_REPLY_REQUEST_ATTEMPTS * replyTimeout + (MAX_AI_REPLY_REQUEST_ATTEMPTS - 1) * AI_REPLY_RETRY_DELAY_MS;
  const voiceWindow = Number(SERVER_CONFIG.elevenLabs?.timeoutMs || 8000) * (1 + Number(SERVER_CONFIG.elevenLabs?.ttsMaxRetries || 0));
  if (job.jobType === 'send_proactive_message') return Math.max(5 * 60 * 1000, 2 * replyWindow + voiceWindow + 120000);
  if (job.jobType === 'generate_chat_image_failure_reply') return Math.max(5 * 60 * 1000, replyWindow + voiceWindow + 90000);
  if (job.jobType === 'send_mascot_campaign_batch') return Math.max(10 * 60 * 1000, 5 * (voiceWindow + 30000) + 90000);
  return 5 * 60 * 1000;
}

// Only these handlers already provide interruption-safe resumability. Unknown
// side-effect jobs and proactive messages require reconciliation, not replay.
export function canRetryInterruptedMemoryJob(job = {}) {
  return ['backfill_claimed_guest_context', 'send_mascot_campaign_batch', 'generate_chat_image_failure_reply'].includes(job.jobType);
}
