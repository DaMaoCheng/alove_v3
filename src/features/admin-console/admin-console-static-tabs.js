import { ICONS } from "../../icons/icons.js";

export { adminKnowledgeBaseHtml, adminKnowledgeEditorHtml, adminKnowledgeTableHtml } from "./admin-knowledge-template.js";

export function adminLeadsHtml() {
  const leads = [
    ["Aurum Holdings", "球衣供应商", "高意向", "$12,000", "6月3日"],
    ["Velocity Sports", "零售伙伴", "中意向", "$4,500", "6月2日"],
    ["StadiumWear Co", "批发", "高意向", "$22,800", "6月1日"],
    ["Pitchside Media", "赞助", "低意向", "-", "5月30日"],
    ["GoldBoot Apparel", "球衣供应商", "中意向", "$8,200", "5月28日"],
  ];
  const tone = (status) => status === "高意向" ? "on" : status === "中意向" ? "mid" : "off";
  return `
    <div class="admin-body">
      <div class="admin-actions"><div class="seg"><button class="active">全部</button><button>高意向</button><button>中意向</button><button>低意向</button></div><button class="btn btn-primary sm">${ICONS.plus} 添加线索</button></div>
      <div class="panel"><div class="data-table leads">
        <div class="dt-head"><span>公司</span><span>类型</span><span>意向</span><span>交易额</span><span>添加时间</span><span></span></div>
        ${leads.map(([company, type, status, value, date]) => `<div class="dt-row"><span class="dt-cell name">${company}</span><span>${type}</span><span><i class="pill ${tone(status)}">${status}</i></span><span class="dt-rev">${value}</span><span>${date}</span><span class="dt-act"><a>查看</a></span></div>`).join("")}
      </div></div>
    </div>
  `;
}

export function adminPaymentsHtml() {
  const txns = [["#A8421", "footyfan", "Legends Kit 25/26", "$59.00", "已付款"], ["#A8420", "ultra_dani", "充值 · 275 积分", "$25.00", "已付款"], ["#A8419", "tactic_joe", "Legends Kit 25/26", "$59.00", "已退款"], ["#A8418", "keeper_99", "Pro 会员", "$9.00", "已付款"]];
  return `<div class="admin-body"><div class="kpi-row"><div class="kpi"><div class="kpi-k">总流水 (本月)</div><div class="kpi-v">$48,920</div><div class="kpi-d up">▲ +19.4%</div></div><div class="kpi"><div class="kpi-k">退款率</div><div class="kpi-v">2.1%</div><div class="kpi-d up">▼ -0.3%</div></div><div class="kpi"><div class="kpi-k">客单价</div><div class="kpi-v">$41.20</div><div class="kpi-d up">▲ +3.1%</div></div></div><div class="panel"><div class="data-table pay"><div class="dt-head"><span>订单号</span><span>用户</span><span>商品</span><span>金额</span><span>状态</span></div>${txns.map(([order, user, item, amount, status]) => `<div class="dt-row"><span class="dt-cell"><b>${order}</b></span><span>${user}</span><span>${item}</span><span class="dt-rev">${amount}</span><span><i class="pill ${status === "已付款" ? "on" : "off"}">${status}</i></span></div>`).join("")}</div></div></div>`;
}

export function adminCostsHtml() {
  return `
    <div class="admin-body">
      <div class="admin-cols">
        <div class="panel">
          <div class="panel-head"><h3>单次对话 AI 成本上限</h3></div>
          <div class="cost-field"><label>每次对话 Token 预算</label><div class="cost-input"><input value="$0.04" /></div></div>
          <div class="cost-field"><label>每日花费上限</label><div class="cost-input"><input value="$320" /></div></div>
          <div class="cost-field"><label>止损：ROAS 低于此值暂停投放</label><div class="cost-input"><input value="1.8" /></div></div>
          <button class="btn btn-primary sm">保存设置</button>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>球衣利润</h3></div>
          <div class="margin-row"><span>平均球衣售价</span><b>$59.00</b></div>
          <div class="margin-row"><span>成本 + 运费</span><b>$28.40</b></div>
          <div class="margin-row"><span>折扣 (平均)</span><b>-$11.80</b></div>
          <div class="margin-row total"><span>净利润</span><b class="pos">$18.80 · 32%</b></div>
        </div>
      </div>
    </div>
  `;
}
