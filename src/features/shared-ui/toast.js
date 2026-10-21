let toastTimer = 0;

export function showToast(message) {
  const text = String(message || "").trim();
  if (!text) return;

  let toast = document.getElementById("globalToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "globalToast";
    toast.className = "toast";
    document.body.append(toast);
  }

  toast.textContent = text;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}
