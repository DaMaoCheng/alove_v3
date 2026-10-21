import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSessionStore } from "../src/store/session-store.js";

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  },
};

const store = createSessionStore();
store.setSession({
  userId: "user_a",
  email: "old@example.com",
  nickname: "Old User",
  avatarUrl: "/old.png",
  siteSlug: "gogoalshop",
});
store.setSession({
  userId: "user_b",
  email: "new@example.com",
  nickname: "New User",
});

const switched = store.getState();
assert.equal(switched.userId, "user_b", "account switch should use the new user id");
assert.equal(switched.email, "new@example.com", "account switch should use the new user email");
assert.equal(switched.nickname, "New User", "account switch should use the new user nickname");
assert.equal(switched.avatarUrl, "", "account switch should not inherit the previous user's avatar");
assert.equal(switched.siteSlug, "", "account switch should not inherit the previous user's site slug");

store.setSession({
  userId: "user_b",
  email: "newer@example.com",
});
const sameUserUpdate = store.getState();
assert.equal(sameUserUpdate.nickname, "New User", "same-user partial updates may preserve existing display fields");

const sessionActionsSource = readFileSync("src/app/app-session-actions.js", "utf8");
const authStateSource = readFileSync("src/app/app-auth-state.js", "utf8");
const mainSource = readFileSync("src/app/main.js", "utf8");

assert.match(authStateSource, /export function resetProfileState\(appState\)/, "shared auth state should own profile cache reset");
assert.match(authStateSource, /appState\.profile\.data = null;/, "shared profile reset should clear cached profile data");
assert.equal(
  (sessionActionsSource.match(/applyAuthenticatedSession\(result, \{ resetProfileBefore: true, resetGuest: true \}\)/g) || []).length,
  2,
  "login and register should both reset profile and guest state while applying the new session"
);
assert.ok((sessionActionsSource.match(/resetProfileState\(appState\)/g) || []).length >= 4, "unauthenticated hydrate, auth failure, and authenticated session replacement should clear profile cache");
assert.match(
  sessionActionsSource,
  /resetProfileAfter: Boolean\(previousUserId && previousUserId !== result\.user\.id\)/,
  "hydrating a different authenticated account should clear stale profile cache"
);
assert.match(mainSource, /resetAuthenticatedState\(appState, \{ reason: "expired" \}\)/, "global auth expiry should use the shared authenticated-state reset");

console.log("auth account switch profile cache self-check passed");
