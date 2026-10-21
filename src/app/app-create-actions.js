export function createAppCreateActions({
  appState,
  characterActions,
  navigationActions,
  mountAppPreservingMainScroll,
} = {}) {
  function setCreateField(key, value) {
    appState.create[key] = value;
    appState.create.dirty = true;
    appState.create.error = "";
    appState.create.polishError = "";
    if (["name", "language", "languageCode", "languageSearch", "openingLine", "backstory", "isPublic"].includes(key)) {
      return;
    }
    mountAppPreservingMainScroll();
  }

  async function handleCreateCharacterSubmit(payload) {
    const character = await characterActions.handleCreateCharacterSubmit(payload);
    if (character?.id) {
      characterActions.resetCreateDraftState();
      navigationActions.navigateApp("chat", character.id);
    }
  }

  return {
    setCreateField,
    handleCreateCharacterSubmit,
  };
}
