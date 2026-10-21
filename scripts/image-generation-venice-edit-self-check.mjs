import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

if (!process.env.SELF_CHECK_VENICE_EDIT_MODEL) {
  for (const model of ["seedream-v5-pro-edit", "seedream-v5-lite-edit"]) {
    const result = spawnSync(process.execPath, [process.argv[1]], {
      stdio: "inherit",
      env: { ...process.env, SELF_CHECK_VENICE_EDIT_MODEL: model },
    });
    assert.equal(result.status, 0, `Venice edit contract failed for ${model}`);
  }
  process.exit(0);
}
const editModel = process.env.SELF_CHECK_VENICE_EDIT_MODEL;
process.env.IMAGE_GENERATION_PROVIDER = "openai";
process.env.IMAGE_GENERATION_API_KEY = "test-image-key";
process.env.IMAGE_GENERATION_BASE_URL = "https://api.venice.ai/api/v1";
process.env.IMAGE_GENERATION_MODEL = "seedream-v5-pro";
process.env.IMAGE_GENERATION_EDIT_MODEL = editModel;

// Keep this contract test isolated from the local database log writer and from a real paid request.
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
const { requestGeneratedImage } = await import("../server/image-generation-provider-service.js");

const originalFetch = globalThis.fetch;
const calls = [];
const imageBytes = Buffer.from("reference-image");
let blurred = false;

try {
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    const body = JSON.parse(options.body || "{}");
    calls.push({ path: requestUrl.pathname, body, headers: options.headers || {} });

    if (requestUrl.pathname === "/api/v1/images/generations") {
      return new Response(JSON.stringify({
        data: [{ b64_json: Buffer.from("generated-image").toString("base64") }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (requestUrl.pathname === "/api/v1/image/edit") {
      assert.equal(body.model, editModel);
      assert.equal(body.resolution, editModel === "seedream-v5-pro-edit" ? "1K" : undefined);
      assert.equal(body.image, imageBytes.toString("base64"));
      assert.equal(body.output_format, "png");
      assert.equal(body.aspect_ratio, "9:16");
      return new Response(Buffer.from("edited-image"), { status: 200, headers: { "content-type": "image/png", "x-venice-is-blurred": String(blurred) } });
    }
    if (requestUrl.pathname === "/api/v1/image/multi-edit") {
      assert.equal(body.modelId, editModel);
      assert.equal(body.resolution, editModel === "seedream-v5-pro-edit" ? "1K" : undefined);
      assert.deepEqual(body.images, [imageBytes.toString("base64"), Buffer.from("second-image").toString("base64")]);
      assert.equal(body.output_format, "png");
      return new Response(Buffer.from("multi-edited-image"), { status: 200, headers: { "content-type": "image/png", "x-venice-is-blurred": String(blurred) } });
    }
    throw new Error(`unexpected provider path: ${requestUrl.pathname}`);
  };

  const generated = await requestGeneratedImage("make a photo", { size: "1024x1792" });
  assert.equal(generated.buffer.toString(), "generated-image", "generation endpoint should keep its JSON base64 contract");

  const edited = await requestGeneratedImage("wear the reference outfit", {
    size: "1024x1792",
    referenceImages: [{ buffer: imageBytes, contentType: "image/png", filename: "reference.png" }],
  });
  assert.equal(edited.buffer.toString(), "edited-image", "single Venice edit should read the binary response");
  assert.equal(edited.contentType, "image/png");

  const multiEdited = await requestGeneratedImage("combine the references", {
    size: "1024x1792",
    referenceImages: [
      { buffer: imageBytes, contentType: "image/png", filename: "reference.png" },
      { buffer: Buffer.from("second-image"), contentType: "image/png", filename: "second.png" },
    ],
  });
  assert.equal(multiEdited.buffer.toString(), "multi-edited-image", "multiple Venice references should use multi-edit");
  assert.equal(calls.map((call) => call.path).join(","), "/api/v1/images/generations,/api/v1/image/edit,/api/v1/image/multi-edit");

  blurred = true;
  await assert.rejects(requestGeneratedImage("portrait", {
    referenceImages: [{ buffer: imageBytes, contentType: "image/png", filename: "reference.png" }],
  }), /隐私模糊图/, "blurred output must fail instead of consuming a successful image quota");
  console.log(`venice image edit provider self-check passed: ${editModel}`);
} finally {
  globalThis.fetch = originalFetch;
}
