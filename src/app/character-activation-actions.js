import { trackEvent } from "../analytics/track.js";
import { activateCharacter } from "../services/character-service.js";

export function createCharacterActivationActions({ loadChatContacts } = {}) {
  async function handleActivateCharacter(characterId) {
    const result = await activateCharacter(characterId);
    if (result.activated) {
      await loadChatContacts?.();
      trackEvent("character_activated", { character_id: characterId });
    } else if (result.alreadyActivated) {
      trackEvent("character_activation_duplicate", { character_id: characterId });
    }
    return result;
  }

  return { handleActivateCharacter };
}
