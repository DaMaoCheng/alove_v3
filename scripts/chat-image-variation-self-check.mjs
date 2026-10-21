import assert from "node:assert/strict";
import {
  createChatImageVariation,
  getChatImageVariationInstruction,
  resolveChatImageRequestConstraints,
} from "../server/chat-image-variation-service.js";

const base = {
  assetId: "chat_img_variation_a",
  messageId: "msg_variation_a",
  characterId: "char_variation_a",
  userText: "Take a photo for me",
};
const first = createChatImageVariation(base);
const retry = createChatImageVariation(base);
const next = createChatImageVariation({ ...base, assetId: "chat_img_variation_b" });

assert.deepEqual(retry, first, "the same image task must keep the same variation on retry");
assert.notEqual(next.code, first.code, "a different image task should distribute to a different variation");
assert.match(first.code, /^\d+-\d+-\d+-\d+-\d+-\d+$/, "variation code should contain six stable dimension indexes");
assert.match(getChatImageVariationInstruction(first), new RegExp(`Fixed variation code: ${first.code.replace(/-/g, "\\-")}`), "prompt instruction should expose the fixed variation code");
assert.doesNotMatch(getChatImageVariationInstruction(first), /choose a natural variation|may vary naturally/i, "prompt instruction must not ask the model to choose a random variation");

const tryOn = resolveChatImageRequestConstraints({
  userText: "Can you wear it in size M for me?",
  latestProduct: { name: "Barcelona Third Shirt" },
});
assert.equal(tryOn.usesProductReference, true, "explicit try-on should use the current product reference");
assert.match(
  createChatImageVariation({ ...base, constraints: tryOn }).wardrobe,
  /wear exactly the requested product/i,
  "product try-on must override random wardrobe selection"
);

const ordinary = resolveChatImageRequestConstraints({
  userText: "Take a relaxed portrait photo",
  latestProduct: { name: "Old product from an earlier chat turn" },
});
assert.equal(ordinary.usesProductReference, false, "ordinary photos must not inherit an unrelated historical product");

const genericJerseyPortrait = resolveChatImageRequestConstraints({
  userText: "Take a portrait in a football jersey.",
  latestProduct: { name: "Barcelona Third Away Football Shirt" },
});
assert.equal(genericJerseyPortrait.usesProductReference, false, "generic jersey wording must not bind an unrelated historical product");

for (const userText of [
  "Bu formayı giyer misin?",
  "Vedd fel ezt a mezt, kérlek.",
  "Porte ce maillot, s'il te plaît.",
]) {
  const localizedTryOn = resolveChatImageRequestConstraints({
    userText,
    latestProduct: { name: "Barcelona Third Away Football Shirt" },
  });
  assert.equal(localizedTryOn.usesProductReference, true, `localized try-on should keep the current product reference: ${userText}`);
}

const historicalUserImage = resolveChatImageRequestConstraints({
  userText: "Take a relaxed portrait photo.",
  latestUserImage: { url: "/api/uploads/chat/older-photo.webp" },
});
assert.equal(historicalUserImage.usesUserImageReference, false, "ordinary photos must not inherit an unrelated historical user image");

// 否定语义：兜底正则路径（无 semanticConditions）。普通否定 → 不误判穿戴 / 无服装。
const plainNegation = resolveChatImageRequestConstraints({ userText: "我想要不要红色的" });
assert.equal(plainNegation.wants_no_clothing, false, "plain color negation must not resolve wants_no_clothing");
assert.equal(plainNegation.wants_clothing, false, "plain color negation must not resolve as wear");
assert.equal(plainNegation.wantsWear, false, "plain color negation must not set wantsWear");
assert.equal(plainNegation.usesProductReference, false, "plain color negation must not bind a product");

const hatNegation = resolveChatImageRequestConstraints({ userText: "去掉帽子" });
assert.equal(hatNegation.wants_no_clothing, false, "accessory negation must not resolve wants_no_clothing");
assert.equal(hatNegation.wants_clothing, false, "accessory negation must not resolve as wear");

const negatedClothing = resolveChatImageRequestConstraints({ userText: "take a photo without clothing" });
assert.equal(negatedClothing.wants_no_clothing, true, "explicit no-clothes should resolve wants_no_clothing");
assert.equal(negatedClothing.wants_clothing, false, "explicit no-clothes must not resolve as wear");
assert.equal(negatedClothing.wantsWear, false, "explicit no-clothes must not set wantsWear");
assert.equal(negatedClothing.usesProductReference, false, "explicit no-clothes must not bind a product");

// 否定被明确穿戴请求翻转：穿上 + 否定 → 仍判穿戴
const negationOverridden = resolveChatImageRequestConstraints({ userText: "try this on without underwear", latestProduct: { name: "Barcelona Third Away Football Shirt" } });
assert.equal(negationOverridden.wants_clothing, true, "try this on should flip negation back to clothing");
assert.equal(negationOverridden.usesProductReference, true, "try this on should still bind the product");

// 语义上游结论优先：给了 semanticConditions 时走它，不受正则影响
const semanticNegation = resolveChatImageRequestConstraints({
  userText: "帮我拍张不带服装的",
  semanticConditions: { wants_no_clothing: true, wants_clothing: false },
});
assert.equal(semanticNegation.wants_no_clothing, true, "semantic wants_no_clothing should win");
assert.equal(semanticNegation.wants_clothing, false, "semantic wants_clothing false should win");
assert.equal(semanticNegation.wantsWear, false, "semantic should not set wantsWear");
assert.deepEqual(semanticNegation.conditions, { wants_no_clothing: true, wants_clothing: false }, "semantic conditions should be returned verbatim");

const semanticTryOn = resolveChatImageRequestConstraints({
  userText: "穿上这件球衣给我看",
  latestProduct: { name: "Barcelona Third Away Football Shirt" },
  semanticConditions: { wants_no_clothing: false, wants_clothing: true },
});
assert.equal(semanticTryOn.wants_clothing, true, "semantic wants_clothing should win");
assert.equal(semanticTryOn.usesProductReference, true, "semantic clothing request should bind the product");

console.log("chat image variation self-check passed");
