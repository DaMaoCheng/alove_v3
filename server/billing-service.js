import { getDbPool, withTransaction } from "./db.js";

const BILLING_PLANS = Object.freeze([
  Object.freeze({ id: "pack_10", rmbAmount: 10, credits: 100 }),
  Object.freeze({ id: "pack_100", rmbAmount: 25, credits: 260 }),
  Object.freeze({ id: "pack_50", rmbAmount: 50, credits: 520 }),
]);

export async function getBalance(userId) {
  const [rows] = await getDbPool().execute(
    "SELECT balance FROM billing_accounts WHERE internal_uid = ? LIMIT 1",
    [userId]
  );
  return {
    ok: true,
    balance: Number(rows[0]?.balance || 0),
  };
}

export async function createRechargeOrder(userId, payload = {}) {
  const plan = resolvePlan(payload);
  const orderId = buildOrderId();
  await getDbPool().execute(
    `INSERT INTO recharge_orders (
       order_id, internal_uid, provider, channel, plan_id, subject, status,
       rmb_amount, credited_amount, request_payload_json
     ) VALUES (?, ?, 'manual', 'page', ?, ?, 'pending', ?, ?, ?)`,
    [
      orderId,
      userId,
      plan.id,
      `AIOVE recharge ${plan.rmbAmount}`,
      plan.rmbAmount,
      plan.credits,
      JSON.stringify({ planId: plan.id, rmbAmount: plan.rmbAmount, credits: plan.credits }),
    ]
  );

  return {
    ok: true,
    orderId,
    paymentUrl: "",
    channel: "page",
    plan,
  };
}

export async function settleRecharge(userId, payload = {}) {
  const plan = resolvePlan(payload);
  const orderId = String(payload.orderId || "").trim() || buildOrderId();

  return withTransaction(async (db) => {
    const [existingRows] = await db.execute(
      "SELECT * FROM recharge_orders WHERE order_id = ? LIMIT 1",
      [orderId]
    );
    if (!existingRows[0]) {
      await db.execute(
        `INSERT INTO recharge_orders (
           order_id, internal_uid, provider, channel, plan_id, subject, status,
           rmb_amount, credited_amount, request_payload_json
         ) VALUES (?, ?, 'manual', 'page', ?, ?, 'pending', ?, ?, ?)`,
        [
          orderId,
          userId,
          plan.id,
          `AIOVE recharge ${plan.rmbAmount}`,
          plan.rmbAmount,
          plan.credits,
          JSON.stringify({ planId: plan.id, rmbAmount: plan.rmbAmount, credits: plan.credits }),
        ]
      );
    }

    const [settledRows] = await db.execute(
      "SELECT id FROM billing_logs WHERE internal_uid = ? AND reason = 'user_recharge' AND ref_id = ? LIMIT 1",
      [userId, `order:${orderId}`]
    );
    if (settledRows[0]) {
      const [balanceRows] = await db.execute(
        "SELECT balance FROM billing_accounts WHERE internal_uid = ? LIMIT 1",
        [userId]
      );
      return { ok: true, alreadySettled: true, orderId, balance: Number(balanceRows[0]?.balance || 0) };
    }

    await db.execute(
      "INSERT IGNORE INTO billing_accounts (internal_uid, balance, currency) VALUES (?, 0, 'credits')",
      [userId]
    );
    const [accountRows] = await db.execute(
      "SELECT balance FROM billing_accounts WHERE internal_uid = ? FOR UPDATE",
      [userId]
    );
    const balanceBefore = Number(accountRows[0]?.balance || 0);
    const balanceAfter = Number((balanceBefore + plan.credits).toFixed(3));

    await db.execute(
      "UPDATE billing_accounts SET balance = ?, recharge_balance = recharge_balance + ?, updated_at = NOW(3) WHERE internal_uid = ?",
      [balanceAfter, plan.credits, userId]
    );
    await db.execute(
      `INSERT INTO billing_logs (
         internal_uid, message_type, delta, balance_before, balance_after, credited, charged, status, reason, ref_id
       ) VALUES (?, 'recharge', ?, ?, ?, ?, 0, 'topup', 'user_recharge', ?)`,
      [userId, plan.credits, balanceBefore, balanceAfter, plan.credits, `order:${orderId}`]
    );
    await db.execute(
      "UPDATE recharge_orders SET status = 'settled', settled_at = NOW(3), updated_at = NOW(3) WHERE order_id = ?",
      [orderId]
    );

    return {
      ok: true,
      orderId,
      balance: balanceAfter,
      creditedAmount: plan.credits,
      plan,
    };
  });
}

function resolvePlan(payload = {}) {
  const planId = String(payload.planId || "").trim();
  const rmbAmount = Number(payload.rmbAmount || 0);
  const plan = BILLING_PLANS.find((item) => item.id === planId) ||
    BILLING_PLANS.find((item) => item.rmbAmount === rmbAmount);
  if (!plan) {
    const error = new Error("未找到对应充值档位");
    error.statusCode = 400;
    throw error;
  }
  return plan;
}

function buildOrderId() {
  return `re_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
