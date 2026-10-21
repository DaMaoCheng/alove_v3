import assert from "node:assert/strict";
import { normalizeProductFollowupReply, sanitizeProductFollowupText } from "../server/product-followup-sanitizer.js";
import { stripTtsControlTags } from "../server/tts-emotion-tag-service.js";

const product = {
  name: "Matchday Home Kit",
  priceNow: "GBP 59.99",
  subtitle: "Supporter edition",
  stock: "In stock",
  url: "/search?q=Matchday%20Home%20Kit",
};

const dirtyText = [
  "Matchday Home Kit — GBP 59.99 Supporter edition In stock /search?q=Matchday%20Home%20Kit",
  "That’s a clean little matchday shirt, bro — proper easy winner if you want kit vibes without overthinking it.",
].join(" ");

const cleaned = sanitizeProductFollowupText(dirtyText, product);

assert.ok(cleaned, "cleaned follow-up should not be empty");
assert.ok(!/GBP|59\.99|In stock|\/search|Matchday%20Home%20Kit/i.test(cleaned), "cleaned follow-up should remove product metadata");
assert.ok(!cleaned.startsWith(product.name), "cleaned follow-up should not start with the product name list");
assert.equal(cleaned.split(/[.!?。！？]+/).filter(Boolean).length, 1, "cleaned follow-up should be one sentence");

const chinese = sanitizeProductFollowupText("皇家马德里 26款新版球衣 ¥399 现货 /products/real-madrid-26 这件新版皇马球衣就很适合你。", {
  name: "皇家马德里 26款新版球衣",
  priceNow: "¥399",
  stock: "现货",
  url: "/products/real-madrid-26",
});
assert.ok(!/¥399|现货|\/products/.test(chinese), "Chinese metadata should be removed");

const selfDenying = sanitizeProductFollowupText("I don’t sell shirts myself, bro — but this Messi one is a clean pick.", {
  name: "Authentic MESSI #10 Argentina Away Football Shirt 2026",
  priceNow: "33.00",
  stock: "Available",
});
assert.ok(!/don.?t sell shirts|stock shirts|sell shirts myself/i.test(selfDenying), "product follow-up should remove self-denying sales language");

const jsonLeaking = sanitizeProductFollowupText('{"product":{"name":"MESSI #10 Home Football Shirt 2024","subtitle":"","price":29.00,"originalPrice":95.00,"url":"home"}}', {
  name: "Authentic MESSI #10 Argentina Away Football Shirt 2026",
  priceNow: "£33.00",
  priceWas: "£99.00",
});
assert.ok(!/[{}"]|product|originalPrice|price|url|subtitle/i.test(jsonLeaking), "product follow-up should remove leaked JSON payload text");
assert.equal(jsonLeaking, "This one fits the moment nicely.", "pure JSON product leakage should fall back to the default follow-up");

const wrongTeam = sanitizeProductFollowupText(
  "Manchester United Home Football Shirt 2026/27 Manchester United Was That’s a clean home shirt shout, bro proper.",
  {
    name: "AC Milan Home Football Shirt 2026/27",
    subtitle: "AC Milan",
    priceNow: "£25.00",
  }
);
assert.equal(wrongTeam, "This one fits the moment nicely.", "follow-up should not mention a different team than the selected product");

const aiFallback = sanitizeProductFollowupText(
  "I’m here, bro. The product search took a bad first touch, but send me the team, player, size, or budget and I’ll try again.",
  {
    name: "AC Milan Home Football Shirt 2026/27",
    subtitle: "AC Milan",
    priceNow: "£25.00",
  }
);
assert.ok(!/I.?m here|glitched|bad first touch|send me the team|try again/i.test(aiFallback), "AI fallback text should not be used as a product follow-up");
assert.equal(aiFallback, "This one fits your AC Milan mood nicely.", "AI fallback text should become a product-aware follow-up");

const shortAiFallback = sanitizeProductFollowupText("I’m here, bro.", {
  name: "Authentic MESSI #10 Argentina Away Football Shirt 2026",
  subtitle: "Argentina",
});
assert.ok(!/I.?m here/i.test(shortAiFallback), "short AI fallback text should not be used as a product follow-up");
assert.equal(shortAiFallback, "This one fits your Argentina mood nicely.", "short AI fallback text should become a product-aware follow-up");

const emotionalProductFollowup = normalizeProductFollowupReply({
  text: "The AC Milan 125th shirt has that proper San Siro night feel, bro.",
  speechText: "[excited] The AC Milan 125th shirt has that proper San Siro night feel, bro.",
  product: {
    name: "#125 AC Milan 125th Anniversary Long Sleeve Football Shirt 2024/25",
    subtitle: "AC Milan",
    priceNow: "GBP 38.99",
  },
  userText: "AC Milan kit energy check.",
});
assert.equal(
  emotionalProductFollowup.displayText,
  "The AC Milan 125th shirt has that proper San Siro night feel, bro.",
  "product follow-up should allow natural product/team wording in display text"
);
assert.match(
  emotionalProductFollowup.speechText,
  /^\[excited\] The AC Milan 125th shirt has that proper San Siro night feel, bro\.$/,
  "product follow-up should keep the same wording with emotion tags for TTS"
);

const longNaturalFollowup = normalizeProductFollowupReply({
  text: "Go for the Barcelona Home Long Sleeve Football Shirt 2024/25 proper home look, and the long sleeves give it a clean colder-night matchday feel without making the pick sound overthought.",
  speechText: "[happy] Go for the Barcelona Home Long Sleeve Football Shirt 2024/25 proper home look, and the long sleeves give it a clean colder-night matchday feel without making the pick sound overthought.",
  product: {
    name: "Barcelona Home Long Sleeve Football Shirt 2024/25",
    subtitle: "Barcelona",
    priceNow: "GBP 42.00",
  },
  userText: "Pick a home shirt",
});
assert.match(
  longNaturalFollowup.displayText,
  /clean colder night matchday feel without making the pick sound overthought\.$/,
  "product follow-up should no longer hard-clip a natural complete sentence"
);
assert.doesNotMatch(
  longNaturalFollowup.displayText,
  /\bgive it a\.$/i,
  "product follow-up should not end on a dangling article after cleanup"
);
assert.equal(
  stripTtsControlTags(longNaturalFollowup.speechText),
  longNaturalFollowup.displayText,
  "product follow-up speech text should match display text after removing emotion tags"
);

const protectedDiscountFollowup = normalizeProductFollowupReply({
  text: "有呀，用 TEST 可以享受 $0.01 off entire order，结账时记得填上。 In stock https://evil.example",
  speechText: "有呀，用 TEST 可以享受 $0.01 off entire order，结账时记得填上。 In stock https://evil.example",
  product,
  userText: "有折扣吗？",
  protectedLiterals: ["TEST", "$0.01 off entire order"],
});
assert.match(protectedDiscountFollowup.displayText, /TEST/, "verified discount code should survive product cleanup");
assert.match(protectedDiscountFollowup.displayText, /\$0\.01 off entire order/, "verified offer description should survive product cleanup");
assert.doesNotMatch(protectedDiscountFollowup.displayText, /In stock|https?:\/\//i, "unverified stock and URLs must still be removed");
assert.doesNotMatch(protectedDiscountFollowup.displayText, /，\s+/, "visible Chinese punctuation should not gain robotic spacing");

console.log("product follow-up sanitizer self-check passed");
