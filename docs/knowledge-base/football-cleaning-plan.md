# 足球知识库入库前清洗目录

## 来源
- 主源：`/Users/cheng/Documents/足球知识库_KB_Football.md`
- 表格版：`/Users/cheng/Documents/足球知识库_KB_Football.xlsx`
- 补充来源：本轮搜索的 IFAB、Premier League、UEFA、FIFA Training Centre、Britannica 等公开资料。
- 本轮不落库，不改原文件。

## 定位
用于足球角色和看板娘的足球常识、球队文化、球衣文化、球星档案、赛事背景和球迷语言。它不是客服 SOP 库，尺码、物流、退换货应优先走客服话术知识库。

## 入库建议
- 知识库 ID：`kb_football`
- 知识库名称：`足球百科、球衣文化与球迷语言知识库`
- 适用范围：全站通用
- 优先级：中高
- 推荐绑定对象：足球聊天角色、creator 角色、看板娘
- 主要语言：中文组织，保留英文、西语、葡语、法语、意语、德语、阿语、土语术语

## 原文清洗问题

### 重复章节
需要合并，避免检索时重复召回：
- `4. 球衣工艺术语对照表` 与 `11. 附录：球衣工艺术语对照表（9 语种）`
- `5. 正品鉴定术语` 与 `12. 正品鉴定术语详解`
- `6. 球迷俚语与助威口号` 与 `13. 球迷俚语 & 助威口号（7 语种）`

处理建议：保留更完整的版本作为正文，另一个版本只提取差异补入，不重复入库。

### 编号问题
- `8.3 Puma（彪马）` 出现两次。

处理建议：保留第一处为 `8.3 Puma`，后一处根据内容改为正确编号或合并。

### 高风险内容
- 正品鉴定章节中包含“仿品”“赝品”等内容。可以保留为鉴别知识，但 AI 不应指导用户规避平台、制作仿品或宣称店铺商品状态。
- 德比、极端球迷、政治/宗教背景内容要谨慎输出，避免煽动、攻击或刻板化。

## 建议入库章节

### 01 足球基础规则与近期规则更新
来源：本轮补充搜索，原文缺少系统规则章节。

建议摘要：提供比赛时间、进球、越位、犯规、黄牌、红牌、点球、任意球、角球、界外球、VAR 等基础规则说明，并补充 2025/26 IFAB 与英超 VAR 现场解释趋势。

关键内容：
- 足球比赛通常每队 11 人，常规时间 90 分钟，分上下半场。
- VAR 用于辅助重大判罚，不替代主裁；具体使用范围由赛事规则决定。
- IFAB 是足球竞赛规则权威来源。
- 2025/26 英超观众可听到裁判对部分 VAR 结果作现场广播解释，事实性越位/不越位除外。

精准关键词：`football rules, soccer rules, IFAB, VAR, offside, penalty, red card, yellow card, free kick, corner kick`

参考来源：
- `https://www.theifab.com/law-changes/latest/`
- `https://www.premierleague.com/en/news/4373884/whats-new-in-2025-26-season-ifab-laws-and-premier-league-football-principles`

### 02 世界杯、欧冠与主要赛事结构
来源章节：`7. 联赛与赛事`，补充 2026 世界杯和欧冠新赛制。

建议摘要：解释世界杯、欧冠、欧联、欧会杯、美洲杯、欧洲杯、非洲杯、亚洲杯、国内杯赛的基本结构、主办方、奖杯、球衣 Patch。

补充内容：
- 2026 世界杯为 48 队，12 个四队小组；每组前 2 名和 8 个最好小组第三晋级 32 强。
- 欧冠已采用 36 队联赛阶段，不是传统 32 队小组赛。

精准关键词：`World Cup, FIFA World Cup 2026, Champions League, UEFA, league phase, Euro, Copa America, AFCON, Asian Cup, cup patch`

参考来源：
- `https://www.uefa.com/uefachampionsleague/news/0296-1d21e9bdf7e4-808a7511165c-1000--2025-26-champions-league-teams-format-dates-draws-final/`
- `https://www.olympics.com/en/news/fifa-world-cup-2026-schedule-results-scores-standings-list`

