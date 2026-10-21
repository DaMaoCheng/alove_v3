import { listReportingTokens, createReportingToken, revokeReportingToken } from "../../services/admin-reporting-service.js";
import { showDialog } from "../shared-ui/dialog.js";
import { showToast } from "../shared-ui/toast.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { registerViewDisposer } from "../../app/app-view-lifecycle.js";
import { reportingCreateHtml, reportingListHtml, reportingTokenHtml } from "./admin-reporting-template.js";

export function bindAdminReporting(shell) {
  const list = shell.querySelector("[data-reporting-list]");
  const create = shell.querySelector("[data-reporting-create]");
  if (!list || !create) return;
  let data = { items: [], scopes: [], sites: [] };
  let disposed = false;
  let sequence = 0;
  const render = () => { if (!disposed) list.innerHTML = reportingListHtml(data.items, data); };
  const load = async () => {
    const current = ++sequence;
    list.innerHTML = `<div class="log-empty">正在加载 API...</div>`;
    try { const result = await listReportingTokens(); if (disposed || current !== sequence) return; data = { items: result.items || [], scopes: result.scopes || [], sites: result.sites || [] }; create.disabled = false; render(); }
    catch (error) { if (!disposed) list.innerHTML = `<div class="log-empty">${error.message || "API 列表读取失败"}</div>`; }
  };
  const close = () => { document.body.classList.remove("dialog-open"); document.getElementById("reportingDialogHost")?.remove(); };
  const openCreate = () => {
    close(); const host = document.createElement("div"); host.id = "reportingDialogHost"; host.className = "dialog-host account-form-host"; host.innerHTML = reportingCreateHtml(data); document.body.append(host); document.body.classList.add("dialog-open"); bindDropdowns(host);
    host.querySelectorAll("[data-reporting-close]").forEach((el) => el.addEventListener("click", close));
    const all = host.querySelector('input[name="allSites"]'); const sites = host.querySelectorAll('input[name="siteIds"]');
    all?.addEventListener("change", () => sites.forEach((item) => { item.disabled = all.checked; if (all.checked) item.checked = false; }));
    host.querySelector("[data-reporting-form]")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const scopeValues = [...form.querySelectorAll('input[name="scopes"]:checked')].map((i) => i.value); const allSites = Boolean(form.querySelector('input[name="allSites"]')?.checked); const siteIds = [...form.querySelectorAll('input[name="siteIds"]:checked')].map((i) => i.value); const tip = host.querySelector("[data-reporting-tip]"); if (!scopeValues.length || (!allSites && !siteIds.length)) { if (tip) tip.textContent = "至少选择一项读取权限和站点范围。"; return; } const submit = form.querySelector('[type="submit"]'); submit.disabled = true; try { const result = await createReportingToken({ name: form.elements.name.value.trim(), scopes: scopeValues, allSites, siteIds, expiresInDays: Number(form.elements.expiresInDays.value) }); close(); openToken(result.token); await load(); } catch (error) { submit.disabled = false; if (tip) tip.textContent = error.message || "生成失败，请稍后重试"; } });
  };
  const openToken = (token) => { const host = document.createElement("div"); host.id = "reportingDialogHost"; host.className = "dialog-host account-form-host"; host.innerHTML = reportingTokenHtml(token, window.location.origin); document.body.append(host); document.body.classList.add("dialog-open"); host.querySelectorAll("[data-reporting-close]").forEach((el) => el.addEventListener("click", close)); host.querySelector("[data-reporting-copy]")?.addEventListener("click", async () => { try { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(token); else { const field = host.querySelector("[data-reporting-secret]"); field?.select(); if (!document.execCommand("copy")) throw new Error("copy failed"); } host.querySelector("[data-reporting-tip]").textContent = "已复制 Token"; } catch { host.querySelector("[data-reporting-tip]").textContent = "复制失败，请手动复制"; } }); };
  create.addEventListener("click", openCreate);
  list.addEventListener("click", (event) => { const button = event.target.closest("[data-reporting-revoke]"); if (!button) return; showDialog({ type: "warning", title: "撤销 API", message: "撤销后此 Token 将立即失效，确定继续吗？", confirmText: "确认撤销", cancelText: "取消", onConfirm: async () => { try { await revokeReportingToken(button.dataset.reportingRevoke); showToast("API 已撤销"); await load(); } catch (error) { showToast(error.message || "撤销失败"); } } }); });
  registerViewDisposer(shell, () => { disposed = true; sequence += 1; close(); });
  void load();
}
