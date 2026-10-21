import { createAdminMascotAdDelivery, getAdminMascotAdDelivery } from "../../services/admin-mascot-service.js";
import { showToast } from "../shared-ui/toast.js";

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_FAILURES = 5;
const MAX_POLL_DELAY_MS = 8000;

export function bindAdminMascotAdPreview(host, { onDeliveryCompleted } = {}) {
  const form = host.querySelector("[data-mascot-ad-form]");
  if (!form) return () => {};

  const campaignInput = form.querySelector('[name="campaignId"]');
  const campaignTrigger = form.querySelector(".mascot-ad-campaign-dd [data-dd-trigger]");
  const sendButton = form.querySelector("[data-mascot-ad-send]");
  const closeButton = form.querySelector("[data-mascot-ad-close]");
  const progress = form.querySelector("[data-mascot-ad-progress]");
  const result = form.querySelector("[data-mascot-ad-result]");
  const success = form.querySelector("[data-mascot-ad-success]");
  const failed = form.querySelector("[data-mascot-ad-failed]");
  const failureHelp = form.querySelector("[data-mascot-ad-failure-help]");
  const failureTooltip = form.querySelector("[data-mascot-ad-failure-tooltip]");
  const siteId = String(form.dataset.mascotSite || "").trim();
  let pollTimer = null;
  let deliveryId = "";
  let stopped = false;
  let pollFailureCount = 0;
  let completionNotified = false;

  const syncReadyState = () => {
    if (sendButton && form.dataset.mascotAdState === "ready") {
      sendButton.disabled = !campaignInput?.value;
    }
  };

  const renderDelivery = (delivery = {}) => {
    const total = Math.max(0, Number(delivery.total || 0));
    const processed = Math.min(total, Math.max(0, Number(delivery.processed || 0)));
    if (progress) progress.textContent = `${processed} / ${total}`;
    if (delivery.status !== "completed" && delivery.status !== "failed") return false;

    form.dataset.mascotAdState = "completed";
    if (progress) progress.hidden = true;
    if (result) result.hidden = false;
    if (success) success.textContent = String(Math.max(0, Number(delivery.sent || 0)));
    if (failed) failed.textContent = String(Math.max(0, Number(delivery.failed || 0)));
    renderFailureReasons({
      help: failureHelp,
      tooltip: failureTooltip,
      failedCount: Math.max(0, Number(delivery.failed || 0)),
      reasons: delivery.failureReasons,
    });
    if (sendButton) sendButton.textContent = "已完成";
    if (closeButton) closeButton.textContent = "关闭";
    if (!completionNotified) {
      completionNotified = true;
      onDeliveryCompleted?.(delivery);
    }
    return true;
  };

  const renderPollFailure = (message) => {
    form.dataset.mascotAdState = "failed";
    if (progress) {
      progress.hidden = false;
      progress.classList.add("is-error");
      progress.textContent = message || "投放仍在后台执行，暂时无法读取进度";
    }
    if (result) result.hidden = true;
    if (sendButton) sendButton.textContent = "状态读取失败";
    if (closeButton) closeButton.textContent = "关闭";
  };

  const poll = async () => {
    if (stopped || !deliveryId) return;
    try {
      const response = await getAdminMascotAdDelivery(siteId, deliveryId);
      if (stopped) return;
      pollFailureCount = 0;
      if (renderDelivery(response.delivery)) return;
      pollTimer = window.setTimeout(poll, POLL_INTERVAL_MS);
    } catch (error) {
      if (stopped) return;
      pollFailureCount += 1;
      const status = Number(error?.status || 0);
      const retryable = status === 0 || status >= 500;
      if (!retryable || pollFailureCount >= MAX_POLL_FAILURES) {
        renderPollFailure(error.message || "投放进度读取失败，请关闭后重新进入查看");
        showToast(error.message || "投放进度读取失败，请稍后重试");
        return;
      }
      const delay = Math.min(MAX_POLL_DELAY_MS, POLL_INTERVAL_MS * (2 ** pollFailureCount));
      pollTimer = window.setTimeout(poll, delay);
    }
  };

  campaignInput?.addEventListener("change", syncReadyState);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!campaignInput?.value || deliveryId || form.dataset.mascotAdState === "completed") return;
    form.dataset.mascotAdState = "sending";
    if (campaignTrigger) campaignTrigger.disabled = true;
    if (sendButton) {
      sendButton.disabled = true;
      sendButton.textContent = "发送中";
    }
    if (result) result.hidden = true;
    if (progress) progress.hidden = false;
    try {
      const response = await createAdminMascotAdDelivery(siteId, campaignInput.value);
      deliveryId = String(response.delivery?.id || "").trim();
      if (!deliveryId) throw new Error("投放任务创建失败");
      if (!renderDelivery(response.delivery)) void poll();
    } catch (error) {
      form.dataset.mascotAdState = "ready";
      if (campaignTrigger) campaignTrigger.disabled = false;
      if (sendButton) sendButton.textContent = "发送";
      if (progress) progress.hidden = true;
      syncReadyState();
      showToast(error.message || "广告发送失败，请稍后再试");
    }
  });

  syncReadyState();
  return () => {
    stopped = true;
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = null;
  };
}

function renderFailureReasons({ help, tooltip, failedCount, reasons }) {
  if (!help || !tooltip) return;
  const items = Array.isArray(reasons) ? reasons.filter((item) => Number(item?.count || 0) > 0) : [];
  help.hidden = failedCount <= 0;
  if (failedCount <= 0) {
    tooltip.replaceChildren();
    return;
  }
  const visibleItems = items.length ? items : [{ label: "其他发送错误", count: failedCount }];
  tooltip.replaceChildren(...visibleItems.map((item) => {
    const row = document.createElement("span");
    row.textContent = `${String(item.label || "其他发送错误")}：${Math.max(0, Number(item.count || 0))} 人`;
    return row;
  }));
}
