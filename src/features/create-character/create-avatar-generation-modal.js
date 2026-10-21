import { ICONS } from "../../icons/icons.js";
import { openAvatarUrlCropper } from "../avatar-cropper/avatar-cropper.js";
import { escapeAttr, escapeHtml } from "./create-character-html.js";

const AIGEN_PROMPT_PLACEHOLDER = "A warm football companion portrait, expressive eyes, matchday energy, premium app avatar style...";
const AVATAR_GENERATION_GENERIC_ERROR_MESSAGE = "This feature is currently unavailable. Please try again later.";

const DEFAULT_AVATAR_GENERATION_COPY = Object.freeze({
  title: "AI avatar",
  scanning: "Scanning the page for a background setup...",
  detected: "Background found. We can use it.",
  missing: "No background found.",
  promptLabel: "Describe the avatar to generate",
  promptPlaceholder: AIGEN_PROMPT_PLACEHOLDER,
  manualPrompt: "Custom prompt",
  useBackstory: "Use story",
  usePrompt: "Generate",
  generate: "Generate",
  loading: "Generating your avatar...",
  estimate: "Estimated time: about 2 minutes",
  ready: "Avatar ready. Crop it to continue.",
  retryGenerated: "Regenerate",
  close: "Close",
  error: AVATAR_GENERATION_GENERIC_ERROR_MESSAGE,
});

export function openAvatarGenerationModal({
  page,
  createState,
  categoryLabel,
  onGenerate,
  onAvatarSelected,
  onAvatarRemove,
  copy = {},
  hostClassName = "",
  initialManualPrompt = "",
  forceManualInitial = false,
  initialMode = "",
}) {
  const labels = { ...DEFAULT_AVATAR_GENERATION_COPY, ...copy };
  const backstory = String(page.querySelector('textarea[name="backstory"]')?.value || createState.backstory || "").trim();
  let currentManualPrompt = String(initialManualPrompt || "");
  const preferredInitialMode = normalizeAvatarGenerationMode(initialMode) || (forceManualInitial ? "manual" : "");
  closeAvatarGenerationModal();
  const host = document.createElement("div");
  host.className = ["aigen-host", hostClassName].filter(Boolean).join(" ");
  host.innerHTML = `
    <div class="dialog-scrim" data-aigen-close></div>
    <div class="aigen-modal" role="dialog" aria-modal="true">
      <button class="dlg-x" type="button" aria-label="${escapeAttr(labels.close)}" data-aigen-close>${ICONS.close}</button>
      <h3 class="aigen-title">${ICONS.spark} ${escapeHtml(labels.title)}</h3>
      <div class="aigen-body"><div class="aigen-scan"><span class="cf-spin"></span><span>${escapeHtml(labels.scanning)}</span></div></div>
    </div>`;
  document.body.append(host);
  document.body.classList.add("aigen-open");
  const close = () => {
    closeAvatarGenerationModal(host);
  };
  host.querySelectorAll("[data-aigen-close]").forEach((item) => item.addEventListener("click", close));
  window.setTimeout(() => {
    renderAvatarGenerationScanResult(host, {
      page,
      backstory,
      createState,
      categoryLabel,
      close,
      onGenerate,
      onAvatarSelected,
      onAvatarRemove,
      labels,
      getManualPrompt: () => currentManualPrompt,
      setManualPrompt: (value) => {
        currentManualPrompt = String(value || "");
      },
      initialMode: preferredInitialMode,
      hostClassName,
    });
  }, 650);
}

