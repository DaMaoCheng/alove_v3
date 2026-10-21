import { getAdminNewFeedbackCount } from "../../services/admin-feedback-service.js";

const REFRESH_INTERVAL_MS = 5_000;

// The indicator is intentionally independent from the feedback page controller:
// only this dot changes when a new record appears, so current admin filters,
// expanded rows and scroll positions stay untouched.
export function bindAdminFeedbackIndicator(shell) {
  const indicator = shell?.querySelector("[data-admin-feedback-indicator]");
  if (!indicator) return () => {};

  let disposed = false;
  let latestRequest = 0;
  const refresh = async () => {
    const requestId = ++latestRequest;
    try {
      const count = await getAdminNewFeedbackCount();
      if (disposed || requestId !== latestRequest) return;
      indicator.hidden = count < 1;
      indicator.setAttribute("aria-label", count > 0 ? `有 ${count} 条未处理反馈` : "没有未处理反馈");
    } catch {
      // A temporary badge refresh failure must not disturb the active admin page.
    }
  };

  const onFeedbackSubmitted = () => refresh();
  const onFeedbackStatusUpdated = () => refresh();
  window.addEventListener("aiove:feedback-submitted", onFeedbackSubmitted);
  window.addEventListener("aiove:feedback-status-updated", onFeedbackStatusUpdated);
  const intervalId = window.setInterval(refresh, REFRESH_INTERVAL_MS);
  refresh();

  return () => {
    disposed = true;
    window.clearInterval(intervalId);
    window.removeEventListener("aiove:feedback-submitted", onFeedbackSubmitted);
    window.removeEventListener("aiove:feedback-status-updated", onFeedbackStatusUpdated);
  };
}
