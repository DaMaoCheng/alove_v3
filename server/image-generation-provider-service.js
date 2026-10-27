import { Buffer } from "node:buffer";
import { SERVER_CONFIG } from "./config.js";
import { recordProviderCallLog } from "./ai-reply-log-service.js";

const IMAGE_GENERATIONS_PATH = "/images/generations";
const IMAGE_EDITS_PATH = "/images/edits";
const VENICE_IMAGE_EDIT_PATH = "/image/edit";
const VENICE_IMAGE_MULTI_EDIT_PATH = "/image/multi-edit";
// 只在 Venice 该模型明确支持 resolution 参数时才传，否则 400
const VENICE_RESOLUTION_SUPPORT = new Set(["seedream-v5-pro-edit"]);

export function isImageGenerationConfigured() {
  return SERVER_CONFIG.imageGeneration.provider === "openai" && Boolean(SERVER_CONFIG.imageGeneration.openai.apiKey);
}

export async function requestGeneratedImage(prompt, {
  count = SERVER_CONFIG.imageGeneration.openai.count,
  size = SERVER_CONFIG.imageGeneration.openai.size,
  filenamePrefix = "ai-image",
  referenceImages = [],
  veniceSafeMode,
} = {}) {
  const images = Array.isArray(referenceImages) ? referenceImages.filter((image) => image?.buffer?.length) : [];
  if (images.length) {
    return requestGeneratedImageEdit(prompt, {
      count,
      size,
      filenamePrefix,
      referenceImages: images,
      veniceSafeMode,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVER_CONFIG.imageGeneration.openai.timeoutMs);
  const startedAt = Date.now();
  let providerCallLogged = false;

  try {
    const response = await fetch(buildImageGenerationUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVER_CONFIG.imageGeneration.openai.apiKey}`,
      },
      body: JSON.stringify({
        model: SERVER_CONFIG.imageGeneration.openai.model,
        prompt,
        n: Math.max(1, Number(count || 1)),
        size: normalizeGenerationSize(size),
        ...(isVeniceImageProvider() && typeof veniceSafeMode === "boolean"
          ? { moderation: veniceSafeMode ? "auto" : "low" } : {}),
      }),
      signal: controller.signal,
    });

    if (response.ok && isVeniceImageProvider() && typeof veniceSafeMode === "boolean") {
      await assertVeniceImageNotBlurred(response, SERVER_CONFIG.imageGeneration.openai.model);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throwServiceError(readImageGenerationError(payload, response.status), response.status >= 400 && response.status < 600 ? response.status : 502);
    }

    const image = await readGeneratedImagePayload(payload);
    if (!image.buffer?.length) {
      throwServiceError("图片生成服务没有返回图片数据", 502);
    }

    await recordProviderCallLog({
      provider: "image-generation", model: SERVER_CONFIG.imageGeneration.openai.model, baseUrl: SERVER_CONFIG.imageGeneration.openai.baseUrl,
      sourceRef: "image-generation", status: "success", startedAt,
    });
    providerCallLogged = true;

    return {
      buffer: image.buffer,
      contentType: image.contentType,
      filename: `${filenamePrefix}-${Date.now()}.png`,
    };
  } catch (error) {
    if (!providerCallLogged) {
      await recordProviderCallLog({
        provider: "image-generation", model: SERVER_CONFIG.imageGeneration.openai.model, baseUrl: SERVER_CONFIG.imageGeneration.openai.baseUrl,
        sourceRef: "image-generation", status: "error", startedAt, error,
      });
    }
    if (error?.name === "AbortError") {
      throwServiceError("图片生成超时，请稍后重试", 504);
    }
    if (error?.statusCode) throw error;
    throwServiceError(error.message || "图片生成失败，请稍后重试", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function buildImageGenerationUrl() {
  return `${SERVER_CONFIG.imageGeneration.openai.baseUrl}${IMAGE_GENERATIONS_PATH}`;
}

async function requestGeneratedImageEdit(prompt, {
  count = SERVER_CONFIG.imageGeneration.openai.count,
  size = SERVER_CONFIG.imageGeneration.openai.size,
  filenamePrefix = "ai-image",
  referenceImages = [],
  veniceSafeMode,
} = {}) {
  if (isVeniceImageProvider()) {
    return requestVeniceGeneratedImageEdit(prompt, {
      count,
      size,
      filenamePrefix,
      referenceImages,
      veniceSafeMode,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVER_CONFIG.imageGeneration.openai.timeoutMs);
  const startedAt = Date.now();
  let providerCallLogged = false;

  try {
    const form = new FormData();
    form.set("model", SERVER_CONFIG.imageGeneration.openai.model);
    form.set("prompt", prompt);
    form.set("n", String(Math.max(1, Number(count || 1))));
    form.set("size", normalizeGenerationSize(size));
    for (const image of referenceImages) {
      form.append(
        "image",
        new Blob([image.buffer], { type: image.contentType || "image/png" }),
        image.filename || "reference.png"
      );
    }

    const response = await fetch(buildImageEditUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVER_CONFIG.imageGeneration.openai.apiKey}`,
      },
      body: form,
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throwServiceError(readImageGenerationError(payload, response.status), response.status >= 400 && response.status < 600 ? response.status : 502);
    }

    const image = await readGeneratedImagePayload(payload);
    if (!image.buffer?.length) {
      throwServiceError("图片生成服务没有返回图片数据", 502);
    }

    await recordProviderCallLog({
      provider: "image-generation", model: SERVER_CONFIG.imageGeneration.openai.model, baseUrl: SERVER_CONFIG.imageGeneration.openai.baseUrl,
      sourceRef: "image-edit", status: "success", startedAt,
    });
    providerCallLogged = true;

    return {
      buffer: image.buffer,
      contentType: image.contentType,
      filename: `${filenamePrefix}-${Date.now()}.png`,
    };
  } catch (error) {
    if (!providerCallLogged) {
      await recordProviderCallLog({
        provider: "image-generation", model: SERVER_CONFIG.imageGeneration.openai.model, baseUrl: SERVER_CONFIG.imageGeneration.openai.baseUrl,
        sourceRef: "image-edit", status: "error", startedAt, error,
      });
    }
    if (error?.name === "AbortError") {
      throwServiceError("图片生成超时，请稍后重试", 504);
    }
    if (error?.statusCode) throw error;
    throwServiceError(error.message || "图片生成失败，请稍后重试", 502);
  } finally {
    clearTimeout(timeout);
  }
}

