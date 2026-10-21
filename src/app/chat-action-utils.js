import { appendTypingIndicator } from "../features/chat/chat-typing-indicator.js";

export function mergeChatMessages(existingMessages, nextMessages) {
  const messageMap = new Map();
  [...existingMessages, ...nextMessages].forEach((message) => {
    if (message?.id) {
      messageMap.set(message.id, message);
    }
  });
  return [...messageMap.values()].sort((a, b) => {
    const orderDelta = Number(a.displayOrder || 0) - Number(b.displayOrder || 0);
    if (orderDelta) return orderDelta;
    return new Date(a.sentAt || 0).getTime() - new Date(b.sentAt || 0).getTime();
  });
}

export function mergeContacts(contacts, unreadByCharacterId = {}) {
  const contactMap = new Map();
  contacts.forEach((contact) => {
    const characterId = String(contact?.characterId || "").trim();
    if (!characterId) return;
    contactMap.set(characterId, {
      ...contact,
      unread: Boolean(unreadByCharacterId[characterId]),
    });
  });
  return [...contactMap.values()].sort((a, b) => {
    return new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime();
  });
}

export function syncSidebarContactUnread(characterId, unread) {
  document.querySelectorAll('.nav-item[data-view="chat"]').forEach((item) => {
    if (item.dataset.agent !== characterId) return;
    item.querySelector(".nav-av-wrap")?.classList.toggle("has-msg", Boolean(unread));
  });
}

export function createProductPanelMountGuard(appState, characterId) {
  const normalizedCharacterId = String(characterId || "").trim();
  const product = appState.chat.openProductPanel && typeof appState.chat.openProductPanel === "object"
    ? appState.chat.openProductPanel
    : null;
  const shouldPreserve = Boolean(product) && document.body.classList.contains("product-open");

  function restore() {
    if (!shouldPreserve) return;
    if (String(appState.agent || "").trim() !== normalizedCharacterId) return;
    if (!appState.chat.openProductPanel) appState.chat.openProductPanel = product;
  }

  function mount(mountApp) {
    restore();
    mountApp();
  }

  return { mount, restore };
}

export function createChatActionHelpers({ appState, getCurrentView }) {
  function upsertContactFromChatResult({ characterId, session, messages }) {
    const character = appState.characters.current?.id === characterId
      ? appState.characters.current
      : appState.characters.items.find((item) => item.id === characterId);
    const latestMessage = [...messages].reverse().find((message) => message?.senderType === "character") || messages[messages.length - 1] || null;
    const nextContact = {
      sessionId: session?.id || "",
      characterId,
      name: character?.name || session?.title || "AIOVE Character",
      roleTitle: character?.roleTitle || "",
      avatarUrl: character?.avatarUrl || "",
      visibility: character?.visibility || "public",
      characterStatus: character?.characterStatus || "published",
      ownerUid: character?.ownerUid || "",
      isOwnCharacter: Boolean(character?.isOwnCharacter || (character?.ownerUid && character.ownerUid === appState.session.userId)),
      lastMessageAt: latestMessage?.sentAt || session?.lastMessageAt || new Date().toISOString(),
      lastSenderType: latestMessage?.senderType || "",
      lastText: latestMessage?.text || "",
    };
    appState.chat.contacts = mergeContacts([nextContact, ...appState.chat.contacts], appState.chat.unreadByCharacterId);
  }

  function isViewingCharacter(characterId) {
    return getCurrentView?.() === "chat" && appState.agent === characterId;
  }

  function appendCurrentChatTypingIndicator() {
    const root = document.querySelector(".chat-wrap");
    if (root) appendTypingIndicator(root, appState.characters.current || {});
  }

  return {
    appendCurrentChatTypingIndicator,
    isViewingCharacter,
    upsertContactFromChatResult,
  };
}
