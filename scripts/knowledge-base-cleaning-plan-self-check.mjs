import { readFileSync } from "node:fs";

const customer = readFileSync("docs/knowledge-base/customer-service-cleaning-plan.md", "utf8");
const football = readFileSync("docs/knowledge-base/football-cleaning-plan.md", "utf8");

for (const text of [
  "客服话术与跨境售后知识库",
  "删除或改写",
  "高品质仿制品/官方授权正品",
  "物流时效与追踪",
  "退换货与退款",
  "多平台话术适配",
]) {
  assertIncludes(customer, text, `customer ${text}`);
}

for (const text of [
  "足球百科、球衣文化与球迷语言知识库",
  "重复章节",
  "8.3 Puma",
  "足球基础规则与近期规则更新",
  "现代战术与数据指标",
  "2026 世界杯",
  "欧冠",
  "球迷俚语与助威口号",
]) {
  assertIncludes(football, text, `football ${text}`);
}

console.log("knowledge base cleaning plan self-check passed");

function assertIncludes(content, text, label) {
  if (!content.includes(text)) {
    throw new Error(`Missing ${label}`);
  }
}
