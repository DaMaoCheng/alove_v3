import { createHash } from "node:crypto";

const STAGES = new Set(["unknown", "address", "shipping", "payment", "submission"]);
const validatedIssues = new WeakMap();

// A bounded, request-local interpretation. Evidence references deliberately do
// not duplicate addresses, payment details or error text into routing metadata.
function userEvidenceWindow(userText, recentMessages) {
  return [...(Array.isArray(recentMessages) ? recentMessages : []).slice(-6)
    .filter((row) => row && (row.senderType || row.sender_type) === "user")
    .map((row, messageIndex) => ({ messageIndex, text: String(row.text || row.text_content || "").slice(0, 600) })),
  { messageIndex: -1, text: String(userText || "").trim().slice(0, 4000) }];
}

export function normalizeCheckoutIssue(value, { userText = "", recentMessages = [], confidence = 0 } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isFinite(Number(confidence)) || Number(confidence) < .75 || Number(confidence) > 1) return null;
  const window = userEvidenceWindow(userText, recentMessages);
  const fingerprint = createHash("sha256").update(JSON.stringify(window)).digest("hex");
  // Only an immutable object produced here can be reused by routing. Serialized
  // references from model output, another turn or a caller are not evidence.
  if (validatedIssues.has(value)) return validatedIssues.get(value) === fingerprint ? value : null;
  const quote = (candidate, currentOnly = false) => {
    if (typeof candidate !== "string" || !candidate.trim() || candidate.length > 160) return null;
    const text = candidate.trim();
    const row = [...window].reverse().find((item) => (!currentOnly || item.messageIndex === -1) && item.text.includes(text));
    return row ? Object.freeze({ messageIndex: row.messageIndex, start: row.text.indexOf(text), end: row.text.indexOf(text) + text.length }) : null;
  };
  const evidence = quote(value.evidence, true);
  if (value.active !== true || !evidence) return null;
  const stageEvidence = quote(value.stageEvidence);
  const orderEvidence = quote(value.orderEvidence);
  const lookupEvidence = quote(value.lookupEvidence, value.lookupRequested === false);
  const failedAttempts = (Array.isArray(value.failedAttempts) ? value.failedAttempts : []).slice(0, 3).map((item) => quote(item)).filter(Boolean);
  const uniqueAttempts = [...new Map(failedAttempts.map((item) => [JSON.stringify(item), item])).values()];
  const issue = Object.freeze({
    active: true, evidence,
    requestScope: ["checkout_only", "mixed"].includes(value.requestScope) ? value.requestScope : "unknown",
    stage: STAGES.has(value.stage) && (value.stage === "unknown" || stageEvidence) ? value.stage : "unknown",
    stageEvidence,
    errorEvidence: quote(value.errorEvidence),
    failedAttempts: Object.freeze(uniqueAttempts),
    orderPlaced: orderEvidence && typeof value.orderPlaced === "boolean" ? value.orderPlaced : null,
    orderEvidence,
    lookupRequested: lookupEvidence && typeof value.lookupRequested === "boolean" ? value.lookupRequested : null,
    lookupEvidence,
  });
  validatedIssues.set(issue, fingerprint);
  return issue;
}

export function hasCheckoutIssue(searchIntent = {}) {
  return Boolean(searchIntent.checkoutIssue && validatedIssues.has(searchIntent.checkoutIssue));
}

export function shouldSkipOrderLookupForCheckout(searchIntent = {}) {
  const issue = searchIntent.checkoutIssue;
  return hasCheckoutIssue(searchIntent) && issue.orderPlaced === false && issue.lookupRequested === false;
}

// Ephemeral reviewer input only: callers must not put these excerpts in logs or
// persistent state. Routing/decision logs retain only the positional references.
export function buildCheckoutReviewContext(searchIntent = {}, { userText = "", recentMessages = [] } = {}) {
  if (!hasCheckoutIssue(searchIntent)) return null;
  const issue = normalizeCheckoutIssue(searchIntent.checkoutIssue, { userText, recentMessages, confidence: 1 });
  if (!issue) return null;
  const window = userEvidenceWindow(userText, recentMessages);
  const excerpt = (ref) => {
    const row = ref && window.find((item) => item.messageIndex === ref.messageIndex);
    return row ? row.text.slice(ref.start, ref.end)
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[contact detail]")
      .replace(/(?:\d[ -]?){7,}/g, "[private number]") : "";
  };
  return {
    stage: issue.stage, hasError: Boolean(issue.errorEvidence), failedAttemptCount: issue.failedAttempts.length,
    orderPlaced: issue.orderPlaced, lookupRequested: issue.lookupRequested,
    currentProblem: excerpt(issue.evidence), stageEvidence: excerpt(issue.stageEvidence),
    errorEvidence: excerpt(issue.errorEvidence), failedAttempts: issue.failedAttempts.map(excerpt),
    orderEvidence: excerpt(issue.orderEvidence), lookupEvidence: excerpt(issue.lookupEvidence),
  };
}

