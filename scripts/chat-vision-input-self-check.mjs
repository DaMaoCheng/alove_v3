import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { CHAT_ATTACHMENT_UPLOAD_POLICY } from "../server/upload-policies.js";
import { collectVisionInputsForMessages } from "../server/chat-vision-input-service.js";

const fileName = "chat-vision-self-check.png";
const filePath = join(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, fileName);

await mkdir(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, { recursive: true });
await writeFile(filePath, await sharp({
  create: {
    width: 16,
    height: 16,
    channels: 3,
    background: "#0f6",
  },
}).png().toBuffer());

try {
  const inputs = await collectVisionInputsForMessages([{
    content_type: "attachment",
    product_payload_json: JSON.stringify({
      kind: "image",
      name: "badge.png",
      storedName: fileName,
      url: `/api/uploads/chat/${fileName}`,
      mimeType: "image/png",
    }),
  }]);
  assert.equal(inputs.length, 1, "one image attachment should become one vision input");
  assert.equal(inputs[0].mimeType, "image/jpeg", "vision input should be normalized to jpeg");
  assert.match(inputs[0].dataUrl, /^data:image\/jpeg;base64,/, "vision input should be a data URL");
} finally {
  await rm(filePath, { force: true });
}

runProviderModeCheck("responses");
runProviderModeCheck("chat_completions");

console.log("chat vision input self-check passed");

function runProviderModeCheck(apiMode) {
  const code = `
    import assert from "node:assert/strict";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "https://vision.example.test/v1";
    process.env.OPENAI_MODEL = "test-model";
    process.env.OPENAI_API_MODE = "${apiMode}";
    let body = null;
    globalThis.fetch = async (url, options = {}) => {
      body = JSON.parse(String(options.body || "{}"));
      return {
        ok: true,
        status: 200,
        async json() {
          return ${apiMode === "responses"
            ? "{ output_text: 'ok' }"
            : "{ choices: [{ message: { content: 'ok' } }] }"};
        },
      };
    };
    const { requestOpenAiReply } = await import("./server/ai-reply-provider-service.js");
    await requestOpenAiReply({
      systemPrompt: "system",
      messages: [{ role: "user", content: "look this pic" }],
      visionInputs: [{ dataUrl: "data:image/jpeg;base64,abc", mimeType: "image/jpeg", name: "badge.jpg" }],
    });
    if ("${apiMode}" === "responses") {
      assert.equal(body.input[0].content[0].type, "input_text");
      assert.equal(body.input[0].content[1].type, "input_image");
      assert.equal(body.input[0].content[1].image_url, "data:image/jpeg;base64,abc");
    } else {
      assert.equal(body.messages[1].content[0].type, "text");
      assert.equal(body.messages[1].content[1].type, "image_url");
      assert.equal(body.messages[1].content[1].image_url.url, "data:image/jpeg;base64,abc");
    }
  `;
  execFileSync(process.execPath, ["--input-type=module"], {
    cwd: process.cwd(),
    input: code,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

const { collectGuestInspectionVisionInputs } = await import('../server/chat-vision-input-service.js');
let historyReads=0, imageReads=0;
const db={execute:async(sql,params)=>{
 historyReads++;
 assert(sql.includes('s.guest_session_id = ?') && sql.includes("m.sender_type = 'user'") && sql.includes('LIMIT 1'));
 assert.deepEqual(params,['session','guest','character',20,100]);
 return [[{product_payload_json:JSON.stringify({kind:'image',storedName:'owned-image.webp'})}]];
}};
const args={sessionId:'session',guestSessionId:'guest',characterId:'character',beforeDisplayOrder:100,
 recentMessages:[{senderType:'user',displayOrder:20},{senderType:'character',displayOrder:30}],
 jevDecision:{ok:true,imageIntent:'image_inspection'},collect:async(images)=>{imageReads++;return images;}};
assert.equal((await collectGuestInspectionVisionInputs(db,args))[0].storedName,'owned-image.webp');
for (const patch of [{jevDecision:{ok:true,imageIntent:'none'}},{jevDecision:{ok:false,imageIntent:'image_inspection'}},
 {sessionId:''},{guestSessionId:''},{characterId:''},{beforeDisplayOrder:0},{recentMessages:[]}])
 assert.deepEqual(await collectGuestInspectionVisionInputs(db,{...args,...patch}),[]);
assert.equal(historyReads,1);assert.equal(imageReads,1);
console.log('Guest inspection history is same-session owned, recent, USER-only and explicitly inspection-gated');