function renderAvatarGenerationScanResult(host, {
  page,
  backstory,
  createState,
  categoryLabel,
  close,
  onGenerate,
  onAvatarSelected,
  onAvatarRemove,
  labels,
  getManualPrompt,
  setManualPrompt,
  initialMode = "",
  hostClassName = "",
}) {
  const body = host.querySelector(".aigen-body");
  if (!body) return;
  const initialPrompt = getManualPrompt?.() || "";
  const startsManual = normalizeAvatarGenerationMode(initialMode) === "manual";
  if (backstory && !startsManual) {
    body.dataset.aigenMode = "backstory";
    const preview = backstory.length > 90 ? `${backstory.slice(0, 90)}...` : backstory;
    body.innerHTML = `
      <div class="aigen-row is-ok"><span class="aigen-row-ic">${ICONS.check}</span><span>${escapeHtml(labels.detected)}</span></div>
      <div class="aigen-readout">"${escapeHtml(preview)}"</div>
      ${renderManualPromptField(labels, true, initialPrompt)}
      <div class="aigen-actions" data-aigen-actions>
        <button class="btn btn-ghost aigen-manual" type="button" data-aigen-manual>${escapeHtml(labels.manualPrompt)}</button>
        <button class="btn btn-primary aigen-go" type="button" data-aigen-generate>${ICONS.spark} ${escapeHtml(labels.useBackstory)}</button>
      </div>`;
  } else {
    body.dataset.aigenMode = "manual";
    const promptStatusClass = backstory ? "is-ok" : "is-warn";
    const promptStatusIcon = backstory ? ICONS.check : ICONS.warn;
    body.innerHTML = `
      <div class="aigen-row ${promptStatusClass}"><span class="aigen-row-ic">${promptStatusIcon}</span><span>${escapeHtml(backstory ? labels.detected : labels.missing)}</span></div>
      ${renderManualPromptField(labels, false, initialPrompt)}
      <div class="aigen-actions is-single" data-aigen-actions>
        <button class="btn btn-primary aigen-go" type="button" data-aigen-generate>${ICONS.spark} ${escapeHtml(labels.usePrompt || labels.generate)}</button>
      </div>`;
  }

  body.querySelector(".aigen-prompt")?.addEventListener("input", (event) => {
    setManualPrompt?.(event.target.value || "");
    if (String(event.target.value || "").trim()) {
      event.target.classList.remove("is-empty-error");
    }
  });

  body.querySelector("[data-aigen-manual]")?.addEventListener("click", () => {
    setAvatarGenerationMode(body, "manual", labels);
  });

  body.querySelector("[data-aigen-generate]")?.addEventListener("click", async () => {
    const mode = body.dataset.aigenMode || (backstory ? "backstory" : "manual");
    const promptInput = body.querySelector(".aigen-prompt");
    const manualPrompt = String(promptInput?.value || "").trim();
    const latestPrompt = String(promptInput?.value || getManualPrompt?.() || "").trim();
    if (mode === "manual" && !manualPrompt) {
      flashAvatarPromptInput(promptInput);
      return;
    }
    const sourceBackstory = mode === "manual" ? manualPrompt : backstory;
    if (!sourceBackstory) {
      flashAvatarPromptInput(promptInput);
      return;
    }
    await runAvatarGeneration(host, {
      close,
      onGenerate,
      onAvatarSelected,
      onAvatarRemove,
      labels,
      retryPrompt: latestPrompt,
      retryMode: mode,
      onRetryPrompt: (preservedPrompt = "", preservedMode = "manual") => openAvatarGenerationModal({
        page,
        createState,
        categoryLabel,
        onGenerate,
        onAvatarSelected,
        onAvatarRemove,
        copy: labels,
        hostClassName,
        initialManualPrompt: preservedPrompt,
        initialMode: preservedMode,
      }),
      payload: {
        name: createState.name,
        categoryId: createState.cat,
        category: categoryLabel,
        personality: createState.vibe,
        voice: createState.voice,
        language: createState.language,
        openingLine: createState.openingLine,
        backstory: sourceBackstory,
      },
    });
  });
}

function normalizeAvatarGenerationMode(value) {
  return value === "manual" || value === "backstory" ? value : "";
}

function renderManualPromptField(labels, hidden, value = "") {
  return `
    <div class="aigen-prompt-wrap" data-aigen-prompt-wrap${hidden ? " hidden" : ""}>
      <label class="aigen-label">${escapeHtml(labels.promptLabel)}</label>
      <textarea class="aigen-prompt" rows="4" placeholder="${escapeAttr(labels.promptPlaceholder)}">${escapeHtml(value)}</textarea>
    </div>`;
}

