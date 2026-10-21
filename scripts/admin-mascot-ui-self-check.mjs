import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  adminMascotHtml,
  mascotAdModalHtml,
  mascotEditorModalHtml,
} from "../src/features/admin-console/admin-console-mascot-template.js";
import { applySuccessfulMascotAdDelivery } from "../src/features/admin-console/admin-mascot-controller.js";

const knowledgeBases = [
  { id: "kb_customer_service", label: "客服话术知识库", scope: "global" },
  { id: "kb_football", label: "足球知识库", scope: "site", siteIds: ["site_global"] },
  { id: "kb_template", label: "模板专属知识库", scope: "targeted", characterIds: ["mascot_template"] },
];

const mascotControllerSource = readFileSync(new URL("../src/features/admin-console/admin-mascot-controller.js", import.meta.url), "utf8");
const mascotAdPreviewSource = readFileSync(new URL("../src/features/admin-console/admin-mascot-ad-preview.js", import.meta.url), "utf8");
const mascotGreetingGallerySource = readFileSync(new URL("../src/features/admin-console/admin-mascot-greeting-image-controls.js", import.meta.url), "utf8");
const attachmentPreviewSource = readFileSync(new URL("../src/features/chat/chat-attachment-preview.js", import.meta.url), "utf8");
const chatImageMessageSource = readFileSync(new URL("../src/features/chat/chat-image-message.js", import.meta.url), "utf8");
const accountConversationTemplateSource = readFileSync(new URL("../src/features/admin-console/admin-console-accounts-template.js", import.meta.url), "utf8");

const template = {
  id: "mascot_template",
  name: "Kit",
  avatarUrl: "assets/kit.png",
  tone: "Template persona should only appear in editor.",
  personaPrompt: "Template persona should only appear in editor.",
  speakingStyle: "Warm and concise.",
  greeting: "Hello",
  cta: "Shop now",
    knowledge: ["kb_customer_service", "legacy plain text"],
  source: "通用模板",
};

const sites = [
  {
    id: "site_global",
    name: "Global",
    slug: "global",
    defaultLanguage: "English",
    mascotCharacterId: "mascot_global",
    productApiUrl: "",
    userCount: 8,
    sentAdCount: 2,
    mascot: {
      id: "mascot_global",
      name: "Kit Global",
      avatarUrl: "assets/kit-global.png",
      tone: "Site persona should only appear in editor.",
      personaPrompt: "Site persona should only appear in editor.",
      speakingStyle: "Site speaking style should only appear in editor.",
      greeting: "Hi",
      cta: "See drops",
      knowledge: ["kb_football"],
      source: "Global覆盖",
    },
  },
  {
    id: "site_inherited",
    name: "Inherited Site",
    slug: "inherited",
    defaultLanguage: "English",
    mascotCharacterId: "mascot_template",
    productApiUrl: "",
    userCount: 0,
    sentAdCount: 0,
    mascot: { ...template, source: "通用模板" },
  },
];

const pageHtml = adminMascotHtml({ template, sites, knowledgeBases, loading: false });
const pageWithUnboundHtml = adminMascotHtml({
  template,
  sites,
  unboundMascots: [{ id: "mascot_unbound", name: "Unbound Mascot", avatarUrl: "", knowledge: [], source: "未绑定" }],
  knowledgeBases,
  loading: false,
});
assert.ok(pageHtml.includes("admin-mascot-table"), "site-specific mascot section should render as a table");
assert.ok(!pageHtml.includes("msite-grid"), "site-specific mascot section should not render card grid");
assert.ok(!pageHtml.includes("msite-card"), "site-specific mascot section should not render site cards");
assert.ok(!pageHtml.includes("data-mascot-product-api"), "mascot page should not expose product API edit button");
assert.ok(!pageHtml.includes("data-mascot-product-form"), "mascot page should not expose product API form");
assert.ok(!pageHtml.includes("mas-tone"), "outer cards should not render persona/tone node");
assert.ok(!pageHtml.includes("形象、人设、知识库"), "outer hint should not mention persona");
assert.ok(!pageHtml.includes("看板娘形象 / 人设"), "outer site card heading should not mention persona");
assert.ok(!pageHtml.includes("促销 CTA"), "outer cards should not render promotion CTA field");
assert.ok(!pageHtml.includes("货币符号"), "outer cards should not render currency field");
assert.ok(pageHtml.includes("客服话术知识库"), "outer template should map KB IDs to labels");
assert.ok(pageHtml.includes("足球知识库"), "outer site card should map KB IDs to labels");
assert.ok(pageHtml.includes("模板专属知识库"), "outer template should render targeted KB labels");
assert.ok(!pageHtml.includes("Inherited Site"), "site rows inheriting the template should not render in site-specific section");
assert.ok(!pageHtml.includes("legacy plain text"), "legacy text knowledge should not appear in mascot KB display");
assert.ok(pageWithUnboundHtml.includes("Unbound Mascot"), "unbound mascots should render in mascot table after creation");
assert.ok(pageWithUnboundHtml.includes("未绑定站点"), "unbound mascots should show unbound site label");
assert.ok(pageWithUnboundHtml.includes('data-mascot-edit-unbound="mascot_unbound"'), "unbound mascots should render an edit action");
const emptyKnowledgeHtml = adminMascotHtml({ template: { ...template, knowledge: [] }, sites: [], knowledgeBases: [], loading: false });
assert.ok(emptyKnowledgeHtml.includes("muted-dash"), "empty knowledge should render dash");

