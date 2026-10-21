import assert from "node:assert/strict";
import { ApiError } from "../src/services/http-client.js";
import { getRawErrorMessage, getUserFacingErrorMessage } from "../src/utils/user-facing-error.js";

assert.equal(
  getUserFacingErrorMessage(new Error("SQL syntax error near users.auth_token"), {
    pageLanguage: "English",
    fallbackType: "chat",
  }),
  "Message failed. Please try again.",
  "system errors should not be shown to users"
);

assert.equal(
  getUserFacingErrorMessage(new ApiError("密码必须包含字母和数字", { status: 400 }), {
    pageLanguage: "English",
    fallbackType: "auth",
  }),
  "Unable to continue. Please check your details and try again.",
  "English pages should not show Chinese validation copy"
);

assert.equal(
  getUserFacingErrorMessage(new ApiError("Password must include letters and numbers.", { status: 400 }), {
    pageLanguage: "English",
    fallbackType: "auth",
  }),
  "Password must include letters and numbers.",
  "safe English validation copy should be preserved"
);

assert.equal(
  getUserFacingErrorMessage(new ApiError("附件文件无效", { status: 400 }), {
    pageLanguage: "中文",
    fallbackType: "attachment",
  }),
  "附件文件无效",
  "safe Chinese validation copy should be preserved on Chinese pages"
);

assert.equal(
  getUserFacingErrorMessage(new ApiError("Internal provider HTTP 502 OpenAI error", { status: 502 }), {
    pageLanguage: "English",
    fallbackType: "voice",
  }),
  "The voice message couldn't be sent. Please try again.",
  "5xx provider details should be hidden"
);

assert.equal(
  getUserFacingErrorMessage(new TypeError("Failed to fetch"), {
    pageLanguage: "English",
    fallbackType: "profileLoad",
  }),
  "Network connection failed. Please try again.",
  "network failures should use network copy"
);

assert.equal(
  getRawErrorMessage(new Error("raw failure")),
  "raw failure",
  "raw message helper should preserve analytics reason"
);

console.log("user-facing error self-check passed");
