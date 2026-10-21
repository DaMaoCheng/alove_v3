import assert from "node:assert/strict";
import {
  AGE_GATE_MAX_AGE_SECONDS,
  getAgeGateCookieName,
  readAgeGateCookie,
  shouldRequireAgeGate,
} from "../src/features/age-gate/age-gate.js";

assert.equal(AGE_GATE_MAX_AGE_SECONDS, 604800);
assert.equal(getAgeGateCookieName("cf"), "aiove_age_verified_cf");
assert.equal(readAgeGateCookie("aiove_age_verified_cf=1", "cf"), true);
assert.equal(readAgeGateCookie("aiove_age_verified_cf=0", "cf"), false);
assert.equal(shouldRequireAgeGate("/cf/chat"), true);
assert.equal(shouldRequireAgeGate("/admin"), false);
assert.equal(shouldRequireAgeGate("/creator/characters"), false);
console.log("age-gate self-check passed");