const templateModal = mascotEditorModalHtml({ mascot: template, mode: "template", knowledgeBases });
assert.ok(!templateModal.includes("商品库 API"), "editor should not render product API field");
assert.ok(!templateModal.includes("data-mascot-product-form"), "editor should not render product API form");
assert.ok(templateModal.includes("人设"), "editor should render the editable persona field");
assert.ok(templateModal.includes("语气"), "editor should render the editable speaking-style field");
assert.ok(templateModal.includes('name="personaPrompt"'), "editor should submit personaPrompt directly to the mascot character");
assert.ok(templateModal.includes('name="speakingStyle"'), "editor should submit speakingStyle directly to the mascot character");
assert.ok(!templateModal.includes('name="tone"'), "editor should not submit the legacy tone field");
assert.ok(!templateModal.includes("促销 CTA"), "editor should not render promotion CTA field");
assert.ok(!templateModal.includes("货币符号"), "editor should not render currency field");
assert.ok(!templateModal.includes('name="currency"'), "editor should not submit currency field");
assert.match(templateModal, /character-id-tag[\s\S]*mascot_template/, "editor should show character ID tag");
assert.ok(templateModal.includes('type="hidden" name="characterId"'), "editor should submit characterId as hidden input");
assert.ok(templateModal.includes("data-character-avatar-upload"), "editor should render avatar upload button");
assert.ok(templateModal.includes("data-mascot-avatar-generate"), "template editor should render AI avatar generation button");
assert.ok(templateModal.includes("data-character-avatar-remove"), "editor should render avatar remove button");
assert.ok(templateModal.includes("data-character-avatar-value"), "editor should submit avatarUrl through hidden avatar control");
assert.ok(templateModal.includes("data-mascot-greeting-gallery"), "saved mascot editor should render the greeting material gallery");
assert.ok(templateModal.includes("问候素材库"), "saved mascot editor should label the gallery as greeting materials");
assert.ok(!templateModal.includes("首次进入新对话时，会从已就绪图片中随机发送"), "greeting gallery should not render an explanatory annotation");
assert.ok(!templateModal.includes("头像地址"), "editor should not render avatar URL field label");
assert.ok(!templateModal.includes("<span>角色 ID</span>"), "editor should not render visible character ID field");
assert.ok(!templateModal.includes('name="siteId"'), "template editor should not render bound site select");
assert.ok(!templateModal.includes("data-mascot-kb-select"), "editor should not render mascot knowledge selector");
assert.ok(!templateModal.includes("data-mascot-kb-option"), "editor should not render KB options");
assert.ok(templateModal.includes("mascot-kb-readonly"), "editor should render knowledge as readonly tags");
assert.ok(templateModal.includes("绑定/解绑请到知识库页面修改"), "editor should guide binding edits to knowledge page");
assert.ok(templateModal.includes('name="knowledgeText"'), "editor should keep hidden knowledgeText for save compatibility");
assert.ok(!templateModal.includes('textarea name="knowledgeText"'), "editor should not render raw knowledge textarea");

const siteModal = mascotEditorModalHtml({ mascot: sites[0].mascot, site: sites[0], sites, mode: "site", knowledgeBases });
assert.ok(siteModal.includes('name="siteId"'), "site editor should render bound site select");
assert.ok(siteModal.includes("mascot-site-dd"), "site editor should use shared dropdown for bound site");
assert.match(siteModal, /character-id-tag[\s\S]*mascot_global/, "site editor should show site mascot character ID tag");