async function requestVeniceGeneratedImageEdit(prompt, {
  count = SERVER_CONFIG.imageGeneration.openai.count,
  size = SERVER_CONFIG.imageGeneration.openai.size,
  filenamePrefix = "ai-image",
  referenceImages = [],
  veniceSafeMode,
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVER_CONFIG.imageGeneration.openai.timeoutMs);
  const startedAt = Date.now();
  let providerCallLogged = false;

  try {
    const images = referenceImages
      .filter((image) => image?.buffer?.length)
      .map((image) => image.buffer.toString("base64"));
    if (!images.length) throwServiceError("图片编辑缺少参考图", 400);

    const multiple = images.length > 1;
    const editModel = resolveImageEditModel();
    const response = await fetch(buildVeniceImageEditUrl(multiple), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVER_CONFIG.imageGeneration.openai.apiKey}`,
      },
      body: JSON.stringify({
        prompt,
        ...(multiple ? { images } : { image: images[0] }),
        ...(multiple ? { modelId: editModel } : { model: editModel }),
        aspect_ratio: resolveVeniceAspectRatio(size),
        output_format: "png",
        ...(typeof veniceSafeMode === "boolean" ? { safe_mode: veniceSafeMode } : {}),
        ...(VENICE_RESOLUTION_SUPPORT.has(editModel) ? { resolution: "1K" } : {}),
      }),
      signal: controller.signal,
    });

    const payload = await readVeniceImageResponse(response, editModel);
    if (!payload.buffer?.length) {
      throwServiceError("图片编辑服务没有返回图片数据", 502);
    }

    await recordProviderCallLog({
      provider: "image-generation", model: resolveImageEditModel(), baseUrl: SERVER_CONFIG.imageGeneration.openai.baseUrl,
      sourceRef: multiple ? "image-multi-edit" : "image-edit", status: "success", startedAt,
    });
    providerCallLogged = true;

    return {
      buffer: payload.buffer,
      contentType: payload.contentType,
      filename: `${filenamePrefix}-${Date.now()}.png`,
    };
  } catch (error) {
    if (!providerCallLogged) {
      await recordProviderCallLog({
        provider: "image-generation", model: resolveImageEditModel(), baseUrl: SERVER_CONFIG.imageGeneration.openai.baseUrl,
        sourceRef: referenceImages.length > 1 ? "image-multi-edit" : "image-edit", status: "error", startedAt, error,
      });
    }
    if (error?.name === "AbortError") {
      throwServiceError("图片生成超时，请稍后重试", 504);
    }
    if (error?.statusCode) throw error;
    throwServiceError(error.message || "图片生成失败，请稍后重试", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function buildImageEditUrl() {
  return `${SERVER_CONFIG.imageGeneration.openai.baseUrl}${IMAGE_EDITS_PATH}`;
}

function buildVeniceImageEditUrl(multiple = false) {
  const path = multiple ? VENICE_IMAGE_MULTI_EDIT_PATH : VENICE_IMAGE_EDIT_PATH;
  return `${SERVER_CONFIG.imageGeneration.openai.baseUrl}${path}`;
}

function isVeniceImageProvider() {
  try {
    return new URL(SERVER_CONFIG.imageGeneration.openai.baseUrl).hostname.toLowerCase().endsWith("venice.ai");
  } catch {
    return false;
  }
}

function resolveImageEditModel() {
  const configured = String(SERVER_CONFIG.imageGeneration.openai.editModel || "").trim();
  if (configured) return configured;
  const model = String(SERVER_CONFIG.imageGeneration.openai.model || "").trim();
  if (/-edit$/i.test(model)) return model;
  return `${model}-edit`;
}

function resolveVeniceAspectRatio(size = "") {
  const normalized = String(size || "").trim();
  if (!/^\d+x\d+$/.test(normalized)) return "auto";
  const [width, height] = normalized.split("x").map(Number);
  if (!width || !height) return "auto";
  const ratio = width / height;
  if (ratio < 0.7) return "9:16";
  if (ratio < 0.9) return "3:4";
  if (ratio < 1.1) return "1:1";
  if (ratio < 1.5) return "4:3";
  if (ratio < 1.8) return "3:2";
  return "16:9";
}

function veniceImageDiagnostic(response, model) {
  const flag = name => {
    const value = String(response.headers.get(name) || '').trim().toLowerCase();
    return value === 'true' ? true : value === 'false' ? false : null;
  };
  const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const id = String(response.headers.get('x-request-id') || response.headers.get('x-venice-request-id') || '').trim();
  // Explicit response fields only: never serialize headers, response bodies,
  // credentials or account/balance headers into errors and audit records.
  return Object.freeze({ model: String(model || '').slice(0, 100),
    contentType: /^[a-z0-9.+-]{1,40}\/[a-z0-9.+-]{1,40}$/.test(type) ? type : '',
    blurred: flag('x-venice-is-blurred'), violation: flag('x-venice-is-content-violation'),
    requestId: /^[a-z0-9_:-]{1,100}$/i.test(id) && !/sk[-_]|bearer|api.?key|authorization|password|secret|token/i.test(id) ? id : '' });
}

async function readVeniceImageResponse(response, model) {
  const diagnostic = veniceImageDiagnostic(response, model);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = new Error(readImageGenerationError(payload, response.status));
    error.statusCode = response.status >= 400 && response.status < 600 ? response.status : 502;
    error.imageProviderDiagnostic = diagnostic;
    throw error;
  }
  await assertVeniceImageNotBlurred(response, model, diagnostic);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: String(response.headers.get("content-type") || "image/png").split(";")[0].trim().toLowerCase() || "image/png",
  };
}

async function assertVeniceImageNotBlurred(response, model, diagnostic = veniceImageDiagnostic(response, model)) {
  if (diagnostic.blurred === true) {
    await response.arrayBuffer().catch(() => {});
    const error = new Error('图片服务返回了模糊结果，本次图片未完成');
    error.statusCode = 502;
    error.code = 'IMAGE_PROVIDER_BLURRED';
    error.retryable = false;
    error.imageProviderDiagnostic = diagnostic;
    throw error;
  }
}

async function readGeneratedImagePayload(payload) {
  const imageBase64 = String(payload?.data?.[0]?.b64_json || "").trim();
  if (imageBase64) {
    return {
      buffer: Buffer.from(imageBase64, "base64"),
      contentType: "image/png",
    };
  }

  const imageUrl = String(payload?.data?.[0]?.url || "").trim();
  if (!imageUrl) return { buffer: null, contentType: "image/png" };
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throwServiceError("图片生成服务返回的图片下载失败", 502);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: String(response.headers.get("content-type") || "image/png").split(";")[0].trim().toLowerCase() || "image/png",
  };
}

function normalizeGenerationSize(value) {
  const normalized = String(value || "").trim();
  return /^\d+x\d+$/.test(normalized) ? normalized : "1024x1792";
}

function readImageGenerationError(payload, statusCode) {
  const apiMessage = String(payload?.error?.message || payload?.error || payload?.message || "").trim();
  if (apiMessage) return apiMessage;
  if (statusCode === 401) return "图片生成服务认证失败";
  return "图片生成失败，请稍后重试";
}

function throwServiceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
