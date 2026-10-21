import { uploadAvatar } from "../../services/upload-service.js";
import { handleAvatarFile, openAvatarFilePicker } from "../avatar-cropper/avatar-cropper.js";
import { characterAvatarHtml } from "../shared-ui/character-avatar.js";
import { showToast } from "../shared-ui/toast.js";

export function bindAdminCharacterAvatarControls(host) {
  const fileInput = host.querySelector("[data-character-avatar-file]");
  const valueInput = host.querySelector("[data-character-avatar-value]");
  const preview = host.querySelector("[data-character-avatar-preview]");
  const uploadButton = host.querySelector("[data-character-avatar-upload]");
  const removeButton = host.querySelector("[data-character-avatar-remove]");
  const errorBox = host.querySelector("[data-character-editor-error]");

  uploadButton?.addEventListener("click", () => openAvatarFilePicker(fileInput));
  removeButton?.addEventListener("click", () => {
    if (valueInput) valueInput.value = "";
    markAdminCharacterAvatarTouched(host);
    renderPreview(preview, { name: readCharacterName(host), imageUrl: "" });
    showAvatarError(errorBox, "");
  });

  fileInput?.addEventListener("change", (event) => {
    handleAvatarFile(event, {
      retryLabel: "重新上传",
      onCropped: (avatarFile) => uploadCroppedAvatar({
        avatarFile,
        uploadButton,
        removeButton,
        valueInput,
        preview,
        errorBox,
        host,
      }),
    });
  });
}

function setAvatarBusy(uploadButton, removeButton, busy) {
  if (uploadButton) {
    uploadButton.disabled = busy;
    uploadButton.textContent = busy ? "上传中..." : "上传头像";
  }
  if (removeButton) removeButton.disabled = busy;
}

async function uploadCroppedAvatar({ avatarFile, uploadButton, removeButton, valueInput, preview, errorBox, host }) {
  if (!avatarFile?.blob) return;
  try {
    setAvatarBusy(uploadButton, removeButton, true);
    showAvatarError(errorBox, "");
    const result = await uploadAvatar({
      blob: avatarFile.blob,
      filename: avatarFile.fileName || `admin-avatar-${Date.now()}.webp`,
    });
    if (!result.avatarUrl) throw new Error("Avatar upload failed. Please try again.");
    if (valueInput) valueInput.value = result.avatarUrl;
    markAdminCharacterAvatarTouched(host);
    renderPreview(preview, { name: readCharacterName(host), imageUrl: result.avatarUrl });
    showToast("头像已裁剪并上传，保存后生效");
  } catch (error) {
    showAvatarError(errorBox, error.message || "头像上传失败，请稍后再试");
  } finally {
    setAvatarBusy(uploadButton, removeButton, false);
  }
}

export function markAdminCharacterAvatarTouched(host) {
  if (!host) return;
  let touchedInput = host.querySelector("[data-character-avatar-touched]");
  if (!touchedInput) {
    const form = host.querySelector("form");
    if (!form) return;
    touchedInput = document.createElement("input");
    touchedInput.type = "hidden";
    touchedInput.name = "avatarTouched";
    touchedInput.dataset.characterAvatarTouched = "";
    form.append(touchedInput);
  }
  touchedInput.value = "1";
}

function renderPreview(preview, { name, imageUrl }) {
  if (!preview) return;
  preview.innerHTML = characterAvatarHtml({ name, imageUrl, placeholder: preview.dataset.characterAvatarPlaceholder || "" });
}

function readCharacterName(host) {
  return host.querySelector('input[name="name"]')?.value || "";
}

function showAvatarError(errorBox, message) {
  if (!errorBox) return;
  errorBox.hidden = !message;
  errorBox.textContent = message || "";
}