const unboundModal = mascotEditorModalHtml({ mascot: { id: "mascot_unbound", name: "Unbound Mascot", avatarUrl: "", personaPrompt: "Unbound persona", speakingStyle: "Unbound speaking", greeting: "Hi", knowledge: [] }, site: null, sites, mode: "unbound", knowledgeBases });
assert.ok(unboundModal.includes("编辑未绑定前台"), "unbound editor should use unbound title");
assert.match(unboundModal, /character-id-tag[\s\S]*mascot_unbound/, "unbound editor should show mascot ID tag");
assert.ok(unboundModal.includes('name="siteId"'), "unbound editor should render bound site select");
assert.ok(unboundModal.includes("不绑定站点"), "unbound editor should allow staying unbound");

const newSiteModal = mascotEditorModalHtml({ mascot: {}, site: null, sites, mode: "site-new", knowledgeBases });
assert.ok(newSiteModal.includes("新建前台"), "new site mascot editor should use create title");
assert.ok(newSiteModal.includes("data-mascot-avatar-generate"), "new site mascot editor should render AI avatar generation button");
assert.ok(newSiteModal.includes('name="siteId"'), "new site mascot editor should render bound site select");
assert.ok(newSiteModal.includes('name="siteId" value=""'), "new site mascot editor should not preselect a bound site");
assert.ok(!newSiteModal.includes("character-id-tag"), "new site mascot editor should not render an ID tag before save");
assert.ok(newSiteModal.includes('name="characterId" value=""'), "new site mascot editor should not submit a pre-generated character ID");
assert.ok(newSiteModal.includes("不绑定站点"), "new site mascot editor should allow no bound site");
assert.ok(!newSiteModal.includes('value="Kit"'), "new site mascot editor should not prefill template name");
assert.ok(!newSiteModal.includes("Template persona should only appear in editor."), "new site mascot editor should not prefill persona");
assert.ok(!newSiteModal.includes("Hello</textarea>"), "new site mascot editor should not prefill greeting");
assert.ok(!newSiteModal.includes("assets/kit.png"), "new site mascot editor should not prefill avatar");
assert.ok(!newSiteModal.includes("mascot-kb-current-tags"), "new site mascot editor should not preselect knowledge bases");
assert.ok(newSiteModal.includes("mascot-kb-readonly"), "new site mascot editor should render readonly knowledge block");

