import assert from "node:assert/strict";

// Keep this DB/lease regression independent of paid routing providers. Configure
// before importing config consumers; #mock-image still follows its real path.
process.env.TYPESAFE_API_KEY = "";
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
    assert.equal(String(url), "https://chat-image-final-classifier.invalid/v1/chat/completions", "this regression must not contact JEV or any real provider");
    const body = JSON.parse(options.body || "{}");
    assert.match(body.messages?.[0]?.content || "", /You classify whether a chat message asks an AI character for a personal chat image/, "only the image-intent classifier may use this fixture transport");
    const input = JSON.parse(body.messages?.[1]?.content || "{}");
    classifiedMessages.push(input.latestMessage);
    assert.ok(!String(input.latestMessage).includes("#mock-image"), "explicit mock generation must retain its existing classifier-free path");
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      communicativeAction: "other", requestKind: "non_image", hasIntent: false, allowed: false,
      confidence: .99, intentType: "none", imageSubject: "none", requestScope: "unknown",
      requestEvidence: "", actorEvidence: "", actionEvidence: "", clothingTarget: "none",
      explicitGeneration: false, wants_no_clothing: false, wants_clothing: false,
    }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (error) {
    // Classifier failures are intentionally caught in production. Retain the
    // fixture violation so the test cannot silently pass on that fallback.
    transportViolations.push(error);
    throw error;
  }
};

export function assertFixtureTransport() {
  assert.equal(transportViolations.length, 0, "fixture transport must accept every attempted request without hidden classifier fallback");
}

export function restore() { globalThis.fetch = originalFetch; }