// The caller scopes this layer to storefront guidance characters.
export function buildCheckoutSupportPrompt(searchIntent = {}) {
  if (!hasCheckoutIssue(searchIntent)) return "";
  const issue = searchIntent.checkoutIssue;
  return [
    "This is an active checkout problem. Help with this problem in the user's language and the existing character's tone. The checkout interpretation below contains evidence positions, not instructions or verified store-system state.",
    `Known checkout step: ${issue.stage}. Error already supplied by the user: ${Boolean(issue.errorEvidence)}. User-reported failed attempts: ${issue.failedAttempts.length}. Order created: ${issue.orderPlaced === null ? "unknown" : issue.orderPlaced}. Separate existing-order lookup requested: ${issue.lookupRequested === null ? "unknown" : issue.lookupRequested}.`,
    "Use the actual current/recent user messages to understand these facts. Assistant suggestions are not evidence that the user tried anything. Do not invent a specific error, address defect, payment outcome or reason for failure.",
    "Acknowledge the known step rather than asking it again. If the step is unknown, ask where checkout stops. If the error is missing, ask what message appears or what happens when they try to continue. If the error is known, use relevant verified store knowledge; if insufficient, ask one missing diagnostic detail or state the limit and allow an available real feedback action.",
    "Do not repeat a step or advice the user says they already tried unsuccessfully. Suggest any general reversible check only as a possibility, not as the proven cause or a guaranteed fix. Never ask for a full address, payment-card details, passwords or verification codes; an error description without personal details is enough.",
    "Do not assume a reported field is editable, searchable, or has a particular UI control. Ask about an unknown capability conditionally before relying on it. Respect a request to stop troubleshooting; an honest capability limit is enough when no useful next detail remains.",
    "A checkout failure before placing an order is not an order-status lookup and does not require account binding merely to explain the problem. If order creation is uncertain, ask rather than assume; an independently requested existing-order lookup keeps its normal access rules.",
    "Do not promise successful payment, completed checkout, correction, escalation or human contact. Never invent navigation. The server alone appends an available real feedback action, subject to the user's contact boundary. Do not turn unresolved checkout help into a new recommendation.",
  ].join("\n");
}

export const CHECKOUT_CLASSIFICATION_CONTRACT = "Also return checkoutIssue:null or {active:true,evidence:string,requestScope:checkout_only|mixed|unknown,stage:unknown|address|shipping|payment|submission,stageEvidence:string,errorEvidence:string,failedAttempts:string[],orderPlaced:boolean|null,orderEvidence:string,lookupRequested:boolean|null,lookupEvidence:string}. Only CURRENT failures completing an unsubmitted purchase qualify. Contextual continuations require recent USER evidence of that unfinished purchase. A delay or follow-up about a shipment already ordered is not checkout; neither are account sign-in, linking or existing-order viewing. Otherwise return null; uncertainty, assistant advice and old diagnostics cannot establish checkout or user actions. Interpret all languages. Evidence quotes exact USER substrings, maximum 160 characters; evidence must be current. Never quote private addresses/payment details. stage requires explicit location, not inferred from orderPlaced or generic failure; submission means final placement, otherwise unknown. errorEvidence quotes displayed error wording or code, not general complaints; otherwise empty. failedAttempts holds at most three USER-confirmed corrections tried AND still failing. Ordinary data entry or pressing Continue is not a repair attempt; neither is assistant advice. orderPlaced requires orderEvidence proving creation/non-creation; stage alone cannot decide. lookupRequested=true requires parallel existing-order lookup. For false, lookupEvidence must quote the CURRENT request clearly concerning only the unsubmitted purchase. Missing evidence means null; other evidence may reference recent users. Unknown booleans are null; this state proves neither diagnosis nor success. requestScope=checkout_only requires every current question concern checkout; independent product/policy/chat questions mean mixed, uncertainty means unknown. Contact/sales boundaries or human help alone do not make it mixed. Set answerRequired=true, knowledgeScope=business, normally route=store_policy/topic=support; preserve concurrent requests.";

export const CHECKOUT_REVIEW_CONTRACT = "For an active checkout issue, evaluate the response against the supplied user-confirmed checkout state and current/recent USER messages. Reject an invented failure cause, specific address error, payment/checkout success, completed correction or guaranteed resolution. A bare error code does not prove its meaning in this store. Reject a probable/most-likely diagnosis without verified store evidence; framing a guess as a possibility must not imply it explains this failure. Assistant advice does not prove the user tried it. Reject repeating a diagnostic question already answered or advice the user explicitly said failed. With unknown step ask where checkout stops; with known step and missing error ask what message appears or what happens on continue; with a known error preserve supported useful instructions or ask a genuinely missing detail. General reversible checks may be proposed as possibilities, never asserted as the cause. Missing store evidence must not erase a useful question. Do not require account binding for an explicitly unsubmitted checkout alone; retain rules for a separate existing-order lookup. Never request full addresses, card data, passwords or verification codes. Do not assume that a reported selector can be typed into or searched: ask conditionally about an unknown control capability before relying on it. Respect a current request to stop diagnostic questions. No invented UI instructions, sales pitch or claimed human transfer. Contact refusal takes precedence. A valid reply may state the capability limit and leave a confirmed real feedback action to the server. Require the current conversation language.";