const adModal = mascotAdModalHtml(sites[0], { campaigns: [{ id: "campaign_live", title: "周末球衣促销", endsAt: "2026-07-20T00:00:00.000Z" }] });
assert.ok(adModal.includes("发送广告"), "ad modal should use the send-ad title");
assert.match(adModal, /mascot-ad-heading-meta[\s\S]*Global[\s\S]*8 人/, "ad modal heading should show the real site name and reachable user count");
assert.ok(adModal.includes("mascot-ad-campaign-dd"), "ad modal should use the shared dropdown for campaigns");
assert.ok(adModal.includes('name="campaignId"'), "ad modal should submit a campaign selection instead of a free-text title");
assert.ok(adModal.includes('value="campaign_live"'), "ad modal should render campaigns returned by the backend");
assert.ok(adModal.includes("周末球衣促销（7月20日结束）"), "ad modal should render the real campaign title and end date");
assert.ok(!adModal.includes('name="title"'), "ad modal should not keep the old free-text ad title field");
assert.ok(adModal.includes("data-mascot-ad-progress"), "ad modal should reserve inline sending progress beside the action");
assert.ok(adModal.includes("data-mascot-ad-result"), "ad modal should reserve the completed success and failure result");
assert.ok(adModal.includes("data-mascot-ad-failure-help"), "ad modal should reserve a circular failure-reason help control");
assert.ok(adModal.includes('role="tooltip"'), "failure-reason detail should expose an accessible tooltip");
assert.ok(pageHtml.includes("data-mascot-sent-ad-count"), "site rows should expose the sent-ad count cell for immediate completion updates");
assert.ok(!adModal.includes("演示触达人数"), "ad modal should not render the standalone mock audience note");
assert.ok(!adModal.includes("前端效果预览"), "ad modal should not render the frontend preview note");
assert.match(adModal, /data-mascot-ad-close[\s\S]*data-mascot-ad-progress[\s\S]*data-mascot-ad-result/, "ad progress and result should render after the close button");
assert.match(mascotControllerSource, /listAdminMascotCampaigns/, "ad modal should load real eligible campaigns for the selected site");
assert.match(mascotAdPreviewSource, /createAdminMascotAdDelivery/, "ad submit should create a real background delivery");
assert.match(mascotAdPreviewSource, /getAdminMascotAdDelivery/, "ad modal should poll the real delivery status");
assert.match(mascotAdPreviewSource, /mascotAdState = "sending"/, "ad preview should expose the sending state");
assert.match(mascotAdPreviewSource, /mascotAdState = "completed"/, "ad preview should expose the completed state");
assert.match(mascotAdPreviewSource, /window\.clearTimeout\(pollTimer\)/, "ad modal should stop polling when closed");
assert.match(mascotAdPreviewSource, /MAX_POLL_FAILURES/, "ad polling should stop after a bounded number of transient failures");
assert.match(mascotAdPreviewSource, /status === 0 \|\| status >= 500/, "only network and server failures should retry polling");
assert.match(mascotAdPreviewSource, /renderPollFailure/, "terminal poll errors should render a visible state in the modal");
assert.match(mascotAdPreviewSource, /failureReasons/, "completed delivery should render public failure-reason details");
assert.match(mascotAdPreviewSource, /onDeliveryCompleted/, "completed delivery should notify the mascot table controller");
assert.doesNotMatch(mascotAdPreviewSource, /PREVIEW_STEPS|PREVIEW_SUCCESS|982/, "ad modal should not retain mock progress or result values");
assert.match(mascotControllerSource, /adModalRequestToken/, "late campaign responses should be scoped to the active modal request");
assert.match(mascotControllerSource, /currentHost === loadingHost/, "late campaign responses should not replace a newer modal instance");
assert.match(mascotControllerSource, /countedDeliveryIds/, "a completed delivery should increment the current sent-ad count at most once");
assert.match(mascotControllerSource, /data-mascot-sent-ad-count/, "successful completion should update the visible sent-ad count without a page refresh");
assert.match(mascotControllerSource, /bindAdminMascotGreetingImageControls\(host\)/, "mascot modal should bind greeting image gallery controls");
assert.match(mascotGreetingGallerySource, /bindChatAttachmentPreview\(gallery\)/, "gallery thumbnails should reuse the existing media preview dialog");
assert.match(mascotGreetingGallerySource, /data-video-url/, "the fifth greeting slot should open as a video preview");
assert.match(mascotGreetingGallerySource, /VIDEO_SLOT = 5/, "the fifth greeting slot should be reserved for video");
assert.match(mascotGreetingGallerySource, /\.mp4,video\/mp4/, "the fifth greeting slot should only accept MP4 video");
assert.match(mascotGreetingGallerySource, /\.jpg,.jpeg,.jfif,.png,.webp/, "the first four greeting slots should keep image upload types");
assert.match(mascotGreetingGallerySource, /mascot-greeting-gallery-empty[\s\S]*data-mascot-greeting-action="upload"/, "empty gallery slots should open the upload picker directly");
assert.doesNotMatch(mascotGreetingGallerySource, /generateAdminMascotGreetingImage|AI 生成/, "greeting gallery should not expose AI generation controls");
assert.match(attachmentPreviewSource, /dataset\.videoUrl[\s\S]*<video/, "the shared attachment preview should support greeting video playback");
assert.match(chatImageMessageSource, /image\.mediaType === "video"[\s\S]*<video/, "chat messages should render greeting video as video");
assert.match(accountConversationTemplateSource, /image\.mediaType === "video"[\s\S]*<video/, "admin conversation details should render greeting video as video");

const countedDeliveryIds = new Set();
const zeroSuccess = applySuccessfulMascotAdDelivery(sites, countedDeliveryIds, { id: "delivery_zero", siteId: "site_global", status: "completed", sent: 0 });
assert.equal(zeroSuccess.updated, false, "a zero-success terminal delivery must not increment the sent-ad count");
const partialFailure = applySuccessfulMascotAdDelivery(sites, countedDeliveryIds, { id: "delivery_partial", siteId: "site_global", status: "failed", sent: 1 });
assert.equal(partialFailure.updated, true, "a failed terminal delivery with at least one success should increment the sent-ad count");
assert.equal(partialFailure.sentAdCount, 3, "a successful terminal delivery should increment the existing count exactly once");
const repeatedTerminal = applySuccessfulMascotAdDelivery(partialFailure.sites, countedDeliveryIds, { id: "delivery_partial", siteId: "site_global", status: "failed", sent: 1 });
assert.equal(repeatedTerminal.updated, false, "repeated terminal polling must not increment the same delivery twice");

console.log(JSON.stringify({
  ok: true,
  checked: "admin mascot UI template",
}, null, 2));
