import { inspectAiReplyQuality } from "../server/ai-reply-quality-service.js";
import { inspectMemoryNoise } from "../server/chat-memory-noise-service.js";

const structuredLeakSamples = [
  `{"displayText":"干净可见正文","speechText":"语音稿","voiceMeta":{"speed":1}}`,
  `{"displayText":"畸形也应该只露这句",{"speechText":"不要露",{"voiceMeta":{"x":1}}`,
  `displayText: "无引号字段也应该尽量提取", speechText: "不要露"`,
];

const results = structuredLeakSamples.map((sample) => {
  const inspected = inspectAiReplyQuality({
    text: sample,
    userText: "聊比赛",
  });
  return {
    sample,
    severity: inspected.severity,
    finalText: inspected.finalText,
    reasons: inspected.reasons,
    leaked: /displayText|speechText|voiceMeta/.test(inspected.finalText),
  };
});

const failed = results.filter((item) => item.leaked || !item.finalText);
const probeNoise = inspectMemoryNoise("Reply with one word: win");
console.log(JSON.stringify({
  ok: failed.length === 0 && probeNoise.reject,
  structuredReplyLeak: results,
  testProbeNoise: probeNoise,
}, null, 2));

if (failed.length || !probeNoise.reject) {
  process.exit(1);
}

process.exit(0);
