import { generateCharacterAvatar } from "../../services/character-service.js";
import { deleteTemporaryAvatar, uploadAvatar } from "../../services/upload-service.js";
import { openAvatarGenerationModal } from "../create-character/create-avatar-generation-modal.js";
import { characterAvatarHtml } from "../shared-ui/character-avatar.js";
import { showToast } from "../shared-ui/toast.js";
import { markAdminCharacterAvatarTouched } from "./admin-character-avatar-controls.js";

const MASCOT_AVATAR_ERROR_MESSAGE = "目前功能失效，请稍后重试";
const MASCOT_AVATAR_COPY = Object.freeze({
  title: "AI 生成头像",
  scanning: "正在检查人设...",
  detected: "已检测到人设，将根据它生成头像。",
  missing: "未检测到人设。",
  promptLabel: "描述想要生成的前台头像",
  promptPlaceholder: "例如：一位亲切自然的足球导购前台，清晰五官，真实手机摄影质感...",
  manualPrompt: "手动输入提示词",
  useBackstory: "根据人设生成",
  usePrompt: "使用提示词生成",
  generate: "开始生成",
  loading: "正在生成头像...",
  estimate: "预计约 2 分钟",
  ready: "头像已生成，请裁剪后继续。",
  retryGenerated: "重新生成",
  close: "关闭",
  error: MASCOT_AVATAR_ERROR_MESSAGE,
});

export function bindAdminMascotAvatarAiControls(host) {
  const form = host.querySelector("[data-mascot-form]");
  if (!form) return;
  host.querySelector("[data-mascot-avatar-generate]")?.addEventListener("click", () => openMascotAvatarGenerator(host, form));
}

function openMascotAvatarGenerator(host, form) {
  openAvatarGenerationModal({
    page: host,
    createState: readMascotCreateState(form),
    categoryLabel: "Front desk mascot",
    onGenerate: (payload) => generateCharacterAvatar(payload),
    onAvatarSelected: (avatarFile) => uploadCroppedAvatar(host, form, avatarFile),
    onAvatarRemove: (avatarUrl) => deleteTemporaryAvatar(avatarUrl),
    copy: MASCOT_AVATAR_COPY,
    hostClassName: "admin-aigen-host",
  });
}

async function uploadCroppedAvatar(host, form, avatarFile) {
  if (!avatarFile?.blob) return;
  showEditorError(host, "");

  try {
    const result = await uploadAvatar({
      blob: avatarFile.blob,
      filename: avatarFile.fileName || "admin-mascot-ai-avatar.webp",
    });
    if (!result.avatarUrl) throw new Error("Mascot avatar upload returned empty url.");
    setAvatarValue(host, form, result.avatarUrl);
    showToast("头像已生成，保存后生效");
  } catch (error) {
    showEditorError(host, MASCOT_AVATAR_ERROR_MESSAGE);
    console.warn("admin mascot AI avatar upload failed", error);
  }
}

function readMascotCreateState(form) {
  return {
    name: readFormValue(form, "name"),
    cat: "mascot",
    vibe: "Friendly front desk football guide",
    voice: "Warm & helpful",
    language: "",
    openingLine: readFormValue(form, "greeting"),
    backstory: readFormValue(form, "personaPrompt"),
  };
}

function setAvatarValue(host, form, avatarUrl) {
  const normalizedUrl = String(avatarUrl || "").trim();
  const valueInput = form.querySelector("[data-character-avatar-value]");
  const preview = host.querySelector("[data-character-avatar-preview]");
  if (valueInput) valueInput.value = normalizedUrl;
  markAdminCharacterAvatarTouched(host);
  if (preview) {
    preview.innerHTML = characterAvatarHtml({
      name: readFormValue(form, "name") || "前台",
      imageUrl: normalizedUrl,
      placeholder: preview.dataset.characterAvatarPlaceholder || "",
    });
  }
}

function readFormValue(form, name) {
  return String(form.querySelector(`[name="${name}"]`)?.value || "").trim();
}

function showEditorError(host, message) {
  const errorBox = host.querySelector("[data-character-editor-error]");
  if (!errorBox) return;
  errorBox.hidden = !message;
  errorBox.textContent = message || "";
}
