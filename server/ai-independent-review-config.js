import { SERVER_CONFIG } from './config.js';

// Reuse the existing independent reviewer for bounded reasoning tasks. This
// does not mutate the generator or global provider chain.
export function independentReviewerConfig(generatorModel, aiReply = SERVER_CONFIG.aiReply) {
  const generator = generatorModel || aiReply.replyChain?.[0]?.model;
  const venice = { ...aiReply.venice, model: 'claude-sonnet-5-5',
    requestBodyExtras: { ...aiReply.venice?.requestBodyExtras, reasoning_effort: 'low', max_tokens: 1200 } };
  return [venice, aiReply.openai, aiReply.fallbackOpenai]
    .find(config => config?.apiKey && config.model && config.model !== generator) || null;
}

export function independentJsonProviderChain(aiReply = SERVER_CONFIG.aiReply) {
  const reviewer = independentReviewerConfig(undefined, aiReply);
  if (!reviewer) return null;
  const chain = aiReply.replyChain || [];
  const provider = chain.find(item => item.baseUrl === reviewer.baseUrl && item.model === reviewer.model)
    || chain.find(item => item.baseUrl === reviewer.baseUrl);
  const { max_tokens: _chatCap, max_output_tokens: _responseCap, ...extras } = reviewer.requestBodyExtras || {};
  return [{ ...reviewer, id: provider?.id || 'other', requestBodyExtras: {
    ...extras, [reviewer.apiMode === 'responses' ? 'max_output_tokens' : 'max_tokens']: 3000,
  } }, ...chain.slice(1).filter(item => item.baseUrl !== reviewer.baseUrl || item.model !== reviewer.model)];
}
