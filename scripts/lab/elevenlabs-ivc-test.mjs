import { readFile } from "node:fs/promises";
import { basename } from "node:path";

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

async function readErrorText(response) {
  const text = await response.text();
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

const apiKey = requireApiKey();
const audioPath = process.argv[2] || readEnv("ELEVENLABS_CLONE_SAMPLE");
const name = readEnv("ELEVENLABS_CLONE_NAME", "Alove Lab Clone Test");
const description = readEnv("ELEVENLABS_CLONE_DESCRIPTION", "Temporary local ElevenLabs IVC test voice.");
const removeBackgroundNoise = readEnv("ELEVENLABS_REMOVE_BACKGROUND_NOISE", "false") === "true";
const confirmClone = readEnv("ELEVENLABS_CONFIRM_CLONE") === "1";

if (!audioPath) {
  throw new Error("Missing sample audio path. Pass it as argv[2] or ELEVENLABS_CLONE_SAMPLE.");
}

if (!confirmClone) {
  throw new Error("Voice cloning is disabled by default. Set ELEVENLABS_CONFIRM_CLONE=1 only for authorized samples.");
}

const audioBuffer = await readFile(audioPath);
if (!audioBuffer.length) {
  throw new Error(`Sample audio is empty: ${audioPath}`);
}

const form = new FormData();
form.set("name", name);
form.set("description", description);
form.set("remove_background_noise", String(removeBackgroundNoise));
form.append("files", new Blob([audioBuffer]), basename(audioPath));

const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
  method: "POST",
  headers: {
    "xi-api-key": apiKey,
  },
  body: form,
});

if (!response.ok) {
  throw new Error(`ElevenLabs IVC failed: HTTP ${response.status}\n${await readErrorText(response)}`);
}

const result = await response.json();
console.log("IVC 创建成功：");
console.log(`- voiceId: ${result.voice_id || result.voiceId || "-"}`);
console.log(`- requiresVerification: ${result.requires_verification ?? result.requiresVerification ?? "-"}`);
console.log(`- removeBackgroundNoise: ${removeBackgroundNoise}`);
