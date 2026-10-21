import assert from "node:assert/strict";
import { closeDbPool, getDbPool } from "../server/db.js";

// Read-only deployment preflight. Table creation remains centralized in the
// existing startup migration; this script only proves the deployed database has
// already reached the schema required by the TTMall binding and checkout flow.
const REQUIRED_SCHEMA = Object.freeze([
  Object.freeze({
    table: "ttmall_cart_sessions",
    columns: ["id", "user_id", "site_id", "source_cache_key", "cart_hash", "created_at", "updated_at"],
    indexes: ["PRIMARY", "uniq_ttmall_cart_sessions_owner", "idx_ttmall_cart_sessions_site_updated"],
  }),
  Object.freeze({
    table: "ttmall_account_bindings",
    columns: ["id", "user_id", "site_id", "source_cache_key", "ttmall_user_id", "ttmall_email", "access_token_encrypted", "token_status", "access_token_expires_at", "last_checked_at", "last_error_code"],
    indexes: ["PRIMARY", "uniq_ttmall_account_binding_owner", "uniq_ttmall_account_binding_external", "idx_ttmall_account_binding_status"],
  }),
  Object.freeze({
    table: "ttmall_binding_candidates",
    columns: ["id", "user_id", "site_id", "source_cache_key", "email", "candidate_status", "created_at", "updated_at"],
    indexes: ["PRIMARY", "uniq_ttmall_binding_candidate_owner", "idx_ttmall_binding_candidates_site_status"],
  }),
  Object.freeze({
    table: "ttmall_checkout_attempts",
    columns: ["id", "user_id", "site_id", "source_cache_key", "cart_snapshot_hash", "attempt_status", "order_number_encrypted", "next_cart_hash_encrypted", "payment_type", "safe_error_code", "upstream_http_status", "upstream_outcome", "upstream_business_code", "upstream_response_shape", "upstream_safe_message", "active_snapshot_key"],
    indexes: ["PRIMARY", "idx_ttmall_checkout_attempts_owner", "idx_ttmall_checkout_attempts_status", "uniq_ttmall_checkout_attempt_active_snapshot"],
  }),
]);

try {
  const db = getDbPool();
  const tableNames = REQUIRED_SCHEMA.map(({ table }) => table);
  const placeholders = tableNames.map(() => "?").join(", ");
  const [tables] = await db.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`,
    tableNames,
  );
  const existingTables = new Set(tables.map((row) => String(row.TABLE_NAME)));
  for (const { table } of REQUIRED_SCHEMA) {
    assert.ok(existingTables.has(table), `TTMall deployment preflight: missing table ${table}`);
  }

  const [columns] = await db.query(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`,
    tableNames,
  );
  const columnsByTable = groupNames(columns, "TABLE_NAME", "COLUMN_NAME");

  const [indexes] = await db.query(
    `SELECT TABLE_NAME, INDEX_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`,
    tableNames,
  );
  const indexesByTable = groupNames(indexes, "TABLE_NAME", "INDEX_NAME");

  for (const { table, columns: requiredColumns, indexes: requiredIndexes } of REQUIRED_SCHEMA) {
    for (const column of requiredColumns) {
      assert.ok(columnsByTable.get(table)?.has(column), `TTMall deployment preflight: missing ${table}.${column}`);
    }
    for (const index of requiredIndexes) {
      assert.ok(indexesByTable.get(table)?.has(index), `TTMall deployment preflight: missing ${table} index ${index}`);
    }
  }

  console.log("TTMall deployment database preflight passed");
} finally {
  await closeDbPool();
}

function groupNames(rows, groupKey, nameKey) {
  const groups = new Map();
  for (const row of rows) {
    const group = String(row[groupKey]);
    if (!groups.has(group)) groups.set(group, new Set());
    groups.get(group).add(String(row[nameKey]));
  }
  return groups;
}
