import assert from "node:assert/strict";
import { buildChatReplyPrompt } from "../server/chat-prompt-service.js";

const prompt = buildChatReplyPrompt({
  character: {
    id: "character_context_check",
    name: "Context Check",
    personaPrompt: "Keep continuity.",
    profile: { language: "English", style: "Concise" },
  },
  recentMessages: [
    { senderType: "user", text: "history marker one" },
    { senderType: "character", text: "history reply one" },
  ],
  userText: "current marker",
});

assert.equal(prompt.messages.length, 3, "history and current message should stay in standard messages");
assert.equal(prompt.messages[0].content, "history marker one");
assert.match(prompt.systemPrompt, /standard user and assistant message list/);
assert.doesNotMatch(prompt.systemPrompt, /history marker one/);
assert.doesNotMatch(prompt.systemPrompt, /history reply one/);
assert.doesNotMatch(prompt.systemPrompt, /Current user message: current marker/);

const storefrontGuidePrompt = buildChatReplyPrompt({
  character: { id: "mascot_context_check", name: "Context Check", category_id: "mascot", profile: { language: "English" } },
  userText: "Can I customize?",
});
assert.match(storefrontGuidePrompt.systemPrompt, /current site's independent storefront as the default subject/i, "mascots should default to the active storefront instead of Alove features");
assert.match(storefrontGuidePrompt.systemPrompt, /Unless the user explicitly asks about Alove itself/i, "mascots should switch to Alove only on an explicit request");

const creatorStorefrontGuidePrompt = buildChatReplyPrompt({
  character: { id: "creator_context_check", name: "Context Check", category_id: "creator", profile: { language: "English" } },
  userText: "Can I customize?",
});
assert.match(creatorStorefrontGuidePrompt.systemPrompt, /current site's independent storefront as the default subject/i, "creators should share the storefront-first policy");
assert.match(creatorStorefrontGuidePrompt.systemPrompt, /No feedback action has been reserved for this turn/i, "no action candidate must not invent a contact invitation");
assert.match(creatorStorefrontGuidePrompt.systemPrompt, /For a football-jersey customization request, confirm that customization is available/i, "creators should confirm the shared jersey-customization contact flow");
assert.match(creatorStorefrontGuidePrompt.systemPrompt, /Do not repeat the contact-email or feedback-action instruction/i, "the model must leave the contact invitation to the standardized appended handoff");
assert.match(creatorStorefrontGuidePrompt.systemPrompt, /without.*promising follow-up/i, "missing contact action must not promise follow-up");
const contactCandidatePrompt = buildChatReplyPrompt({
  character: { id: "creator_context_check", category_id: "creator", profile: { language: "English" } },
  feedbackActionCandidate: { kind: "feedback", label: "Click here" },
});
assert.match(contactCandidatePrompt.systemPrompt, /system will append one real feedback action/i, "a server-selected action reserves exactly one handoff");
assert.match(contactCandidatePrompt.systemPrompt, /user still needs to submit/i, "feedback navigation must not imply that the request has already been submitted");

const ordinaryCharacterPrompt = buildChatReplyPrompt({
  character: { id: "babe_context_check", name: "Context Check", category_id: "babe", profile: { language: "English" } },
  userText: "Can I customize?",
});
assert.doesNotMatch(ordinaryCharacterPrompt.systemPrompt, /current site's independent storefront as the default subject/i, "the storefront-first policy must not be imposed on unrelated character categories");
assert.doesNotMatch(ordinaryCharacterPrompt.systemPrompt, /For a football-jersey customization request, confirm that customization is available/i, "the storefront customization policy must stay scoped to mascot and creator characters");

const emailPrompt = buildChatReplyPrompt({
  character: { id: "mascot_context_check", name: "Context Check", category_id: "mascot", profile: { language: "English" } },
  recentMessages: [{ senderType: "user", text: "Please contact me at previous@example.com" }],
  userText: "My email is current@example.com",
  userContext: { memoryBlock: "Contact email: remembered@example.com" },
});
const fullEmailPrompt = `${emailPrompt.systemPrompt}\n${emailPrompt.messages.map((message) => message.content).join("\n")}`;
assert.doesNotMatch(fullEmailPrompt, /(?:previous|current|remembered)@example\.com/i, "chat contact emails must not enter any model prompt layer");
assert.match(fullEmailPrompt, /\[contact email provided\]/i, "the model should only receive a contact-email marker");

const customizationPrompt = buildChatReplyPrompt({
  character: { id: "mascot_context_check", name: "Context Check", profile: { language: "English" } },
  userText: "I mean customize the jersey I buy",
  productContext: {
    searchIntent: { customizationRequest: "jersey" },
    products: [],
  },
});
assert.match(customizationPrompt.systemPrompt, /football jersey, not creating or editing a virtual character/i, "a jersey customization question must not be diverted into character creation");
assert.match(customizationPrompt.systemPrompt, /customization is available through the site team/i, "customization guidance must confirm the site-supported contact flow");
assert.match(customizationPrompt.systemPrompt, /system appends that one standardized contact handoff/i, "customization guidance must reserve the feedback invitation for one standardized handoff");

const noMatchCustomizationPrompt = buildChatReplyPrompt({
  character: { id: "mascot_context_check", name: "Context Check", profile: { language: "English" } },
  userText: "Man united name and number for 18 to 24 months",
  productContext: {
    searchIntent: { requestedTeam: "Manchester United", requestedAgeRange: "18-24 months", productCustomizationRequest: true },
    products: [],
  },
});
assert.match(noMatchCustomizationPrompt.systemPrompt, /No exact catalogue match was confirmed/i, "a missing exact age-size customization request must stay a no-match, not an adult fallback card");

const nearestAgePrompt = buildChatReplyPrompt({
  character: { id: "mascot_context_check", name: "Context Check", profile: { language: "English" } },
  userText: "I need a Manchester United kit for a 1 year old",
  productContext: {
    searchIntent: { requestedTeam: "Manchester United", requestedAgeRange: "1 year" },
    products: [{ name: "Kids Manchester United Home Soccer Jersey", ageSizeFallback: { sizeLabel: "#16", ageReference: "2–3" } }],
  },
});
assert.match(nearestAgePrompt.systemPrompt, /not an exact age match/i, "a nearest-size card must require a truthful age-fallback explanation");
assert.match(nearestAgePrompt.systemPrompt, /age reference 2–3 years/i, "the prompt must pass through the specific closest chart age");
console.log("chat prompt context self-check passed");
