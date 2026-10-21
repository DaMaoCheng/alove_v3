import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const navigationSource = readFileSync("src/app/app-navigation.js", "utf8");

assert.match(navigationSource, /function clearSearchQueryForView\(appState, nextView\)/, "navigation should centralize search query reset behavior");
assert.match(navigationSource, /clearSearchQueryForView\(appState, nextView\);[\s\S]*setCurrentView\(nextView\);/, "navigate should clear search query before mounting the next view");
assert.match(navigationSource, /function navigateApp\(view, agent\)[\s\S]*clearSearchQueryForView\(appState, nextView\);[\s\S]*setCurrentView\(nextView\);/, "navigateApp should clear search query before mounting the next view");
assert.match(navigationSource, /function handlePopState\(\)[\s\S]*clearSearchQueryForView\(appState, nextView\);[\s\S]*setCurrentView\(nextView\);/, "browser back or forward navigation should clear search query before mounting the next view");
assert.match(navigationSource, /appState\.search\.query = "";/, "search query reset should clear the persisted app state value");

console.log("search navigation reset self-check passed");
