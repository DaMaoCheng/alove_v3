export function chatImageQuotaHtml({ quota = null, copy, escapeAttribute: escapeAttributeFn = escapeHtml } = {}) {
  const normalized = normalizeQuota(quota);
  if (!normalized) return "";
  const label = copy.t("chat.imageQuota", { remaining: normalized.remaining, limit: normalized.limit });
  const hintKey = normalized.mode === "guest" ? "chat.guestImageQuotaHint" : "chat.imageQuotaHint";
  const hint = copy.t(hintKey, {
    remaining: normalized.mode === "guest" ? normalized.networkQuotaRemaining : normalized.remaining,
    limit: normalized.mode === "guest" ? normalized.networkLimit : normalized.limit,
  });
  const reset = normalized.windowExpiresAt
    ? copy.t("chat.imageQuotaReset", { time: formatQuotaReset(normalized.windowExpiresAt, copy) })
    : "";
  return `<span class="ch-image-quota-wrap" data-chat-image-quota-wrap>
    <button class="ch-image-quota" type="button" data-chat-image-quota aria-expanded="false" aria-label="${escapeAttributeFn(label)}">${escapeHtml(label)}</button>
    <span class="ch-image-quota-popover" data-chat-image-quota-popover role="status" hidden>${escapeHtml(hint)}${reset ? `<br /><span>${escapeHtml(reset)}</span>` : ""}</span>
  </span>`;
}

export function bindChatImageQuota(root) {
  const line = root?.querySelector("[data-chat-status-line]");
  const status = line?.closest(".ch-status");
  const quotaButton = root?.querySelector("[data-chat-image-quota]");
  const popover = root?.querySelector("[data-chat-image-quota-popover]");
  if (!line || !quotaButton) return;

  const setMode = () => {
    const primary = line.querySelector("[data-chat-status-primary]");
    const quota = line.querySelector("[data-chat-status-quota]");
    if (!primary || !quota) return;
    line.dataset.carousel = primary.scrollWidth + quota.scrollWidth + 12 > line.clientWidth ? "true" : "false";
  };
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(setMode) : null;
  observer?.observe(line);
  setMode();

  let timer = null;
  const closePopover = () => {
    if (!popover) return;
    popover.hidden = true;
    quotaButton.setAttribute("aria-expanded", "false");
    quotaButton.dataset.pinned = "false";
    quotaButton.dataset.hoverOpened = "false";
    delete line.dataset.popoverOpen;
    if (status) delete status.dataset.chatQuotaOpen;
    delete popover.dataset.mobileFixed;
    popover.style.removeProperty("top");
    popover.style.removeProperty("left");
    popover.style.removeProperty("right");
    popover.style.removeProperty("transform");
  };
  const openPopover = () => {
    if (!popover) return;
    popover.hidden = false;
    quotaButton.setAttribute("aria-expanded", "true");
    line.dataset.popoverOpen = "true";
    if (status) status.dataset.chatQuotaOpen = "true";
    positionMobilePopover();
    window.clearTimeout(timer);
    if (quotaButton.dataset.pinned !== "true") timer = window.setTimeout(closePopover, 5200);
  };
  quotaButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (popover?.hidden) {
      quotaButton.dataset.pinned = "true";
      openPopover();
    } else if (quotaButton.dataset.pinned === "true") {
      closePopover();
    } else {
      quotaButton.dataset.pinned = "true";
    }
  });
  quotaButton.addEventListener("mouseenter", () => {
    if (quotaButton.dataset.pinned !== "true") {
      quotaButton.dataset.hoverOpened = "true";
      openPopover();
    }
  });
  quotaButton.addEventListener("mouseleave", () => {
    if (quotaButton.dataset.pinned === "true") return;
    window.clearTimeout(timer);
    timer = window.setTimeout(closePopover, 180);
  });
  popover?.addEventListener("mouseenter", () => {
    if (quotaButton.dataset.pinned !== "true") window.clearTimeout(timer);
  });
  popover?.addEventListener("mouseleave", () => {
    if (quotaButton.dataset.pinned === "true") return;
    window.clearTimeout(timer);
    timer = window.setTimeout(closePopover, 180);
  });

  quotaButton.addEventListener("focus", () => { line.dataset.paused = "true"; });
  quotaButton.addEventListener("blur", () => { line.dataset.paused = "false"; });

  function positionMobilePopover() {
    if (!popover || !window.matchMedia?.("(max-width: 900px)").matches) return;
    const buttonRect = quotaButton.getBoundingClientRect();
    popover.dataset.mobileFixed = "true";
    popover.style.top = `${Math.max(8, buttonRect.bottom - 32)}px`;
    popover.style.left = "50%";
    popover.style.right = "auto";
    popover.style.transform = "translateX(-50%)";
  }
}

function normalizeQuota(quota) {
  if (!quota || !Number.isFinite(Number(quota.limit))) return null;
  const limit = Math.max(0, Number(quota.limit));
  const remaining = Math.min(limit, Math.max(0, Number(quota.remaining ?? limit - Number(quota.used || 0))));
  return {
    mode: String(quota.mode || "account").trim().toLowerCase(),
    limit,
    remaining,
    networkLimit: Math.max(0, Number(quota.networkLimit || 3)),
    networkQuotaRemaining: Number.isFinite(Number(quota.networkQuotaRemaining))
      ? Math.max(0, Number(quota.networkQuotaRemaining))
      : remaining,
    windowExpiresAt: quota.windowExpiresAt || null,
  };
}

function formatQuotaReset(value, copy) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(copy.locale || undefined, { dateStyle: "short", timeStyle: "short" }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
