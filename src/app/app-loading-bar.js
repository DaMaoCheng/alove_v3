let progressTimer = null;
let finishTimer = null;
let progressValue = 0;

export function startPageLoading() {
  ensureLoadingBar();
  window.clearTimeout(finishTimer);
  progressValue = Math.max(8, readCurrentLoadingProgress());
  document.body.classList.add("page-loading-active");
  updateLoadingBar(progressValue);
  window.clearInterval(progressTimer);
  progressTimer = window.setInterval(() => {
    progressValue = Math.min(progressValue + Math.max(1, (92 - progressValue) * 0.08), 92);
    updateLoadingBar(progressValue);
  }, 180);
}

export function finishPageLoading() {
  ensureLoadingBar();
  window.clearInterval(progressTimer);
  progressTimer = null;
  updateLoadingBar(100);
  window.clearTimeout(finishTimer);
  finishTimer = window.setTimeout(() => {
    document.body.classList.remove("page-loading-active");
    updateLoadingBar(0);
  }, 260);
}

export function createAppBootScreen() {
  const root = document.createElement("div");
  root.className = "app-boot-screen";
  return root;
}

function ensureLoadingBar() {
  if (document.querySelector("[data-page-loading-bar]")) return;
  const bar = document.createElement("div");
  bar.className = "page-loading-bar";
  bar.dataset.pageLoadingBar = "";
  bar.innerHTML = '<i data-page-loading-fill></i>';
  document.body.prepend(bar);
}

function updateLoadingBar(value) {
  const fill = document.querySelector("[data-page-loading-fill]");
  if (!fill) return;
  fill.style.transform = `scaleX(${Math.max(0, Math.min(100, value)) / 100})`;
}

function readCurrentLoadingProgress() {
  const fill = document.querySelector("[data-page-loading-fill]");
  const transform = String(fill?.style?.transform || "");
  const match = transform.match(/scaleX\(([^)]+)\)/);
  const value = Number(match?.[1]);
  return Number.isFinite(value) ? value * 100 : 0;
}
