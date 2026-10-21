import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

function readEnv(name, fallback = "") {
  return (process.env[name] || fallback).trim();
}

function requireApiKey() {
  const apiKey = readEnv("ELEVENLABS_API_KEY");
  if (!apiKey) {
    throw new Error("Missing ELEVENLABS_API_KEY. Export it before running this script.");
  }
  return apiKey;
}

function normalizeItems(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.voices)) return response.voices;
  if (Array.isArray(response?.models)) return response.models;
  return [];
}

const client = new ElevenLabsClient({ apiKey: requireApiKey() });

const modelsResponse = await client.models.list();
const models = normalizeItems(modelsResponse)
  .filter((model) => model.canDoTextToSpeech !== false)
  .map((model) => ({
    id: model.modelId || model.model_id || model.id,
    name: model.name,
    languages: model.languages?.length || 0,
    costMultiplier: model.costMultiplier ?? model.cost_multiplier ?? "-",
  }))
  .filter((model) => model.id);

console.log("可用 TTS 模型：");
for (const model of models) {
  console.log(`- ${model.id} | ${model.name || "-"} | languages=${model.languages} | cost=${model.costMultiplier}`);
}

const voicesResponse = await client.voices.search({ pageSize: 100 });
const voices = normalizeItems(voicesResponse).map((voice) => ({
  id: voice.voiceId || voice.voice_id || voice.id,
  name: voice.name,
  category: voice.category || "-",
  labels: voice.labels || {},
}));

console.log("\n可用音色（前 30 个）：");
for (const voice of voices.slice(0, 30)) {
  const labelText = Object.values(voice.labels).filter(Boolean).slice(0, 4).join(" / ");
  console.log(`- ${voice.id} | ${voice.name || "-"} | ${voice.category}${labelText ? ` | ${labelText}` : ""}`);
}

console.log(`\n共读取音色：${voices.length}`);
