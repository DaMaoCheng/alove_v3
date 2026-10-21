import { uploadAvatar } from "../../services/upload-service.js";
import { handleAvatarFile, openAvatarFilePicker } from "../avatar-cropper/avatar-cropper.js";
import { showToast } from "../shared-ui/toast.js";

export function bindAdminExternalEmbedAvatarControls(host, { fallbackImageUrl = "", onChanged } = {}) {
  const fileInput = host.querySelector("[data-external-embed-avatar-file]");
  const uploadButton = host.querySelector("[data-external-embed-avatar-upload]");
  const removeButton = host.querySelector("[data-external-embed-avatar-remove]");
  const valueInput = host.querySelector("[data-external-embed-launcher-image]");
  const preview = host.querySelector("[data-external-embed-avatar-preview]");

  uploadButton?.addEventListener("click", () => openAvatarFilePicker(fileInput));
  removeButton?.addEventListener("click", () => {
    if (valueInput) valueInput.value = "";
    renderPreview(preview, fallbackImageUrl);
    onChanged?.();
  });
  fileInput?.addEventListener("change", (event) => {
    handleAvatarFile(event, {
      retryLabel: "重新上传",
      onCropped: async (avatarFile) => {
        if (!avatarFile?.blob) return;
        setBusy(uploadButton, removeButton, true);
        try {
          const result = await uploadAvatar({
            blob: avatarFile.blob,
            filename: avatarFile.fileName || `external-embed-${Date.now()}.webp`,
          });
          if (!result.avatarUrl) throw new Error("图标上传失败，请稍后重试");
          if (valueInput) valueInput.value = result.avatarUrl;
          renderPreview(preview, result.avatarUrl);
          onChanged?.();
          showToast("图标已裁剪并上传，保存后对外生效");
        } catch (error) {
          showToast(error.message || "图标上传失败，请稍后重试");
        } finally {
          setBusy(uploadButton, removeButton, false);
        }
      },
    });
  });
}

function setBusy(uploadButton, removeButton, busy) {
  if (uploadButton) {
    uploadButton.disabled = busy;
    uploadButton.textContent = busy ? "上传中..." : "上传图标";
  }
  if (removeButton) removeButton.disabled = busy;
}

function renderPreview(node, imageUrl) {
  if (!node) return;
  node.replaceChildren();
  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "挂件图标预览";
    node.append(image);
    return;
  }
  node.textContent = "A";
}
