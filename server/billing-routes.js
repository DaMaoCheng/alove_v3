import { requireAuth } from "./auth-service.js";
import { getBalance } from "./billing-service.js";
import { readAuthToken, readJson, sendJson } from "./http-utils.js";

export async function handleBillingRoute(req, res, { path }) {
  if (req.method === "GET" && path === "/api/balance") {
    const user = await requireAuth(req, readAuthToken);
    sendJson(res, 200, await getBalance(user.id));
    return true;
  }
  if (req.method === "POST" && path === "/api/payments/alipay/create") {
    await requireAuth(req, readAuthToken);
    await readJson(req);
    sendJson(res, 403, {
      ok: false,
      error: "Recharge is temporarily unavailable.",
    });
    return true;
  }
  if (req.method === "POST" && path === "/api/recharge") {
    await requireAuth(req, readAuthToken);
    sendJson(res, 403, {
      ok: false,
      error: "Recharge confirmation is temporarily unavailable.",
    });
    return true;
  }
  return false;
}