### 03 现代战术与数据指标
来源：本轮补充搜索，原文缺少系统战术/数据章节。

建议摘要：解释现代足球聊天常见术语，包括高位逼抢、低位防守、内收边后卫、伪九号、半空间、反击、xG、xA、PPDA、Field Tilt 等。

关键内容：
- 内收边后卫：边后卫在己方控球时进入中路，帮助中场出球和形成中路人数优势。
- 高位逼抢：在前场压迫对手，争取快速夺回球权。
- xG：衡量射门机会质量，不等于实际进球。
- PPDA：常用于衡量防守压迫强度，数值越低通常代表压迫越积极。
- Field Tilt：衡量比赛主要发生区域，不等于谁一定踢得更好。

精准关键词：`pressing, low block, inverted full-back, false nine, half-space, counter attack, xG, xA, PPDA, field tilt`

参考来源：
- `https://www.fifatrainingcentre.com/en/game/tournaments/fcwc/2025/team-analyses/emerging-positioning-of-the-inverted-full-back.php`
- `https://www.fourfourtwo.com/features/the-inverted-full-back-football-tactics-explained`
- `https://www.nytimes.com/athletic/2730755/2021/07/28/the-athletics-football-analytics-glossary-explaining-xg-ppda-field-tilt-and-how-to-use-them/`

### 04 顶级俱乐部档案
来源章节：`1. 顶级俱乐部档案`

建议摘要：覆盖西甲、英超、意甲、德甲、法甲、葡超、巴甲、阿甲、土超、中东等主要俱乐部，包含建队年份、绰号、主场、传统主色、死敌、经典球衣、传奇球星、球迷组织。

精准关键词：`Real Madrid, Barcelona, Manchester United, Liverpool, Juventus, AC Milan, Inter Milan, PSG, Boca Juniors, River Plate, club nickname, home kit`

清洗建议：俱乐部历史战绩和容量等数据容易变化，建议作为“背景信息”，回答时避免强确定性最新断言。

### 05 国家队档案
来源章节：`2. 国家队档案`

建议摘要：覆盖巴西、阿根廷、德国、法国、意大利、西班牙、葡萄牙、荷兰、英格兰、比利时、乌拉圭、墨西哥、摩洛哥、沙特、日本、韩国等国家队资料。

精准关键词：`Brazil, Argentina, Germany, France, Italy, Spain, Portugal, England, Mexico, Morocco, national team, Seleção, Albiceleste`

### 06 传奇球星档案
来源章节：`3. 传奇球星档案`

建议摘要：覆盖贝利、马拉多纳、克鲁伊夫、贝肯鲍尔、齐达内、R9、小罗、梅西、C 罗、内马尔、姆巴佩、哈兰德等球星资料。

精准关键词：`Pelé, Maradona, Cruyff, Zidane, Ronaldo R9, Ronaldinho, Messi, Cristiano Ronaldo, Neymar, Mbappe, Haaland, legend`

风险处理：现役球员转会、荣誉、状态会变化，回答时应避免声称“最新”。

### 07 球衣工艺术语
来源章节：`4. 球衣工艺术语对照表` 与 `11. 附录` 合并。

建议摘要：保留中、英、西、葡、法、意、德、阿、土 9 语种术语对照，覆盖刺绣、热压、印号、球员版、球迷版、复古版、主客场、第三球衣、训练服、面料技术、领型、徽章、赛事 Patch 等。

精准关键词：`embroidery, heat press, nameset, player version, replica, retro, home kit, away kit, third kit, crest, patch, Dri-FIT, HEAT.RDY`

### 08 正品鉴定术语
来源章节：`5. 正品鉴定术语` 与 `12. 正品鉴定术语详解` 合并。

建议摘要：解释吊牌、全息贴、批次码、产品码、内标、面料、重量、手感、品牌标签等鉴别术语。

精准关键词：`authenticity, tag, hologram, batch code, product code, Nike code, Adidas code, Puma style number, fake check`

