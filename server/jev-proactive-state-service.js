import { evaluateJevQuestions } from './jev-intent-service.js';

// The user's conversation state is a routing decision. Candidate quality remains
// the existing independent output review and cannot establish this state.
export async function assessJevProactiveState({ context = [], contextTruncated = false,
  evaluate = evaluateJevQuestions, logContext = {}, fetchImpl = fetch } = {}) {
  const result = await evaluate({
    state: { recentConversation: context, contextTruncated }, logContext, fetchImpl,
    sourceRef: 'jev-proactive-state',
    questions: { state: { type: 'choice',
      instructions: 'Judge the latest USER intent in context, in any language. Old assistant suggestions never establish shopping intent or resolution. A personal existing-order problem remains unresolved until the user explicitly resolves it or starts independent new shopping. Uncertainty is unknown. Do not generate a message.',
      criteria: {
        unresolved_after_sales: 'The user has an unresolved personal order, delivery, payment, return or support concern.',
        resolved: 'The user explicitly confirmed their earlier personal problem ended.',
        shopping: 'The user currently explicitly requests new merchandise browsing, selection or purchase, not fixing an existing order.',
        neutral: 'Ordinary conversation, or a general policy question without a personal unresolved concern.',
        unknown: 'Insufficient, conflicting or ambiguous context.',
      } } },
  });
  if (!result.ok) return { ...result, decision: null };
  const answer = result.answers.state;
  return { ...result, decision: { state: answer.choice, confidence: answer.confidence,
    candidateKind: 'care', quality: { natural: false, grounded: false, novel: false } } };
}