function setAvatarGenerationMode(body, mode, labels) {
  body.dataset.aigenMode = mode;
  const promptWrap = body.querySelector("[data-aigen-prompt-wrap]");
  const promptInput = body.querySelector(".aigen-prompt");
  const manualButton = body.querySelector("[data-aigen-manual]");
  const actions = body.querySelector("[data-aigen-actions]");
  const generateButton = body.querySelector("[data-aigen-generate]");
  if (promptWrap) promptWrap.hidden = mode !== "manual";
  if (manualButton) manualButton.hidden = mode === "manual";
  if (actions) actions.classList.toggle("is-single", mode === "manual");
  if (generateButton) {
    const label = mode === "manual" ? labels.usePrompt : labels.useBackstory;
    generateButton.innerHTML = `${ICONS.spark} ${escapeHtml(label || labels.generate)}`;
  }
  if (mode === "manual") promptInput?.focus();
}

function flashAvatarPromptInput(input) {
  if (!input) return;
  input.classList.remove("is-empty-error");
  void input.offsetWidth;
  input.classList.add("is-empty-error");
  input.focus();
}

async function runAvatarGeneration(host, { close, onGenerate, onAvatarSelected, onAvatarRemove, labels, retryPrompt = "", retryMode = "manual", onRetryPrompt, payload }) {
  const body = host.querySelector(".aigen-body");
  if (!body) return;
  body.innerHTML = `
    <div class="aigen-loading"><div class="aigen-orb"><span class="cf-spin aigen-orb-spin"></span></div><div class="aigen-loading-txt">${escapeHtml(labels.loading)}</div><div class="aigen-meta"><span>${escapeHtml(labels.estimate)}</span><span data-aigen-timer>00:00</span></div><div class="aigen-bar"><i></i></div></div>`;
  const timer = startAvatarGenerationTimer(host);

  try {
    const result = await onGenerate?.(payload);
    const avatarUrl = String(result?.avatarUrl || "").trim();
    if (!avatarUrl) throw new Error("Avatar generation failed. Please try again.");
    body.innerHTML = `<div class="aigen-done"><div class="aigen-done-ic">${ICONS.check}</div><div class="aigen-done-txt">${escapeHtml(labels.ready)}</div></div>`;
    window.setTimeout(() => {
      close();
      let consumed = false;
      openAvatarUrlCropper(avatarUrl, {
        pageLanguage: labels.pageLanguage || "English",
        retryLabel: labels.retryGenerated || "Regenerate",
        onRetry: () => {
          consumed = true;
          onAvatarRemove?.(avatarUrl);
          onRetryPrompt?.(retryPrompt, retryMode);
        },
        onCropped: (avatarFile) => {
          consumed = true;
          onAvatarSelected?.(avatarFile);
          onAvatarRemove?.(avatarUrl);
        },
        onCancel: () => {
          if (!consumed) onAvatarRemove?.(avatarUrl);
        },
      });
    }, 450);
  } catch {
    body.innerHTML = `
      <div class="aigen-row is-warn"><span class="aigen-row-ic">${ICONS.warn}</span><span>${escapeHtml(labels.error)}</span></div>
      <div class="aigen-actions has-retry">
        <button class="btn btn-primary aigen-go" type="button" data-aigen-close>${escapeHtml(labels.close)}</button>
        <button class="btn btn-ghost aigen-retry" type="button" data-aigen-retry aria-label="${escapeAttr(labels.retryGenerated || "Retry")}" title="${escapeAttr(labels.retryGenerated || "Retry")}">${ICONS.refresh}</button>
      </div>`;
    body.querySelector("[data-aigen-close]")?.addEventListener("click", close);
    body.querySelector("[data-aigen-retry]")?.addEventListener("click", () => onRetryPrompt?.(retryPrompt, retryMode));
  } finally {
    timer.stop();
  }
}

export function closeAvatarGenerationModal(targetHost = null) {
  const hosts = targetHost ? [targetHost] : Array.from(document.querySelectorAll(".aigen-host"));
  hosts.forEach((host) => host.remove());
  if (!document.querySelector(".aigen-host")) {
    document.body.classList.remove("aigen-open");
  }
}

function startAvatarGenerationTimer(host) {
  const timerElement = host.querySelector("[data-aigen-timer]");
  const startedAt = Date.now();
  const render = () => {
    if (!timerElement) return;
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    timerElement.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };
  render();
  const interval = window.setInterval(render, 1000);
  return { stop: () => window.clearInterval(interval) };
}
