import { ICONS } from "../../icons/icons.js";
import { normalizeAssetUrl } from "../shared-ui/character-avatar.js";
import { createSiteCopy } from "../../i18n/site-copy.js";
import { resolveCallStatusCopy } from "./call-status-copy.js";

export function createCallModal({ agent, character, seconds, paused = false, status = "idle", turnStatus = "", liveText = "", liveSpeaker = "", latencyText = "", error = "", hasCallProducts = false, hasHiddenProducts = false, pageLanguage = "English", onStartCall, onClose, onTogglePause, onShopClick }) {
  const copy = createSiteCopy(pageLanguage);
  const currentCharacter = character || {
    id: agent || "character",
    name: "AIOVE Character",
    avatarUrl: "/assets/char_fan.png",
  };
  const avatarUrl = normalizeAssetUrl(currentCharacter.avatarUrl);
  const callStatusText = getCallStatusText({ status, turnStatus, error, copy });
  const modal = document.createElement("div");
  modal.innerHTML = `
    <div class="call-scrim"></div>
    <div class="call-modal" role="dialog">
      <div class="call-stage">
        <div class="call-aura"></div>
        <div class="call-avatar"><img src="${escapeAttr(avatarUrl)}" alt="" /></div>
        <div class="call-name">${escapeHtml(currentCharacter.name)}</div>
        <div class="call-status"><span class="call-dot"></span><span id="callStatusText">${escapeHtml(callStatusText)}</span> · <span id="callTimer">${formatCallTime(seconds)}</span></div>
        <div class="call-live-text" id="callLiveText">${renderLiveText(liveText, liveSpeaker)}</div>
        <div class="call-latency" id="callLatency">${escapeHtml(latencyText || " ")}</div>
        <div class="call-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
      </div>
      <div class="call-controls">
        <button class="cc-btn ${paused ? "off" : "mic-on"}" id="callPause" aria-label="${paused ? copy.t("call.resume") : copy.t("call.mute")}" ${["ended", "error"].includes(status) ? "disabled" : ""}><span class="cc-ic">${paused ? ICONS.micOff : ICONS.mic}</span><span class="cc-lbl">${paused ? copy.t("call.micOff") : copy.t("call.micOn")}</span></button>
        <button class="cc-btn shop ${hasCallProducts ? "has-products" : ""}" id="callShop" aria-label="${copy.t("call.shop")}"><span class="cc-ic">${ICONS.shop}${hasHiddenProducts ? `<span class="call-shop-alert">!</span>` : ""}</span><span class="cc-lbl">${copy.t("call.shop")}</span></button>
        <button class="cc-btn end" aria-label="${copy.t("call.end")}"><span class="cc-ic">${ICONS.phoneOff}</span><span class="cc-lbl">${copy.t("call.end")}</span></button>
      </div>
    </div>
  `;

  modal.querySelector(".call-scrim")?.addEventListener("click", onClose);
  modal.querySelector(".cc-btn.end")?.addEventListener("click", onClose);
  modal.querySelector("#callPause")?.addEventListener("click", onTogglePause);
  modal.querySelector("#callShop")?.addEventListener("click", onShopClick);
  window.requestAnimationFrame(() => onStartCall?.());

  const fragment = document.createDocumentFragment();
  fragment.append(...modal.childNodes);
  return fragment;
}

export function formatCallTime(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}

function getCallStatusText({ status = "", turnStatus = "", error = "", copy } = {}) {
  return resolveCallStatusCopy({ status, turnStatus, error, pageLanguage: copy?.language?.code || "English" });
}

function renderLiveText(text = "", speaker = "") {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) return " ";
  const isUser = speaker === "user";
  const className = isUser ? "user" : "assistant";
  return `<div class="call-live-row ${className}"><span class="call-live-dot"></span><p>${escapeHtml(normalizedText)}</p></div>`;
}
