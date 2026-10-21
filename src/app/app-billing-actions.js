import { trackEvent } from "../analytics/track.js";
import { showToast } from "../features/shared-ui/toast.js";
import { getBalance } from "../services/billing-service.js";
import { createSiteCopy } from "../i18n/site-copy.js";

export function createBillingActions({ appState, sessionStore, syncSessionState, mountApp } = {}) {
  async function refreshBalance() {
    try {
      const result = await getBalance();
      sessionStore.setBalance(result.balance);
      syncSessionState();
    } catch (error) {
      trackEvent("balance_refresh_failed", {
        reason: error.message,
        status: error.status || 0,
      });
    }
  }

  async function handleRecharge({ planId, rmbAmount }) {
    trackEvent("recharge_submit", {
      plan_id: planId,
      rmb_amount: rmbAmount,
    });

    trackEvent("recharge_disabled", {
      plan_id: planId,
      rmb_amount: rmbAmount,
    });
    showToast(createSiteCopy(appState?.site?.pageLanguage).t("common.rechargeUnavailable"));
  }

  return {
    refreshBalance,
    handleRecharge,
  };
}
