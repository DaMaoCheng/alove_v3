import { SERVER_CONFIG } from "./config.js";
import { createPublicError } from "./public-error-utils.js";

export function assertPublicAppOrigin(req) {
  const source = String(req.headers.origin || req.headers.referer || "").trim();
  if (!source) throw createPublicError("Access denied.", 403);
  let actualOrigin = "";
  let expectedOrigin = "";
  try {
    actualOrigin = new URL(source).origin;
    expectedOrigin = new URL(SERVER_CONFIG.publicBaseUrl).origin;
  } catch {
    throw createPublicError("Access denied.", 403);
  }
  if (!actualOrigin || actualOrigin !== expectedOrigin) {
    throw createPublicError("Access denied.", 403);
  }
}
