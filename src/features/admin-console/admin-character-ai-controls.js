import { generateCharacterAvatar, polishCharacterBackstory } from "../../services/character-service.js";
import { deleteTemporaryAvatar, uploadAvatar } from "../../services/upload-service.js";
import { openAvatarGenerationModal } from "../create-character/create-avatar-generation-modal.js";
import { characterAvatarHtml } from "../shared-ui/character-avatar.js";
import { showToast } from "../shared-ui/toast.js";
import { markAdminCharacterAvatarTouched } from "./admin-character-avatar-controls.js";
import { labelForCategory } from "./admin-character-mapper.js";

const ADMIN_AI_ERROR_MESSAGE = "目前功能失效，请稍后重试";
const ADMIN_AVATAR_COPY = Object.freeze({
  title: "AI 生成头像",
  scanning: "正在检查背景故事...",
  detected: "已检测到背景故事，将根据它生成头像。",
  missing: "未检测到背景故事。",
  promptLabel: "描述想要生成的头像",
  promptPlaceholder: "例如：一位自然真实的足球聊天伙伴头像，清晰五官，手机摄影质感...",
  manualPrompt: "手动输入提示词",
  useBackstory: "根据背景故事生成",
  usePrompt: "使用提示词生成",
  generate: "开始生成",
  loading: "正在生成头像...",
  estimate: "预计约 2 分钟",
  ready: "头像已生成，请裁剪后继续。",
  retryGenerated: "重新生成",
  close: "关闭",
  error: ADMIN_AI_ERROR_MESSAGE,
});

export function bindAdminCharacterAiControls(host) {
  const form = host.querySelector("[data-character-editor-form]");
  if (!form) return;

  host.querySelector("[data-character-ai-polish]")?.addEventListener("click", () => polishBackstory(host, form));
  host.querySelector("[data-character-avatar-generate]")?.addEventListener("click", () => openAdminAvatarGenerator(host, form));
}

async function polishBackstory(host, form) {
  const button = host.querySelector("[data-character-ai-polish]");
  const textarea = form.querySelector('textarea[name="backstory"]');
  if (!textarea || button?.disabled) return;

  setButtonBusy(button, true, "润色中...");
  showEditorError(host, "");

  try {
    const result = await polishCharacterBackstory(readCharacterPayload(form));
    const text = String(result.text || "").trim();
    if (!text) throw new Error("AI polish returned empty text.");
    textarea.value = text;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    showToast("背景故事已润色");
  } catch (error) {
    showEditorError(host, resolveAiErrorMessage(error));
    console.warn("admin character AI polish failed", error);
  } finally {
    setButtonBusy(button, false, "AI 润色");
  }
}

function openAdminAvatarGenerator(host, form) {
  openAvatarGenerationModal({
    page: host,
    createState: readCreateState(form),
    categoryLabel: labelForCategory(readFormValue(form, "category")),
    onGenerate: (payload) => generateCharacterAvatar(payload),
    onAvatarSelected: (avatarFile) => uploadCroppedAvatar(host, form, avatarFile),
    onAvatarRemove: (avatarUrl) => deleteTemporaryAvatar(avatarUrl),
    copy: ADMIN_AVATAR_COPY,
    hostClassName: "admin-aigen-host",
  });
}

async function uploadCroppedAvatar(host, form, avatarFile) {
  if (!avatarFile?.blob) return;
  showEditorError(host, "");

  try {
    const result = await uploadAvatar({
      blob: avatarFile.blob,
      filename: avatarFile.fileName || "admin-ai-avatar.webp",
    });
    if (!result.avatarUrl) throw new Error("Avatar upload returned empty url.");
    setAvatarValue(host, form, result.avatarUrl);
    showToast("头像已生成，保存后生效");
  } catch (error) {
    showEditorError(host, ADMIN_AI_ERROR_MESSAGE);
    console.warn("admin character AI avatar upload failed", error);
  }
}

function setAvatarValue(host, form, avatarUrl) {
  const normalizedUrl = String(avatarUrl || "").trim();
  const valueInput = form.querySelector("[data-character-avatar-value]");
  const preview = host.querySelector("[data-character-avatar-preview]");
  if (valueInput) valueInput.value = normalizedUrl;
  markAdminCharacterAvatarTouched(host);
  if (preview) {
    preview.innerHTML = characterAvatarHtml({
      name: readFormValue(form, "name") || "AIOVE",
      imageUrl: normalizedUrl,
      placeholder: preview.dataset.characterAvatarPlaceholder || "",
    });
  }
}

function readCreateState(form) {
  const payload = readCharacterPayload(form);
  return {
    name: payload.name,
    cat: payload.categoryId,
    vibe: payload.personality,
    voice: payload.voice,
    language: payload.language,
    openingLine: payload.openingLine,
    backstory: payload.backstory,
  };
}

function readCharacterPayload(form) {
  const categoryId = readFormValue(form, "category") || "companion";
  return {
    name: readFormValue(form, "name"),
    categoryId,
    category: labelForCategory(categoryId),
    personality: readFormValue(form, "personality"),
    voice: readFormValue(form, "voice"),
    language: readFormValue(form, "language"),
    openingLine: readFormValue(form, "openingLine"),
    backstory: readFormValue(form, "backstory"),
  };
}

function readFormValue(form, name) {
  return String(form.querySelector(`[name="${name}"]`)?.value || "").trim();
}

function setButtonBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = label;
}

function resolveAiErrorMessage(error) {
  const message = String(error?.message || "").trim();
  if (error?.status === 400 && message) return message;
  return ADMIN_AI_ERROR_MESSAGE;
}

function showEditorError(host, message) {
  const errorBox = host.querySelector("[data-character-editor-error]");
  if (!errorBox) return;
  errorBox.hidden = !message;
  errorBox.textContent = message || "";
}
