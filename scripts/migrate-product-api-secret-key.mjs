import { lstatSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { SERVER_CONFIG } from "../server/config.js";
import { closeDbPool, getDbPool } from "../server/db.js";
import { decryptSecret, encryptSecret } from "../server/security.js";

export function reencryptProductAccessToken(encryptedValue, oldKey, newKey) {
  const source = String(encryptedValue || "").trim();
  if (!source) return "";
  if (!String(oldKey || "").trim()) throw new Error("old product encryption key is empty");
  if (!String(newKey || "").trim()) throw new Error("new product encryption key is empty");
  if (oldKey === newKey) throw new Error("old and new product encryption keys must differ");

  let plainText;
  try {
    plainText = decryptSecret(source, oldKey);
  } catch {
    throw new Error("stored product token cannot be decrypted with the old key");
  }
  if (!plainText) throw new Error("stored product token decrypted to an empty value");

  const migrated = encryptSecret(plainText, newKey);
  let verified;
  try {
    verified = decryptSecret(migrated, newKey);
  } catch {
    throw new Error("new product token ciphertext failed verification");
  }
  if (verified !== plainText) throw new Error("new product token ciphertext changed the token value");
  return migrated;
}

async function main() {
  const execute = process.argv.includes("--execute");
  if (execute && !process.argv.includes("--maintenance-confirmed")) {
    throw new Error("--execute requires --maintenance-confirmed after the app service is stopped");
  }
  const newKeyFile = String(process.env.PRODUCT_API_NEW_SECRET_KEY_FILE || "").trim();
  if (!newKeyFile) throw new Error("PRODUCT_API_NEW_SECRET_KEY_FILE is required");

  const oldKey = String(SERVER_CONFIG.productApi.secretKey || "").trim();
  const newKey = readSecretFile(newKeyFile);
  if (newKey.length < 32) throw new Error("new product encryption key must contain at least 32 characters");

  const connection = await getDbPool().getConnection();
  try {
    const migratedCount = await runProductSecretMigration(connection, { oldKey, newKey, execute });
    console.log(JSON.stringify({
      ok: true,
      mode: execute ? "executed" : "preflight",
      migratedSiteTokenCount: migratedCount,
    }, null, 2));
  } finally {
    connection.release();
    await closeDbPool();
  }
}

export async function runProductSecretMigration(connection, { oldKey, newKey, execute = false } = {}) {
  let migratedCount = 0;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, product_access_token_encrypted
       FROM sites
       WHERE product_access_token_encrypted IS NOT NULL
         AND product_access_token_encrypted <> ''
       FOR UPDATE`
    );

    for (const row of rows) {
      let migrated;
      try {
        migrated = reencryptProductAccessToken(row.product_access_token_encrypted, oldKey, newKey);
      } catch (error) {
        throw new Error(`site ${row.id} product token migration failed: ${error.message}`);
      }
      migratedCount += 1;
      if (execute) {
        await connection.execute(
          "UPDATE sites SET product_access_token_encrypted = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
          [migrated, row.id]
        );
      }
    }

    if (execute) await connection.commit();
    else await connection.rollback();
    return migratedCount;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  }
}

function readSecretFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("new product encryption key path must be a regular file");
  if ((stat.mode & 0o077) !== 0) throw new Error("new product encryption key file must not be readable or writable by group/others");
  const value = readFileSync(path, "utf8").trim();
  if (!value) throw new Error("new product encryption key file is empty");
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[product-secret-migration] ${error.message}`);
    process.exitCode = 1;
  });
}
