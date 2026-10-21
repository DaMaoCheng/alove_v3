import { ICONS } from "../../icons/icons.js";

export const ADMIN_NAV = [
  ["overview", ICONS.compass, "概览"],
  ["creatorCharacters", ICONS.spark, "网红角色"],
  ["commonCharacters", ICONS.chat, "通用角色"],
  ["sites", ICONS.shop, "站点管理"],
  ["externalEmbeds", ICONS.compass, "站外嵌入"],
  ["mascot", ICONS.bell, "前台管理"],
  ["carousel", ICONS.star, "首页轮播"],
  ["kitshop", ICONS.shop, "Kitshop 管理"],
  ["promotionCampaigns", ICONS.ticket, "广告活动"],
  ["kb", ICONS.chat, "知识库"],
  ["leads", ICONS.shop, "商家线索（待）"],
  ["codes", ICONS.ticket, "折扣码"],
  ["reporting", ICONS.key || ICONS.ticket, "数据 API"],
  ["payments", ICONS.wallet, "交易支付（待）"],
  ["costs", ICONS.bell, "成本与利润（待）"],
  ["feedback", ICONS.chat, "用户反馈"],
  ["accounts", ICONS.user, "账号管理"],
  ["logs", ICONS.user, "错误日志"],
];

export function titleForAdminView(view) {
  return {
    overview: "概览",
    creatorCharacters: "网红角色",
    commonCharacters: "通用角色",
    sites: "站点管理",
    externalEmbeds: "站外嵌入",
    mascot: "前台管理",
    agents: "AI 角色卡",
    carousel: "首页轮播",
    kitshop: "Kitshop 管理",
    promotionCampaigns: "广告活动",
    kb: "知识库",
    leads: "商家线索（待）",
    codes: "折扣码",
    reporting: "数据 API",
    payments: "交易支付（待）",
    costs: "成本与利润设置（待）",
    feedback: "用户反馈",
    accounts: "账号管理",
    logs: "错误日志",
  }[view] || "账户概览";
}
