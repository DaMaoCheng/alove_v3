export function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

export function escapeAdminTableHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

export const escapeAdminTableAttr = escapeAdminTableHtml;

export function formatNumber(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toLocaleString("zh-CN");
}

export function formatSourcePage(item = {}) {
  const title = String(item?.sourcePageTitle || "").trim();
  const url = String(item?.sourcePageUrl || "").trim();
  if (title && url && title !== url) return `${title} · ${url}`;
  return url || title || "-";
}

export function paginationButtonsHtml(page, pages, pageDataAttribute) {
  const buttonHtml = (value) => `<button class="pg-btn ${page === value ? "active" : ""}" type="button" ${pageDataAttribute}="${value}">${value}</button>`;
  if (pages <= 7) {
    return Array.from({ length: pages }, (_, index) => buttonHtml(index + 1)).join("");
  }
  const candidates = new Set([1, pages, page - 1, page, page + 1].filter((value) => value >= 1 && value <= pages));
  return Array.from(candidates).sort((left, right) => left - right).map((value, index, list) => {
    const gap = index > 0 && value - list[index - 1] > 1 ? `<span class="pg-ellipsis">...</span>` : "";
    return `${gap}${buttonHtml(value)}`;
  }).join("");
}
