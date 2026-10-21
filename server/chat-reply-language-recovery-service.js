import { REPLY_REVIEW_TIMEOUT_MS, REPLY_REPAIR_TIMEOUT_MS } from "./chat-reply-review-outcome.js";
// One text recovery (fresh generation or grounded correction) followed by the caller's COMPLETE original review. The callback
// receives fresh finite stage budgets; earlier provider latency never subtracts
// time from correction or the complete original re-review.
export async function recoverReviewedLanguageReply({ replyResult, assessment, languageDiagnostics = {}, language, userText,
  logContext, repairLanguageReply, reviewCandidate, recordReview, primaryReviewTimeoutMs = REPLY_REVIEW_TIMEOUT_MS, repairTimeoutMs = REPLY_REPAIR_TIMEOUT_MS } = {}) {
  const diagnostics = { ...languageDiagnostics, repairState: "failed" };
  let repaired = null;
  try {
    repaired = await repairLanguageReply({ replyResult, assessment, language, userText, logContext,
      timeoutMs: Number.isFinite(repairTimeoutMs) && repairTimeoutMs > 0 ? Math.min(REPLY_REPAIR_TIMEOUT_MS, repairTimeoutMs) : REPLY_REPAIR_TIMEOUT_MS,
      recordDiagnostic: code => { diagnostics.repairFailureCode = code; } });
  } catch { diagnostics.repairFailureCode = "provider_error"; }
  if (!repaired) return { recovered: false, diagnostics };
  const primaryBudget = Number.isFinite(primaryReviewTimeoutMs) && primaryReviewTimeoutMs > 0
    ? Math.min(REPLY_REVIEW_TIMEOUT_MS, primaryReviewTimeoutMs) : REPLY_REVIEW_TIMEOUT_MS;
  let terminalEvent;
  const output = await reviewCandidate(repaired, {
    languageRepairAttempted: true, languageRepairDiagnostics: { ...diagnostics, repairState: "attempted" },
    reviewTimeoutMs: primaryBudget,
    recordReview: async event => {
      terminalEvent = { ...event, languageDiagnostics: { ...diagnostics, ...event.languageDiagnostics,
        repairState: event.guardApplied ? "rejected" : "accepted",
        initialLanguageIssueTypes: languageDiagnostics.languageIssueTypes } };
    },
  });
  try { if (terminalEvent) await recordReview(terminalEvent); } catch {}
  return { recovered: true, reply: output, diagnostics: terminalEvent?.languageDiagnostics || diagnostics };
}
