import assert from "node:assert/strict";
import { adminGuestSessionsHtml } from "../src/features/admin-console/admin-guest-sessions-template.js";

const guest = {
  id: "guest_continuity_check", displayId: "CHECK", siteName: "CF", characterName: "Valeria",
  status: "active", statusLabel: "活跃中", imageEntitlementStatus: "available", userMessageCount: 5,
  sourcePageTitle: "Product", sourcePageUrl: "https://shop.example.test/product/1",
};
const render = (item, open = true) => adminGuestSessionsHtml({ items: [item], openId: open ? item.id : "" });
const historical = render(guest);
assert.ok(historical.includes("未记录（历史数据不追溯归并）"));
assert.ok(historical.includes("暂无足够关联证据"));
assert.ok(historical.includes("https://shop.example.test/product/1"));
assert.ok(historical.includes('data-guest-session-conversation="guest_continuity_check"'));
const enriched = {
  ...guest,
  visitorContinuity: {
    visitorId: "visitor_safe", sessionCount: 2, firstSeenAt: "2026-09-18T01:00:00Z",
    lastSeenAt: "2026-09-18T02:00:00Z", lastOutcome: "created", lastReason: "guest_cookie_missing",
    linkedGuestIds: ["guest_a", "guest_b"],
  },
  continuityCandidates: [{ guestId: "guest_other", evidence: ["时间接近", "相同来源页面"] }],
};
const expanded = render(enriched);
assert.ok(expanded.includes("同一浏览器标记，不代表同一个人"));
assert.ok(expanded.includes("无法据此判断是否无痕"));
assert.ok(expanded.includes("guest_a、guest_b"));
assert.ok(expanded.includes("guest_other：时间接近、相同来源页面"));
assert.equal(render(enriched, false), render(guest, false), "collapsed table must be unchanged by continuity data");
const unsafe = render({
  ...guest, visitorContinuity: { visitorId: '<img src=x onerror="alert(1)">', linkedGuestIds: ['<script>bad</script>'] },
  continuityCandidates: [{ guestId: "<script>", evidence: ["<img>"] }],
});
assert.ok(!unsafe.includes("<script>"));
assert.ok(!unsafe.includes("<img src=x"));
assert.ok(unsafe.includes("&lt;script&gt;"));
assert.ok(!render({ ...guest, visitorContinuity: enriched.visitorContinuity, continuityCandidates: Array.from({length: 6}, (_, i) => ({ guestId: `candidate_${i}`, evidence: [] })) }).includes("candidate_3"));
for (const [reason, expected] of [
  ["guest_expired", "原游客会话已过期"],
  ["guest_site_mismatch", "游客凭证与当前站点不匹配"],
  ["guest_site_disabled", "站点当前未开放游客聊天"],
  ["guest_unrecognized", "游客凭证未匹配到记录"],
]) {
  const html = render({ ...guest, visitorContinuity: { ...enriched.visitorContinuity, lastOutcome: "invalid", lastReason: reason } });
  assert.ok(html.includes(expected));
  assert.ok(html.includes("游客凭证不可用"));
}
const boundedLinks = render({ ...guest, visitorContinuity: { ...enriched.visitorContinuity,
  linkedGuestIds: Array.from({ length: 25 }, (_, index) => `bounded_guest_${index}`),
} });
assert.ok(boundedLinks.includes("bounded_guest_19"));
assert.ok(!boundedLinks.includes("bounded_guest_20"));
assert.ok(render({ ...guest, visitorContinuity: { ...enriched.visitorContinuity, lastReason: "unexpected_reason" } }).includes("未记录"));
assert.ok(expanded.includes("最近来源页面和 IP 不一定代表首次进入时的信息"));
console.log("admin guest continuity template self-check passed");
