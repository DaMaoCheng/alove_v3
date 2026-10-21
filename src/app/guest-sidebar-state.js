export function resolveAppShellContacts(appState = {}) {
  const guestActive = appState.chat?.guest?.active === true && !appState.session?.authenticated;
  if (!guestActive) return Array.isArray(appState.chat?.contacts) ? appState.chat.contacts : [];

  const characterIds = [...new Set([
    String(appState.chat?.guest?.mascotCharacterId || "").trim(),
    ...(appState.chat?.guest?.contactCharacterIds || []).map((id) => String(id || "").trim()),
  ].filter(Boolean))];
  if (!characterIds.length) return [];
  const characters = Array.isArray(appState.characters?.items) ? appState.characters.items : [];
  const current = appState.characters?.current;
  return characterIds.map((characterId) => {
    const character = String(current?.id || "") === characterId
      ? current
      : characters.find((item) => String(item?.id || "") === characterId);
    return {
      characterId,
      name: character?.name || appState.chat?.guest?.capability?.mascotName || "AIOVE Character",
      avatarUrl: character?.avatarUrl || appState.chat?.guest?.capability?.mascotAvatarUrl || "",
    };
  });
}
