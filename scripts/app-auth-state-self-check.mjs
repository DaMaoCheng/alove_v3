import assert from "node:assert/strict";
import { resetAuthenticatedState, resetGuestChatState, resetProfileState } from "../src/app/app-auth-state.js";

function createState() {
  return {
    characters: { current: { id: "character_1" } },
    chat: {
      guest: {
        available: true,
        active: true,
        capability: { text: true },
        siteSlug: "footballkituk",
        mascotCharacterId: "character_1",
        messageLimit: 30,
        messageCount: 12,
        messageWindowResetsAt: "2099-01-01T00:00:00.000Z",
        limitResetTimer: 42,
      },
      session: { id: "session_1" },
      messages: [{ id: "message_1" }],
      contacts: [{ id: "character_1" }],
      unreadByCharacterId: { character_1: 2 },
      voiceAutoplayByCharacterId: { character_1: ["message_1"] },
      sendingByCharacterId: { character_1: true },
      guestPendingRequestByCharacterId: { character_1: "request_1" },
      draftByCharacterId: { character_1: "draft" },
      openProductPanel: { id: "product_1" },
      readyImageToast: { id: "image_1" },
      scrollRestore: { top: 100 },
      loading: true,
      sending: true,
      error: "error",
    },
    profile: {
      open: true,
      tab: "invite",
      data: { nickname: "Old User" },
      loading: true,
      saving: true,
      error: "error",
      saveMessage: "saved",
    },
  };
}

const profileState = createState();
resetProfileState(profileState);
assert.deepEqual(profileState.profile, {
  open: false,
  tab: "profile",
  data: null,
  loading: false,
  saving: false,
  error: "",
  saveMessage: "",
  orders: {
    data: null,
    loading: false,
    error: "",
    detail: null,
    detailLoading: false,
    detailError: "",
  },
});

const guestState = createState();
const guestClearedTimers = [];
resetGuestChatState(guestState, { clearTimer: (timer) => guestClearedTimers.push(timer) });
assert.deepEqual(guestClearedTimers, [42]);
assert.deepEqual(guestState.chat.guest, {
  available: false,
  active: false,
  capability: null,
  siteSlug: "",
  mascotCharacterId: "",
  messageLimit: 0,
  messageCount: 0,
  messageWindowResetsAt: "",
  limitResetTimer: null,
});
assert.equal(guestState.chat.session, null);
assert.deepEqual(guestState.chat.messages, []);
assert.deepEqual(guestState.chat.guestPendingRequestByCharacterId, {});

const logoutState = createState();
resetAuthenticatedState(logoutState, { reason: "logout", clearTimer: assert.fail });
assert.equal(logoutState.profile.open, false);
assert.deepEqual(logoutState.chat.contacts, []);
assert.deepEqual(logoutState.chat.unreadByCharacterId, {});
assert.deepEqual(logoutState.chat.voiceAutoplayByCharacterId, {});
assert.deepEqual(logoutState.chat.sendingByCharacterId, {});
assert.deepEqual(logoutState.chat.messages, [{ id: "message_1" }], "logout should preserve the previous narrower reset boundary");
assert.equal(logoutState.characters.current.id, "character_1", "logout should preserve the previous narrower reset boundary");

const expiredState = createState();
const expiredClearedTimers = [];
resetAuthenticatedState(expiredState, { reason: "expired", clearTimer: (timer) => expiredClearedTimers.push(timer) });
assert.deepEqual(expiredClearedTimers, [42]);
assert.equal(expiredState.characters.current, null);
assert.equal(expiredState.chat.session, null);
assert.deepEqual(expiredState.chat.messages, []);
assert.deepEqual(expiredState.chat.contacts, []);
assert.deepEqual(expiredState.chat.unreadByCharacterId, {});
assert.deepEqual(expiredState.chat.voiceAutoplayByCharacterId, {});
assert.deepEqual(expiredState.chat.sendingByCharacterId, {});
assert.deepEqual(expiredState.chat.guestPendingRequestByCharacterId, {});
assert.deepEqual(expiredState.chat.draftByCharacterId, {});
assert.equal(expiredState.chat.openProductPanel, null);
assert.equal(expiredState.chat.readyImageToast, null);
assert.equal(expiredState.chat.scrollRestore, null);
assert.equal(expiredState.chat.loading, false);
assert.equal(expiredState.chat.sending, false);
assert.equal(expiredState.chat.error, "");
assert.deepEqual(expiredState.profile, {
  open: false,
  tab: "profile",
  data: null,
  loading: false,
  saving: false,
  error: "",
  saveMessage: "",
  orders: {
    data: null,
    loading: false,
    error: "",
    detail: null,
    detailLoading: false,
    detailError: "",
  },
});

console.log("app auth state self-check passed");
