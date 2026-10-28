import assert from "node:assert/strict";
import { buildKnowledgeContextLayer } from "../server/chat-prompt-layers.js";

const mailTrackingReference = "Tracking information is sent by email after the package has been dispatched.";
const deliveryKnowledge = { customerServiceIntent: true, customerServiceTopic: "delivery",
  items: [{ title: "Delivery", content: mailTrackingReference }] };
const deliveryLayer = buildKnowledgeContextLayer(deliveryKnowledge);
assert.doesNotMatch(deliveryLayer.content, /direct the user to the carrier tracking page or store support with their order number and delivery address/i,
  "a mail-only reference must not add unsupported channels or customer-information requirements");
assert.match(deliveryLayer.content, /only when explicitly supported by the applicable references/i,
  "delivery next steps must use the same source boundary as factual review");
assert(deliveryLayer.content.includes(mailTrackingReference), "the actual supported tracking answer remains available");
assert.match(deliveryLayer.content, /retain the supported policy answer/i,
  "missing next-step evidence must not erase an independently verified delivery answer");

const requiredOrderReference = "For an existing order, email store support with your order number.";
const referencedOrderLayer = buildKnowledgeContextLayer({ ...deliveryKnowledge,
  items: [{ title: "Order assistance", content: requiredOrderReference }] });
assert(referencedOrderLayer.content.includes(requiredOrderReference), "verified requirements remain available, including an order number");
assert.doesNotMatch(referencedOrderLayer.content, /never (?:ask for|mention|use) (?:an? |the )?order number/i,
  "source alignment must not introduce a keyword ban on legitimate requirements");

const existingOrderInstruction = "A tracking number cannot be checked or verified by the assistant. For the existing-order lookup use the server-supplied order action and its access requirements, not a guessed external tracking page or a request for delivery-address details in chat. Explain any supplied tracking-status text only from verified evidence; preserve supported general delivery-policy answers.";
for (const status of ["login_required", "binding_required"]) {
  const actionLayer = buildKnowledgeContextLayer(deliveryKnowledge, { orderActionCandidate: {
    kind: "ttmall_order_lookup", siteSlug: "fixture", status,
  } });
  assert(actionLayer.content.includes(existingOrderInstruction), "available order actions retain their complete original instruction");
  assert.doesNotMatch(actionLayer.content, /Give a next step, contact or tracking channel/i,
    "the no-action guidance must not replace a real login/binding entry");
}
const unavailableActionLayer = buildKnowledgeContextLayer(deliveryKnowledge, { orderActionCandidate: {
  kind: "unavailable", siteSlug: "fixture", status: "login_required",
} });
assert.doesNotMatch(unavailableActionLayer.content, /use the server-supplied order action/i,
  "an invalid action does not manufacture lookup authority");
const mixedReference = "Unworn items may be returned within 14 days under the stated conditions.";
const mixedLayer = buildKnowledgeContextLayer({ ...deliveryKnowledge,
  items: [...deliveryKnowledge.items, { title: "Returns", content: mixedReference }] });
assert(mixedLayer.content.includes(mailTrackingReference) && mixedLayer.content.includes(mixedReference),
  "delivery guidance retains separately supported parts of a mixed question");
assert.match(mixedLayer.content, /Answer every supported part of the question/i);
for (const topic of ["returns", "payment", "other"]) {
  const otherLayer = buildKnowledgeContextLayer({ ...deliveryKnowledge, customerServiceTopic: topic });
  assert(otherLayer.content.includes(mailTrackingReference));
  assert.doesNotMatch(otherLayer.content, /tracking number cannot be checked|any required customer information/i,
    "the delivery-only capability instruction must not spread to other topics");
}
const noDeliveryEvidence = buildKnowledgeContextLayer({ ...deliveryKnowledge, items: [] });
assert.match(noDeliveryEvidence.content, /No verified current-site policy reference was found/i);
assert.doesNotMatch(noDeliveryEvidence.content, /carrier tracking page|delivery address|any required customer information/i,
  "an empty reference pool retains its existing no-source contract");
assert.equal(buildKnowledgeContextLayer(null).content, "", "ordinary no-knowledge chat remains unchanged");
console.log("delivery knowledge prompt checks passed (source alignment, real order actions, mixed references and unchanged adjacent topics; no network/DB)");
