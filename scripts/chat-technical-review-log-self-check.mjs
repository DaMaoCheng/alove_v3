import assert from 'node:assert/strict';
import { buildReplyReviewLogEvent } from '../server/ai-reply-log-service.js';
for (const reason of ['', 'empty', 'length', 'internal_format', 'untrusted secret'.repeat(100)]) {
  const event = buildReplyReviewLogEvent({ reviewStatus: 'valid',
    languageDiagnostics: { reviewMode: 'technical_only', technicalGuardPassed: reason === '', technicalGuardReason: reason,
      languageReviewStatus: 'valid', languageConfidence: 1, repairKind: 'grounded', repairState: 'accepted',
      initialFailedContracts: ['boundary', 'business_facts', 'guidance'], languageIssueTypes: ['grammar', 'spelling', 'wrong_language'] },
    failedContracts: ['boundary', 'business_facts', 'guidance'], missingFields: ['allowed', 'confidence'],
  });
  assert(event.errorMessage.length <= 500);
  const details = JSON.parse(event.errorMessage);
  assert.equal(details.reviewMode, 'technical_only');
  assert.equal(details.technicalGuard.passed, reason === '');
  assert.equal(details.technicalGuard.reason, ['empty', 'length', 'internal_format'].includes(reason) ? reason : undefined);
  if (details.languageReview) {
    assert.equal(details.languageReview.status, 'not_run');
    assert.equal(details.languageReview.confidence, undefined);
  }
  assert(!event.errorMessage.includes('untrusted secret'));
}
console.log('technical review log: bounded mode, finite reasons, no fabricated language approval');