风险处理：
- 可以解释“如何查看标签和产品码”，但不应帮用户制作仿冒细节。
- 客服回答中不要主动承认或暗示商品为仿品。
- 商品状态必须以商品页面标注、订单信息和平台政策为准。

### 09 球迷俚语与助威口号
来源章节：`6. 球迷俚语与助威口号` 与 `13. 球迷俚语 & 助威口号` 合并，并补充 Britannica / Goal / SI 常见术语。

建议摘要：覆盖西语、葡语、法语、意语、德语、阿语、土语的球迷常用表达，补充 GOAT、Derby、Ultras、Plastic fan、Banter、Bottle、Park the bus 等常见英文社媒说法。

精准关键词：`GOAT, derby, ultras, plastic fan, banter, bottled it, park the bus, chant, football slang, fan phrase`

风险处理：
- “Plastic fan”等带攻击性词汇只解释含义，不建议主动对用户使用。
- 球迷互怼可以轻松，但不能输出仇恨、歧视、地域攻击、宗教攻击。

参考来源：
- `https://www.britannica.com/sports/Soccer-Slang-101-Glossary-of-Football-Terminology`
- `https://www.goal.com/en/news/football-phrases-101-slang-terms-idioms-meanings-explained/lpfi6xqrxtmc1gjoi1e7hc7un`

### 10 装备品牌历史
来源章节：`8. 装备品牌历史`

建议摘要：覆盖 Nike、Adidas、Puma、Umbro、Kappa、Macron、Joma、Hummel、New Balance、Castore、Le Coq Sportif、Mizuno 等品牌历史和足球装备关联。

精准关键词：`Nike, Adidas, Puma, Umbro, Kappa, Macron, Joma, Hummel, New Balance, Castore, Mizuno, kit supplier`

清洗建议：修复 Puma 编号重复。

### 11 胸前赞助商历史
来源章节：`9. 球衣胸前赞助商历史`

建议摘要：解释巴萨、皇马、拜仁、尤文、米兰双雄、PSG、利物浦、阿森纳、曼联、曼城等俱乐部胸前赞助商演变。

精准关键词：`shirt sponsor, jersey sponsor, Rakuten, Fly Emirates, TeamViewer, Etihad, Standard Chartered`

风险处理：赞助商变更频繁，回答最新赞助商时需要提示“可能随赛季变化”。

### 12 Derby / Clásico 大全
来源章节：`10. Derby / Clásico 大全`

建议摘要：覆盖 El Clásico、马德里德比、米兰德比、罗马德比、意大利德比、都灵德比、Old Firm、北伦敦德比、曼彻斯特德比、Le Classique、Der Klassiker、Superclásico、土耳其跨洲德比等。

精准关键词：`El Clásico, Madrid Derby, Derby della Madonnina, Derby della Capitale, Derby d'Italia, Old Firm, North London Derby, Manchester Derby, Superclasico`

风险处理：涉及政治、宗教、地区身份时，只做背景解释，不作立场判断，不煽动对立。

## 建议入库拆分策略

### 文档层
保留一条主知识库文档：`kb_football`。

### section 层
按上面 12 个章节拆为一级 section。俱乐部、国家队、球星、德比等大章节下建议继续拆二级 section，例如：
- `club_real_madrid`
- `club_fc_barcelona`
- `player_messi`
- `derby_el_clasico`

### 检索策略
- 用户问球队/球星：优先召回对应俱乐部、国家队、球星 section。
- 用户问规则：召回规则与 VAR section。
- 用户问战术/数据：召回战术与数据指标 section。
- 用户问球衣工艺/鉴定：召回球衣工艺或鉴定 section，但售后政策仍回到客服库。

## 待补充
1. 官方且最新的 IFAB 规则摘要正文。
2. 2026 世界杯赛制正文。
3. 欧冠 36 队联赛阶段正文。
4. 现代战术与数据指标正文。
5. 球迷俚语英文通用补充正文。
6. 去重后的球衣工艺术语最终表。
7. 去重后的正品鉴定最终表。
8. 去重后的球迷俚语最终表。
