import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { initializeDatabase, getDbPool } from "../server/db.js";
import { PROJECT_ROOT } from "../server/config.js";

const baseUrl = String(process.env.RUNTIME_SELF_CHECK_BASE_URL || "http://127.0.0.1:4173").replace(/\/+$/, "");
const email = `avatar-self-check-${Date.now()}@example.local`;
const password = "Avatar12345";
let userId = "";
let avatarUrl = "";
let cookie = "";

try {
  const codeResult = await requestJson("/api/auth/email/send-code", {
    method: "POST",
    body: { email, scene: "register" },
  });
  const code = String(codeResult.devCode || "").trim();
  if (!code) throw new Error("dev verification code missing");

  const registerResult = await requestJson("/api/auth/register", {
    method: "POST",
    body: {
      email,
      password,
      confirmPassword: password,
      verificationCode: code,
      nickname: "Avatar Self Check",
    },
  });
  userId = registerResult.userId;

  const avatarResult = await requestJson("/api/characters/generate-avatar", {
    method: "POST",
    body: {
      name: "Mina",
      category: "Football Babe",
      personality: "Calm mentor",
      voice: "Warm & friendly",
      language: "English",
      openingLine: "Ready for matchday?",
      backstory: "A young adult football companion with a polished sporty portrait style, confident and friendly.",
    },
  });

  avatarUrl = String(avatarResult.avatarUrl || "").trim();
  if (!avatarUrl.startsWith("/uploads/avatars/")) {
    throw new Error(`unexpected avatarUrl: ${avatarUrl}`);
  }

  const avatarPath = join(PROJECT_ROOT, avatarUrl.replace(/^\/+/, ""));
  if (!existsSync(avatarPath)) {
    throw new Error(`generated avatar file missing: ${avatarPath}`);
  }

  console.log(JSON.stringify({ ok: true, email, userId, avatarUrl, avatarPath }, null, 2));
} finally {
  await cleanup().catch((error) => {
    console.warn(`[avatar-generation-self-check] cleanup failed: ${error.message}`);
  });
}

async function requestJson(path, { method = "GET", body = null } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : null,
  });

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
  }
  return payload;
}

async function cleanup() {
  if (avatarUrl) {
    await rm(join(PROJECT_ROOT, avatarUrl.replace(/^\/+/, "")), { force: true });
  }
  if (!userId && !email) return;

  await initializeDatabase();
  const db = getDbPool();
  if (userId) {
    await db.execute("DELETE FROM users WHERE id = ?", [userId]);
  } else {
    await db.execute("DELETE FROM users WHERE email = ?", [email]);
  }
  await db.end();
}
