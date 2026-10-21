import assert from "node:assert/strict";
import { reencryptProductAccessToken, runProductSecretMigration } from "./migrate-product-api-secret-key.mjs";
import { decryptSecret, encryptSecret } from "../server/security.js";

const oldKey = "old-product-secret-key-for-self-check";
const newKey = "new-product-secret-key-for-self-check";
const plainText = "self-check-shopify-token";
const oldCiphertext = encryptSecret(plainText, oldKey);
const newCiphertext = reencryptProductAccessToken(oldCiphertext, oldKey, newKey);

assert.notEqual(newCiphertext, oldCiphertext, "migration should produce new ciphertext");
assert.equal(decryptSecret(newCiphertext, newKey), plainText, "new key should preserve the original token");
assert.throws(() => decryptSecret(newCiphertext, oldKey), "old key must not decrypt migrated ciphertext");
assert.throws(() => reencryptProductAccessToken(oldCiphertext, "wrong-old-key", newKey), /cannot be decrypted/);
assert.throws(() => reencryptProductAccessToken(oldCiphertext, oldKey, oldKey), /must differ/);
assert.equal(reencryptProductAccessToken("", oldKey, newKey), "", "empty site tokens should remain empty");

const rows = [
  { id: "site_one", product_access_token_encrypted: encryptSecret("token-one", oldKey) },
  { id: "site_two", product_access_token_encrypted: encryptSecret("token-two", oldKey) },
];

const success = mockConnection(rows);
assert.equal(await runProductSecretMigration(success.connection, { oldKey, newKey, execute: true }), 2);
assert.equal(success.calls.begin, 1, "execute migration should begin one transaction");
assert.equal(success.calls.update, 2, "execute migration should update every encrypted site token");
assert.equal(success.calls.commit, 1, "execute migration should commit once");
assert.equal(success.calls.rollback, 0, "successful execute migration should not rollback");

const preflight = mockConnection(rows);
assert.equal(await runProductSecretMigration(preflight.connection, { oldKey, newKey, execute: false }), 2);
assert.equal(preflight.calls.update, 0, "preflight must not update stored ciphertext");
assert.equal(preflight.calls.commit, 0, "preflight must not commit");
assert.equal(preflight.calls.rollback, 1, "preflight should release its read lock by rollback");

const failed = mockConnection(rows, { failUpdateNumber: 2 });
await assert.rejects(
  () => runProductSecretMigration(failed.connection, { oldKey, newKey, execute: true }),
  /mock update failure/,
  "an update failure should escape the migration"
);
assert.equal(failed.calls.commit, 0, "failed migration must not commit partial updates");
assert.equal(failed.calls.rollback, 1, "failed migration should rollback the full transaction");

console.log("product secret key migration self-check passed");

function mockConnection(siteRows, { failUpdateNumber = 0 } = {}) {
  const calls = { begin: 0, update: 0, commit: 0, rollback: 0 };
  return {
    calls,
    connection: {
      async beginTransaction() { calls.begin += 1; },
      async execute(sql) {
        if (String(sql).includes("FROM sites")) return [siteRows];
        calls.update += 1;
        if (failUpdateNumber && calls.update === failUpdateNumber) throw new Error("mock update failure");
        return [{ affectedRows: 1 }];
      },
      async commit() { calls.commit += 1; },
      async rollback() { calls.rollback += 1; },
    },
  };
}
