import {
  detectAssistantSelfExposure,
  detectIncompleteEnding,
  detectInternalInfoLeak,
  detectMarkdownFormatting,
  detectStructuredReplyLeak,
  detectTemplateTone,
  extractStructuredDisplayText,
  sanitizeMarkdownFormatting,
  sanitizeTemplateTone,
} from "./ai-reply-quality-rules.js";
import { buildLanguageQualityFallbackReply } from "./chat-reply-language-quality.js";

const MAX_VISIBLE_REPLY_CHARS = 1600;

export function inspectAiReplyQuality({ text, userText = "", language = "en", deferIdentityToBoundaryReview = false } = {}) {
  const originalText = normalizeReplyText(text);
  const reasons = [];
  let finalText = originalText;
  let severity = "pass";
  let shouldReplace = false;

  if (!originalText) {
    return buildResult({
      finalText: buildLanguageQualityFallbackReply(language),
      severity: "block",
      shouldReplace: true,
      reasons: ["empty_reply"],
    });
  }

  if (detectInternalInfoLeak(originalText)) {
    reasons.push("internal_info_leak");
    severity = "block";
    shouldReplace = true;
  }

  // Only the guest/member orchestration paths opt in: their original candidate
  // always receives the complete trusted-identity boundary review below.
  if (!deferIdentityToBoundaryReview && detectAssistantSelfExposure(originalText)) {
    reasons.push("assistant_self_exposure");
    severity = "block";
    shouldReplace = true;
  }

  if (detectStructuredReplyLeak(originalText)) {
    const extracted = normalizeReplyText(extractStructuredDisplayText(originalText));
    if (extracted) {
      reasons.push("structured_reply_leak_cleaned");
      finalText = extracted;
      severity = severity === "block" ? "block" : "warn";
    } else {
      reasons.push("structured_reply_leak");
      severity = "block";
      shouldReplace = true;
    }
  }

  if (detectMarkdownFormatting(finalText)) {
    const sanitized = normalizeReplyText(sanitizeMarkdownFormatting(finalText));
    if (sanitized) {
      finalText = sanitized;
      reasons.push("markdown_cleaned");
      severity = severity === "block" ? "block" : "warn";
    }
  }

  if (detectIncompleteEnding(finalText, language)) {
    reasons.push("incomplete_ending");
    severity = severity === "block" ? "block" : "warn";
  }

  if (detectTemplateTone(finalText)) {
    reasons.push("template_tone");
    const sanitizedTemplateTone = normalizeReplyText(sanitizeTemplateTone(finalText));
    if (sanitizedTemplateTone) {
      finalText = sanitizedTemplateTone;
    } else {
      shouldReplace = true;
    }
    severity = severity === "block" ? "block" : "warn";
  }

  if (finalText.length > MAX_VISIBLE_REPLY_CHARS) {
    reasons.push("reply_too_long");
    finalText = `${finalText.slice(0, MAX_VISIBLE_REPLY_CHARS).trim()}...`;
    severity = severity === "block" ? "block" : "warn";
  }

  if (shouldReplace) {
    finalText = buildLanguageQualityFallbackReply(language);
  }

  return buildResult({
    finalText,
    severity,
    shouldReplace,
    reasons: Array.from(new Set(reasons)),
  });
}

function buildResult({ finalText, severity, shouldReplace, reasons }) {
  const normalizedSeverity = ["pass", "warn", "block"].includes(severity) ? severity : "warn";
  return {
    ok: normalizedSeverity === "pass",
    severity: normalizedSeverity,
    reasons,
    finalText: normalizeReplyText(finalText),
    shouldReplace: Boolean(shouldReplace),
  };
}

function normalizeReplyText(value = "") {
  return String(value == null ? "" : value).replace(/\r\n/g, "\n").trim();
}
