import { createCharacterActivationActions } from "./character-activation-actions.js";
import { createCharacterAvatarActions } from "./character-avatar-actions.js";
import { createCharacterCreateActions } from "./character-create-actions.js";
import { createCharacterLoadActions } from "./character-load-actions.js";

export function createCharacterActions({ appState, mountApp, loadChatMessages, loadChatContacts } = {}) {
  const loadActions = createCharacterLoadActions({ appState, mountApp, loadChatMessages });
  const createActions = createCharacterCreateActions({
    appState,
    mountApp,
    loadCharacters: loadActions.loadCharacters,
    loadChatContacts,
  });
  const avatarActions = createCharacterAvatarActions({ appState, mountApp });
  const activationActions = createCharacterActivationActions({ loadChatContacts });

  return {
    ...avatarActions,
    ...activationActions,
    ...createActions,
    loadCharacters: loadActions.loadCharacters,
    loadCurrentCharacter: loadActions.loadCurrentCharacter,
    loadCharactersForView: loadActions.loadCharactersForView,
  };
}
