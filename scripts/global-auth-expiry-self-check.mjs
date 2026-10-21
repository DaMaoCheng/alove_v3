import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const httpClientSource = readFileSync("src/services/http-client.js", "utf8");
const mainSource = readFileSync("src/app/main.js", "utf8");
const authStateSource = readFileSync("src/app/app-auth-state.js", "utf8");

assert.match(httpClientSource, /response\.status === 401[\s\S]*notifyAuthExpired/, "http client should publish auth expiry on 401");
assert.match(httpClientSource, /aiove:auth-expired/, "http client should use a shared auth expiry event");
assert.match(httpClientSource, /typeof window === "undefined"/, "auth expiry event should be browser-only");

assert.match(mainSource, /window\.addEventListener\("aiove:auth-expired", handleAuthExpired\)/, "app should listen for global auth expiry");
assert.match(mainSource, /function handleAuthExpired\(\)/, "app should centralize auth expiry handling");
assert.match(mainSource, /sessionStore\.clearSession\(\)/, "auth expiry should clear persisted session");
assert.match(mainSource, /syncSessionState\(appState, sessionStore\)/, "auth expiry should sync cleared session into app state");
assert.match(mainSource, /resetAuthenticatedState\(appState, \{ reason: "expired" \}\)/, "auth expiry should clear authenticated page state");
assert.match(authStateSource, /appState\.chat\.loading = false/, "auth expiry should clear chat loading state");
assert.match(authStateSource, /resetProfileState\(appState\)/, "auth expiry should close and clear profile modal state");
assert.match(mainSource, /currentView = "login"/, "auth expiry should route back to login");
assert.match(mainSource, /pushViewPath\(appState, "login", true\)/, "auth expiry should replace the current route with login");
assert.match(mainSource, /authExpiredHandled = false/, "successful login or register should reset auth expiry guard");

console.log("global auth expiry self-check passed");
