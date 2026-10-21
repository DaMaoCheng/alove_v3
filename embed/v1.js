(() => {
  "use strict";

  const mountedEmbeds = window.__aioveExternalEmbedMounts || (window.__aioveExternalEmbedMounts = new Set());
  const scripts = Array.from(document.querySelectorAll("script[data-aiove-embed]"));
  scripts.forEach((script) => mountFromScript(script));

  async function mountFromScript(script) {
    const publicId = String(script.dataset.aioveEmbed || "").trim();
    if (!publicId || script.dataset.aioveEmbedMounted === "true") return;
    script.dataset.aioveEmbedMounted = "true";
    const appOrigin = safeScriptOrigin(script.src);
    if (!appOrigin) return;
    const mountKey = `${appOrigin}:${publicId}`;
    if (mountedEmbeds.has(mountKey)) return;
    mountedEmbeds.add(mountKey);

    try {
      const response = await fetch(`${appOrigin}/api/embed/config?embed=${encodeURIComponent(publicId)}`, {
        credentials: "omit",
        mode: "cors",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok || !payload.widget) {
        mountedEmbeds.delete(mountKey);
        return;
      }
      renderWidget(payload.widget, mountKey, { appOrigin, publicId });
    } catch {
      mountedEmbeds.delete(mountKey);
      // The host page should remain fully usable when the optional widget cannot load.
    }
  }

  function renderWidget(config, mountKey, { appOrigin, publicId } = {}) {
    const mount = document.createElement("div");
    mount.setAttribute("data-aiove-external-widget", "");
    mount.dataset.aioveEmbedKey = mountKey;
    const root = mount.attachShadow({ mode: "open" });
    const state = { open: false };
    const theme = config.theme || {};
    const content = config.content || {};
    const desktop = config.desktop || {};
    const mobile = config.mobile || {};
    const host = document.createElement("div");
    host.className = "aiove-widget";
    host.style.setProperty("--aiove-right", `${boundedNumber(desktop.rightPx, 24, 0, 160)}px`);
    host.style.setProperty("--aiove-bottom", `${boundedNumber(desktop.bottomPx, 84, 0, 240)}px`);
    host.style.setProperty("--aiove-mobile-right", `${boundedNumber(mobile.rightPx, 16, 0, 120)}px`);
    host.style.setProperty("--aiove-mobile-bottom", `${boundedNumber(mobile.bottomPx, 84, 0, 240)}px`);
    host.style.setProperty("--aiove-accent", safeColor(theme.accentColor, "#00E95C"));
    host.style.setProperty("--aiove-surface", safeColor(theme.surfaceColor, "#101312"));
    host.style.setProperty("--aiove-text", safeColor(theme.textColor, "#FFFFFF"));
    host.style.setProperty("--aiove-radius", `${boundedNumber(theme.cornerRadiusPx, 22, 0, 32)}px`);

    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "launcher";
    launcher.setAttribute("aria-label", textOrFallback(content.title, "Chat with AIOVE"));
    launcher.setAttribute("aria-expanded", "false");

    const image = document.createElement("img");
    image.alt = "";
    image.src = String(config.launcherImageUrl || "");
    image.addEventListener("error", () => {
      image.hidden = true;
      launcher.classList.add("is-fallback");
    });
    launcher.append(image);
    if (config.showBadge) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "1";
      launcher.append(badge);
    }

    const card = document.createElement("section");
    card.className = "card";
    card.hidden = true;
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", textOrFallback(content.title, "Chat with AIOVE"));

    const close = document.createElement("button");
    close.type = "button";
    close.className = "close";
    close.setAttribute("aria-label", "Close chat introduction");
    close.textContent = "×";
    const cardImage = image.cloneNode();
    cardImage.className = "card-avatar";
    cardImage.alt = "";
    cardImage.addEventListener("error", () => { cardImage.hidden = true; });
    const heading = document.createElement("h2");
    appendRichText(heading, content.title, content.titleRichText, "Chat with AIOVE");
    const beta = document.createElement("span");
    beta.className = "beta";
    beta.textContent = textOrFallback(content.betaText, "BETA");
    beta.hidden = !content.showBeta;
    const description = document.createElement("p");
    appendRichText(description, content.description, content.descriptionRichText, "Talk football. Share life. Anytime, anywhere—with your ALOVE companion.");
    const cta = document.createElement("a");
    cta.className = "cta";
    const baseCtaUrl = safeCtaUrl(config.ctaUrl);
    const sourceContextEnabled = config.sourceContextEnabled === true;
    cta.href = baseCtaUrl;
    cta.target = "_blank";
    cta.rel = "noopener noreferrer";
    cta.textContent = textOrFallback(content.ctaText, "Start chat");

    const headingRow = document.createElement("div");
    headingRow.className = "heading-row";
    headingRow.append(heading, beta);
    card.append(close, cardImage, headingRow, description, cta);
    host.append(card, launcher);
    root.append(styleElement(), host);
    document.body.append(mount);

    let sourceHandoffRequestId = 0;
    const refreshSourceHandoff = () => {
      const requestId = ++sourceHandoffRequestId;
      const request = requestSourceHandoff(appOrigin, publicId).then((token) => {
        if (requestId === sourceHandoffRequestId) {
          cta.href = token ? addHandoffToCtaUrl(baseCtaUrl, token) : baseCtaUrl;
        }
        return token;
      });
      return request;
    };
    if (sourceContextEnabled) void refreshSourceHandoff();

    launcher.addEventListener("click", () => state.open ? closeCard() : openCard());
    close.addEventListener("click", closeCard);
    cta.addEventListener("click", sourceContextEnabled ? handleCtaClick : closeCard);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.open) closeCard();
    });

    function openCard() {
      if (sourceContextEnabled) void refreshSourceHandoff();
      state.open = true;
      card.hidden = false;
      launcher.setAttribute("aria-expanded", "true");
      window.requestAnimationFrame(() => close.focus());
    }

    function closeCard() {
      if (!state.open) return;
      state.open = false;
      card.hidden = true;
      launcher.setAttribute("aria-expanded", "false");
      launcher.focus();
    }

    function handleCtaClick(event) {
      const pendingWindow = window.open("about:blank", "_blank");
      if (!pendingWindow) {
        closeCard();
        return;
      }
      event.preventDefault();
      pendingWindow.opener = null;
      closeCard();
      const freshRequest = refreshSourceHandoff();
      const timeout = new Promise((resolve) => window.setTimeout(() => resolve(""), 1500));
      void Promise.race([freshRequest, timeout]).then((token) => {
        pendingWindow.location.replace(token ? addHandoffToCtaUrl(baseCtaUrl, token) : baseCtaUrl);
      });
    }
  }

  async function requestSourceHandoff(appOrigin, publicId) {
    if (!appOrigin || !publicId || !window.location?.href) return "";
    try {
      const response = await fetch(`${appOrigin}/api/embed/handoff`, {
        method: "POST",
        credentials: "omit",
        mode: "cors",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          embed: String(publicId).slice(0, 128),
          sourceUrl: sourcePageUrl(window.location.href),
          sourceTitle: String(document.title || "").slice(0, 240),
        }),
      });
      const payload = await response.json();
      return response.ok && payload?.ok && typeof payload.handoff === "string" ? payload.handoff.slice(0, 4096) : "";
    } catch {
      // Source context is an optional enhancement; the normal CTA remains usable.
      return "";
    }
  }

  function addHandoffToCtaUrl(baseUrl, token) {
    try {
      const url = new URL(baseUrl);
      if (token) url.searchParams.set("handoff", token);
      return url.toString();
    } catch {
      return baseUrl;
    }
  }

  function sourcePageUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return `${url.origin}${url.pathname}`.slice(0, 4096);
    } catch {
      return "";
    }
  }

  function styleElement() {
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .aiove-widget { position: fixed; z-index: 2147483000; right: calc(var(--aiove-right) + env(safe-area-inset-right)); bottom: calc(var(--aiove-bottom) + env(safe-area-inset-bottom)); width: 56px; font-family: Arial, Helvetica, sans-serif; color: var(--aiove-text); }
      .launcher { position: relative; display: grid; place-items: center; width: 56px; height: 56px; margin: 0; padding: 0; overflow: visible; cursor: pointer; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
      .launcher:focus-visible, .close:focus-visible, .cta:focus-visible { outline: 3px solid var(--aiove-accent); outline-offset: 3px; }
      .launcher img { display: block; width: 56px; height: 56px; border: 0; border-radius: 0; object-fit: contain; background: transparent; }
      .launcher.is-fallback::before { content: "A"; display: grid; place-items: center; width: 56px; height: 56px; border: 2px solid rgba(255,255,255,.94); border-radius: 50%; background: var(--aiove-accent); color: #07140d; font-size: 24px; font-weight: 800; }
      .badge { position: absolute; top: -5px; left: -7px; display: grid; place-items: center; min-width: 24px; height: 24px; padding: 0 6px; border: 2px solid #fff; border-radius: 999px; background: #e11d2e; color: #fff; font-size: 14px; font-weight: 800; line-height: 1; box-shadow: 0 2px 7px rgba(0,0,0,.23); }
      .card { position: absolute; right: 0; bottom: 70px; width: min(340px, calc(100vw - 24px)); max-height: min(560px, calc(100vh - 100px)); overflow-y: auto; overscroll-behavior: contain; padding: 22px; border: 1px solid rgba(255,255,255,.12); border-radius: var(--aiove-radius); background: var(--aiove-surface); color: var(--aiove-text); box-shadow: 0 16px 48px rgba(0,0,0,.34); }
      .card[hidden] { display: none; }
      .close { position: absolute; top: 10px; right: 12px; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 50%; cursor: pointer; background: transparent; color: var(--aiove-text); font-size: 26px; line-height: 1; }
      .card-avatar { display: block; width: 56px; height: 56px; margin: 0 0 14px; border: 0; border-radius: 0; object-fit: contain; background: transparent; }
      .heading-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-right: 30px; }
      h2 { margin: 0; color: var(--aiove-text); font-size: 22px; font-weight: 700; line-height: 1.18; letter-spacing: 0; }
      .beta { display: inline-flex; align-items: center; justify-content: center; min-height: 22px; padding: 0 7px; border-radius: 4px; background: var(--aiove-accent); color: #07140d; font-size: 11px; font-weight: 800; line-height: 1; letter-spacing: 0; white-space: nowrap; }
      p { margin: 14px 0 18px; color: color-mix(in srgb, var(--aiove-text) 72%, transparent); font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
      .cta { display: grid; min-height: 48px; place-items: center; width: 100%; padding: 12px 18px; border-radius: 999px; background: var(--aiove-accent); color: #07140d; font-size: 15px; font-weight: 700; line-height: 1.2; text-align: center; text-decoration: none; overflow-wrap: anywhere; }
      @media (max-width: 640px) { .aiove-widget { right: calc(var(--aiove-mobile-right) + env(safe-area-inset-right)); bottom: calc(var(--aiove-mobile-bottom) + env(safe-area-inset-bottom)); } .card { right: 0; bottom: 70px; width: min(340px, calc(100vw - 24px)); padding: 20px; } h2 { font-size: 22px; } }
    `;
    return style;
  }

  function safeScriptOrigin(value) {
    try {
      return new URL(String(value || "")).origin;
    } catch {
      return "";
    }
  }

  function safeCtaUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "#";
    } catch {
      return "#";
    }
  }

  function safeColor(value, fallback) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
  }

  function boundedNumber(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
  }

  function textOrFallback(value, fallback) {
    return String(value || "").trim() || fallback;
  }

  function appendRichText(node, value, marks, fallback) {
    const text = textOrFallback(value, fallback);
    let cursor = 0;
    normalizeRichText(marks, text).forEach((mark) => {
      node.append(document.createTextNode(text.slice(cursor, mark.start)));
      const segment = document.createElement("span");
      segment.style.color = mark.color;
      segment.textContent = text.slice(mark.start, mark.end);
      node.append(segment);
      cursor = mark.end;
    });
    node.append(document.createTextNode(text.slice(cursor)));
  }

  function normalizeRichText(value, text) {
    const length = text.length;
    const marks = Array.isArray(value) ? value : [];
    const normalized = [];
    marks
      .map((mark) => ({ start: Number(mark?.start), end: Number(mark?.end), color: String(mark?.color || "").toUpperCase() }))
      .filter((mark) => Number.isInteger(mark.start) && Number.isInteger(mark.end)
        && mark.start >= 0 && mark.end > mark.start && mark.end <= length && /^#[0-9a-f]{6}$/i.test(mark.color))
      .sort((left, right) => left.start - right.start || left.end - right.end)
      .forEach((mark) => {
        const previous = normalized[normalized.length - 1];
        if (previous && mark.start < previous.end) return;
        if (previous && previous.end === mark.start && previous.color === mark.color) previous.end = mark.end;
        else normalized.push(mark);
      });
    return normalized;
  }
})();
