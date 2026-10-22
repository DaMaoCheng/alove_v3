import { SERVER_CONFIG } from './config.js';

const modelIdentity = value => String(value || '').trim().toLowerCase();

// Reviewers reuse the configured provider chain; this module never selects a
// new model or changes the generator's provider settings.
export function independentReviewerConfig(generatorModel, aiReply = SERVER_CONFIG.aiReply) {
  const generator = generatorModel || filterIndependentLanguageReviewers(aiReply.replyChain || [])[0]?.model;
  return filterIndependentLanguageReviewers(aiReply.replyChain || [], generator)[0] || null;
}

export function independentJsonProviderChain(aiReply = SERVER_CONFIG.aiReply) {
  const chain = filterIndependentLanguageReviewers(aiReply.replyChain || []);
  if (!chain.length) return null;
  return chain.map(provider => {
    const { max_tokens: _chatCap, max_output_tokens: _responseCap, ...extras } = provider.requestBodyExtras || {};
    return { ...provider, requestBodyExtras: {
      ...extras, [provider.apiMode === 'responses' ? 'max_output_tokens' : 'max_tokens']: 3000,
    } };
  });
}

// Language and grounded-repair reviewers remain independent of the model that
// generated the answer, including every transport fallback.
export function independentLanguageReviewerChain(generatorModel, aiReply = SERVER_CONFIG.aiReply) {
  const generator = generatorModel || filterIndependentLanguageReviewers(aiReply.replyChain || [])[0]?.model;
  return filterIndependentLanguageReviewers(independentJsonProviderChain(aiReply) || [], generator);
}

export function filterIndependentLanguageReviewers(config, generatorModel) {
  const seen = new Set([modelIdentity(generatorModel)]);
  return (Array.isArray(config) ? config : config ? [config] : []).filter(provider => {
    const model = modelIdentity(provider?.model);
    if (!provider?.apiKey || !model || seen.has(model)) return false;
    seen.add(model);
    return true;
  });
}
