import assert from "node:assert/strict";
import { buildChatReplyPrompt } from "../server/chat-prompt-service.js";

const mascotPrompt = buildChatReplyPrompt({
  character: {
    id: "mascot_template",
    name: "Kit",
    category_id: "mascot",
    persona_prompt: "Helpful football shopping guide.",
  },
  recentMessages: [],
  userText: "What shirt should I buy?",
  productContext: {
    siteName: "GG",
    siteSlug: "gogoalshop",
    products: [
      {
        name: "England Home Shirt 2026",
        price: "GBP 59.99",
        stock: "in stock",
        url: "https://example.com/england-home",
        summary: "Home kit for adult supporters.",
      },
    ],
  },
});

assert.ok(
  mascotPrompt.systemPrompt.includes("## Site Product Context"),
  "mascot prompt should include site product context"
);
assert.ok(
  mascotPrompt.systemPrompt.includes("England Home Shirt 2026"),
  "mascot prompt should include normalized product name"
);
assert.ok(
  mascotPrompt.layers.some((layer) => layer.id === "site_product_context"),
  "mascot prompt should expose product context layer metadata"
);

const normalPrompt = buildChatReplyPrompt({
  character: {
    id: "char_normal",
    name: "Normal Character",
    category_id: "babe",
  },
  recentMessages: [],
  userText: "What shirt should I buy?",
  productContext: {
    siteName: "GG",
    siteSlug: "gogoalshop",
    products: [{ name: "Should Not Appear" }],
  },
});

assert.ok(
  !normalPrompt.systemPrompt.includes("Should Not Appear"),
  "non-mascot prompt should ignore product context"
);
assert.ok(
  !normalPrompt.layers.some((layer) => layer.id === "site_product_context"),
  "non-mascot prompt should not expose product context layer"
);

const creatorPrompt = buildChatReplyPrompt({
  character: {
    id: "creator_dani",
    name: "Dani",
    category_id: "creator",
    persona_prompt: "Creator-backed football host.",
  },
  recentMessages: [],
  userText: "What shirt should I buy?",
  productContext: {
    siteName: "FKK",
    siteSlug: "footballkituk",
    products: [{ name: "England Away Shirt 2026", price: "GBP 64.99" }],
  },
});

assert.ok(
  creatorPrompt.systemPrompt.includes("England Away Shirt 2026"),
  "creator prompt should include site product context"
);
assert.ok(
  creatorPrompt.layers.some((layer) => layer.id === "site_product_context"),
  "creator prompt should expose product context layer metadata"
);
assert.match(
  creatorPrompt.systemPrompt,
  /Do not say you do not sell shirts/i,
  "creator product prompt should prevent self-denying product replies"
);
assert.match(
  creatorPrompt.systemPrompt,
  /help the user browse or choose products from the configured site/i,
  "creator product prompt should define the role as site product guidance"
);
assert.match(
  creatorPrompt.systemPrompt,
  /Generate the final follow-up directly/i,
  "creator product prompt should ask the model to produce final product follow-up copy directly"
);
assert.match(
  creatorPrompt.systemPrompt,
  /may naturally mention the product, team, player, style, or matchday use/i,
  "creator product prompt should allow natural product context instead of relying on post-cleanup"
);

const creatorProductFallbackPrompt = buildChatReplyPrompt({
  character: {
    id: "creator_dani",
    name: "Dani",
    category_id: "creator",
    persona_prompt: "Creator-backed football host.",
  },
  recentMessages: [],
  userText: "Do you have a Messi jersey?",
  productContext: null,
});

assert.match(
  creatorProductFallbackPrompt.systemPrompt,
  /The user is asking about products/i,
  "creator prompt should include a fallback product guidance rule when the user asks about products"
);
assert.match(
  creatorProductFallbackPrompt.systemPrompt,
  /Apologize briefly and sincerely in character/i,
  "an unmatched product request should receive a controlled character-aware apology"
);
assert.match(
  creatorProductFallbackPrompt.systemPrompt,
  /suggest using the Search page/i,
  "an unmatched product request should guide the user to the Search page"
);
assert.match(
  mascotPrompt.systemPrompt,
  /Every listed product is a confirmed catalogue result/i,
  "a confirmed product context must prevent the model from denying a listed result"
);

console.log("mascot product prompt self-check passed");
