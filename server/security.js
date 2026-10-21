import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export function createId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export function createToken() {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(value) {
  const token = String(value || "").trim();
  if (!token) return "";
  if (token.startsWith("sha256:")) return token;
  return `sha256:${createHash("sha256").update(`session:${token}`).digest("hex")}`;
}

export function hashSecret(value) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(String(value || ""), salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

export function verifySecret(value, storedHash) {
  const [salt, hash] = String(storedHash || "").split(":");
  if (!salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  const actual = Buffer.from(pbkdf2Sync(String(value || ""), salt, 100000, 64, "sha512").toString("hex"), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function encryptSecret(value, keySeed = "") {
  const text = String(value || "");
  if (!text) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveEncryptionKey(keySeed), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(value, keySeed = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const [version, ivRaw, tagRaw, encryptedRaw] = text.split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) return "";
  const decipher = createDecipheriv("aes-256-gcm", deriveEncryptionKey(keySeed), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function createNumericCode(length = 6) {
  const max = 10 ** length;
  return String(Math.floor(Math.random() * max)).padStart(length, "0");
}

function deriveEncryptionKey(seed = "") {
  const text = String(seed || "").trim() || "aiove-local-development-secret";
  return createHash("sha256").update(text).digest();
}
