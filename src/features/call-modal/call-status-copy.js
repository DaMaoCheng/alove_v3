import { createSiteCopy } from "../../i18n/site-copy.js";

const TURN_STATUS_KEYS = Object.freeze({
  connecting: "call.connecting",
  listening: "call.listening",
  heard: "call.heard",
  thinking: "call.replying",
  replying: "call.replying",
  speaking: "call.speaking",
  paused: "call.paused",
  muted: "call.muted",
  connected: "call.connected",
  ready: "call.connected",
  shop: "call.shop",
  ended: "call.ended",
  "call ended": "call.ended",
  unavailable: "call.unavailable",
  "call unavailable": "call.unavailable",
  active: "call.active",
  "on call": "call.active",
});

export function resolveCallStatusCopy({ status = "", turnStatus = "", error = "", pageLanguage = "English" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  if (error) return copy.t("call.unavailable");
  const normalizedTurnStatus = String(turnStatus || "").trim().toLowerCase();
  if (normalizedTurnStatus && TURN_STATUS_KEYS[normalizedTurnStatus]) {
    return copy.t(TURN_STATUS_KEYS[normalizedTurnStatus]);
  }
  if (turnStatus) return String(turnStatus);
  const normalizedStatus = String(status || "").trim().toLowerCase();
  return copy.t(TURN_STATUS_KEYS[normalizedStatus] || "call.active");
}
