import nodemailer from "nodemailer";
import { SERVER_CONFIG } from "./config.js";

const EMAIL_SUBJECTS = Object.freeze({
  register: "Your Alove verification code",
  forgot_password: "Reset your Alove password",
});

let smtpTransporter = null;

export function resolveEmailProvider() {
  const provider = SERVER_CONFIG.email.provider || (SERVER_CONFIG.emailAuthDevMode ? "dev" : "unconfigured");
  return ["dev", "smtp", "unconfigured"].includes(provider) ? provider : "unconfigured";
}

export async function sendVerificationEmail({ email, code, scene, expiresInSeconds }) {
  const provider = resolveEmailProvider();
  if (provider === "dev") {
    return {
      ok: true,
      provider,
      delivered: false,
      devCode: code,
    };
  }

  if (provider === "smtp") {
    assertSmtpConfigured();
    const message = buildVerificationEmail({ email, code, scene, expiresInSeconds });
    try {
      const info = await getSmtpTransporter().sendMail(message);
      return {
        ok: true,
        provider,
        delivered: true,
        messageId: info.messageId || "",
      };
    } catch (error) {
      console.error("[email] SMTP delivery failed:", error.message);
      throwProviderError("验证码邮件发送失败，请稍后再试");
    }
  }

  throwProviderError("邮件服务暂未配置，请先配置 EMAIL_PROVIDER 和对应凭据");
}

function getSmtpTransporter() {
  if (smtpTransporter) return smtpTransporter;

  const options = {
    host: SERVER_CONFIG.email.smtp.host,
    port: SERVER_CONFIG.email.smtp.port,
    secure: SERVER_CONFIG.email.smtp.secure,
    auth: {
      user: SERVER_CONFIG.email.smtp.user,
      pass: SERVER_CONFIG.email.smtp.password,
    },
  };
  if (SERVER_CONFIG.email.smtp.proxyUrl) {
    options.proxy = SERVER_CONFIG.email.smtp.proxyUrl;
  }

  smtpTransporter = nodemailer.createTransport(options);
  return smtpTransporter;
}

function buildVerificationEmail({ email, code, scene, expiresInSeconds }) {
  const normalizedScene = scene === "forgot_password" ? "forgot_password" : "register";
  const expiresMinutes = Math.max(1, Math.ceil(Number(expiresInSeconds || 600) / 60));
  const subject = EMAIL_SUBJECTS[normalizedScene] || EMAIL_SUBJECTS.register;
  const purpose = normalizedScene === "forgot_password"
    ? "reset your Alove password"
    : "complete your Alove registration";
  const text = [
    `Your verification code is: ${code}`,
    "",
    `Use this code to ${purpose}. It will expire in ${expiresMinutes} minutes.`,
    "If you did not request this code, you can ignore this email.",
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#222;max-width:520px">
      <p>Your verification code is:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:18px 0">${escapeHtml(code)}</p>
      <p>Use this code to ${escapeHtml(purpose)}. It will expire in ${expiresMinutes} minutes.</p>
      <p style="color:#666">If you did not request this code, you can ignore this email.</p>
    </div>
  `;

  return {
    from: SERVER_CONFIG.email.from,
    to: email,
    subject,
    text,
    html,
  };
}

function assertSmtpConfigured() {
  const missing = [];
  if (!SERVER_CONFIG.email.from) missing.push("EMAIL_FROM");
  if (!SERVER_CONFIG.email.smtp.host) missing.push("SMTP_HOST");
  if (!SERVER_CONFIG.email.smtp.user) missing.push("SMTP_USER");
  if (!SERVER_CONFIG.email.smtp.password) missing.push("SMTP_PASSWORD");
  if (missing.length) {
    throwProviderError(`SMTP 邮件服务缺少配置：${missing.join(", ")}`);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function throwProviderError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  throw error;
}
