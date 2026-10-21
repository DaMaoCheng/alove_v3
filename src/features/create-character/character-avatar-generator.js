import { generateCharacterAvatar as requestGeneratedCharacterAvatar } from "../../services/character-service.js";

export async function generateCharacterAvatar(payload = {}) {
  const result = await requestGeneratedCharacterAvatar(payload);
  const avatarUrl = String(result.avatarUrl || "").trim();
  if (!avatarUrl) {
    throw new Error("AI avatar generation failed. Please try again.");
  }

  return {
    avatarUrl,
    prompt: String(result.prompt || "").trim(),
  };
}
