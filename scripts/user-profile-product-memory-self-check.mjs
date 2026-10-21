import assert from "node:assert/strict";
import { extractFootballUserMemories } from "../server/chat-memory-extraction-service.js";
import { MEMORY_TYPES } from "../server/chat-memory-taxonomy.js";
import { buildPromptMemoryBlock } from "../server/user-memory-record-service.js";

const inferredMemories = extractFootballUserMemories("That England kit is clean. I might get the Saka shirt too.");

assert.ok(
  inferredMemories.some((memory) => memory.memoryType === MEMORY_TYPES.FAVORITE_TEAM_ENTITY && /England/.test(memory.summary || memory.content)),
  "soft football product/team interest should be stored as favorite_team_entity"
);
assert.ok(
  inferredMemories.some((memory) => memory.memoryType === MEMORY_TYPES.FAVORITE_TEAM_ENTITY && /Saka/.test(memory.summary || memory.content)),
  "soft player interest should be stored as favorite_team_entity"
);

const memoryBlock = buildPromptMemoryBlock([
  {
    memory_type: MEMORY_TYPES.FAVORITE_TEAM_ENTITY,
    summary: "可能喜欢：England",
    content: "用户可能喜欢或正在关注：England",
  },
  {
    memory_type: MEMORY_TYPES.PURCHASED_PRODUCT,
    summary: "曾购买：2024 England Home Jersey",
    content: "用户曾购买产品：2024 England Home Jersey",
  },
]);

assert.match(memoryBlock, /Likely football interests: .*England/, "prompt memory block should expose likely team/player interests");
assert.match(memoryBlock, /Purchased products: .*2024 England Home Jersey/, "prompt memory block should expose imported purchase history");

console.log("user profile product memory self-check passed");
