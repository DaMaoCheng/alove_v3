import assert from "node:assert/strict";
import { closeDbPool, getDbPool } from "../server/db.js";
import { listAdminErrorLogs, recordProviderCallLog } from "../server/ai-reply-log-service.js";

const requestId = `provider_audit_${Date.now()}`;
const pool = getDbPool();

try {
  await recordProviderCallLog({
    requestId,
    provider: "openai",
    model: "provider-audit-self-check",
    baseUrl: "https://clclapi.com/v1?must_not_be_stored=true",
    sourceRef: "provider-call-self-check",
    status: "success",
    durationMs: 12,
  });

  const [rows] = await pool.execute(
    "SELECT provider, model, base_url, status, source_type, source_ref, duration_ms, error_message FROM ai_reply_logs WHERE request_id = ?",
    [requestId]
  );
  assert.equal(rows.length, 1, "provider call audit must persist one row");
  assert.deepEqual(rows[0], {
    provider: "clcl",
    model: "provider-audit-self-check",
    base_url: "https://clclapi.com/v1",
    status: "provider_success",
    source_type: "provider_call",
    source_ref: "provider-call-self-check",
    duration_ms: 12,
    error_message: null,
  }, "provider audit must be supplier-labelled and free of URL query data");

  await recordProviderCallLog({ requestId, provider: 'venice', model: 'provider-audit-self-check', sourceRef: 'provider-call-self-check', status: 'error',
    error: { statusCode: 429, message: 'PRIVATE_BODY_WITH_CREDENTIAL', providerRateLimit: { kind: 'model_overloaded', retryAfterSeconds: 30, remainingRequests: 99 } } });
  const [failures] = await pool.execute("SELECT error_message FROM ai_reply_logs WHERE request_id=? AND status='provider_error'", [requestId]);
  assert.equal(failures.length, 1);
  assert(failures[0].error_message.includes('cause=model_overloaded') && failures[0].error_message.includes('requests_remaining=99'));
  assert(!failures[0].error_message.includes('PRIVATE_BODY_WITH_CREDENTIAL'));

  await recordProviderCallLog({ requestId, provider: 'deepseek', model: 'provider-audit-self-check', sourceRef: 'provider-call-protocol-self-check', status: 'error',
    error: { code: 'AI_REPLY_PROTOCOL_ERROR', message: 'PRIVATE_UPSTREAM_SSE_AND_CREDENTIAL' } });
  const [protocolFailures] = await pool.execute("SELECT degradation_reason, error_message FROM ai_reply_logs WHERE request_id=? AND source_ref=?", [requestId, 'provider-call-protocol-self-check']);
  assert.equal(protocolFailures.length, 1);
  assert.equal(protocolFailures[0].degradation_reason, 'protocol');
  assert(protocolFailures[0].error_message.includes('reason=protocol'));
  assert(!protocolFailures[0].error_message.includes('PRIVATE_UPSTREAM'));

  const page = await listAdminErrorLogs({ source: "clcl", limit: 20 });
  assert.ok(page.items.some((item) => item.requestId === requestId && item.status === "provider_success"), "admin log API must return successful provider calls");
} finally {
  await pool.execute("DELETE FROM ai_reply_logs WHERE request_id = ?", [requestId]);
  await closeDbPool();
}

console.log("provider call log runtime self-check passed");
