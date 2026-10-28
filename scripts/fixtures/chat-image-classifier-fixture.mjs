import assert from "node:assert/strict";

// Keep DB/lease regressions independent of paid providers while exercising the
// actual successful JEV decision path. #mock-image retains its task bypass.
process.env.TYPESAFE_API_KEY = "chat-image-final-jev-self-check";
process.env.TYPESAFE_BASE_URL = "https://chat-image-final-jev.invalid/v1";
process.env.VENICE_API_KEY = "chat-image-final-classifier-self-check";
process.env.VENICE_BASE_URL = "https://chat-image-final-classifier.invalid/v1";
process.env.VENICE_MODEL = "self-check";
process.env.VENICE_API_MODE = "chat_completions";
process.env.OPENAI_API_KEY = "";
process.env.OPENAI_FALLBACK_API_KEY = "";
const originalFetch = globalThis.fetch;
export const classifiedMessages = [];
const transportViolations = [];
globalThis.fetch = async (url, options = {}) => {
  try {
    assert.equal(String(url), "https://chat-image-final-jev.invalid/v1/systemone", "valid JEV decisions must not contact a reply model for image routing");
    const body = JSON.parse(options.body || "{}");
    assert(body.questions && body.state, "routing fixture requires the actual JEV protocol");
    const message = String(body.state.message || body.state.latestMessage || '');
    if (message && !message.includes('#mock-image')) classifiedMessages.push(message);
    const answers = Object.fromEntries(Object.entries(body.questions).map(([key, q]) => {
      if (q.type === 'noul') return [key, { noul: 0 }];
      if (q.type === 'score') return [key, { score: 0 }];
      const options = Object.keys(q.criteria || {});
      const safe = ['daily_chat', 'chat', 'none', 'neutral', 'other', 'unknown', 'no', 'false', 'unrelated'];
      const selected = safe.find(value => options.includes(value)) || options[0];
      assert(selected, 'JEV choice needs supplied options');
      return [key, { choice: selected, confidence: .99 }];
    }));
    return new Response(JSON.stringify({ model: 'jev-fixture', answers }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (error) {
    transportViolations.push(error);
    throw error;
  }
};

export function assertFixtureTransport() {
  assert.equal(transportViolations.length, 0, "fixture transport must accept every attempted request without hidden classifier fallback");
}

export function restore() { globalThis.fetch = originalFetch; }
