import assert from 'node:assert/strict';
import { recoverReviewedLanguageReply } from '../server/chat-reply-language-recovery-service.js';

for (const guardApplied of [false, true, undefined]) {
  let generations = 0, reviews = 0, logs = 0;
  const candidate = { text: 'Fresh candidate' };
  const terminalReply = { text: guardApplied ? 'Fallback' : 'Reviewed reply' };
  const result = await recoverReviewedLanguageReply({
    repairLanguageReply: async () => { generations++; return candidate; },
    reviewCandidate: async (received, options) => {
      reviews++;
      assert.equal(received, candidate);
      assert.equal(options.languageRepairAttempted, true);
      if (guardApplied !== undefined) await options.recordReview({ guardApplied });
      return terminalReply;
    },
    recordReview: async () => { logs++; },
  });
  assert.equal(result.terminal, true);
  assert.equal(result.recovered, guardApplied === false);
  assert.equal(result.reply, terminalReply);
  assert.equal(result.diagnostics.repairState, guardApplied === false ? 'accepted' : guardApplied === true ? 'rejected' : 'failed');
  assert.equal(generations, 1);
  assert.equal(reviews, 1);
  assert.equal(logs, guardApplied === undefined ? 0 : 1);
}
for (const throws of [false, true]) {
  const result = await recoverReviewedLanguageReply({
    repairLanguageReply: async () => { if (throws) throw Error('provider unavailable'); return null; },
    reviewCandidate: () => assert.fail('no candidate must not be reviewed'),
  });
  assert.equal(result.terminal, false);
  assert.equal(result.recovered, false);
}
console.log('recovery terminal: accepted, guarded, unconfirmed and absent candidates remain single-shot');

const diagnosedFailure = await recoverReviewedLanguageReply({
  repairLanguageReply: async ({ recordDiagnostic }) => { recordDiagnostic('provider_timeout'); throw Error('timeout'); },
  reviewCandidate: () => assert.fail('no failed candidate review'),
});
assert.equal(diagnosedFailure.diagnostics.repairFailureCode, 'provider_timeout');
