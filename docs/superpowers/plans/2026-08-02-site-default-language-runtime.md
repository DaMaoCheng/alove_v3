# 站点默认语言运行时实施方案

## 目标与边界

- 让 `sites.default_language` 从后台展示字段升级为用户端站点语言的唯一初始化来源。
- 当前路径解析出的 active 站点同时决定页面默认语言，以及正式账号和游客新会话的 AI 默认回复语言。
- FKK 保持 English；本地新增一个 Chinese (Mandarin) 测试站，通过两个真实路径验证页面和 AI 不串站、不串语言。
- 复用现有 `shared/language-library.js`、站点 branding、visitor resolution、聊天会话语言与语音链路，不新增第二套角色语言系统。
- 本轮只支持确定性的 English / Chinese 用户端 UI 文案；后台管理台继续使用中文。其他站点语言先安全回退 English，后续增加完整翻译包后再开放页面切换。
- 本轮不接 Shopify/TTMall 自动语言识别，不翻译商品源返回的商品标题，不把固定角色问候语交给模型实时翻译。

## 确定性语言优先级

### 用户端页面

1. 当前显式路径或访客分流解析出的 active 站点 `default_language`。
2. 无法识别或没有完整 UI 翻译包时回退 English。

### AI 新会话

1. 用户在当前消息明确要求的语言。
2. 当前聊天会话已经保存的语言。
3. 正式用户与角色的激活语言偏好。
4. 当前站点 `default_language`。
5. 角色默认语言。
6. English。

站点语言只负责初始化和兜底。用户明确切换后继续复用现有 session / activation 偏好，不能被每次页面刷新覆盖。旧会话保持原 `preferred_language`，不批量改写。

## 第一批：统一语言模块与公开站点上下文

新增：

- `shared/site-language.js`
  - 复用角色语言库识别 code/label/alias。
  - 输出标准站点语言 `{ code, label, uiCode }`。
  - UI 暂只允许 `en`、`zh`，其他识别语言 `uiCode` 回退 `en`。
- `src/i18n/site-copy.js`
  - 提供小接口 `createSiteCopy(language)`、`siteText(copy, key, params)`。
  - English / Chinese 文案按稳定 key 维护，不让页面自行写 `if Chinese`。

修改：

- `server/site-branding-service.js`
- `server/geo-site-resolver-service.js`
  - 公开白名单增加标准化 language；不返回 token、内部商品源或后台备注。
- `src/services/site-branding-service.js`
- `src/app/app-state.js`
- `src/app/site-routing.js`
- `src/app/main.js`
  - 移除 slug 到语言的硬编码表。
  - 从 branding / visitor resolution 初始化并刷新当前站点语言。
  - 同步 `<html lang>`，路径切换、刷新和后台当前站点更新时精确刷新。

验收：

- 任意新站点不需要改前端 slug 白名单即可读取语言。
- FKK 仍解析为 English；中文测试站解析为 Chinese (Mandarin)。
- 不存在站点、停用站点和不支持的 UI 语言继续安全回退 English。
- branding 接口不泄露后台私有字段。

## 第二批：核心用户页面确定性文案

修改用户端装配：

- `src/app/app-view-factory.js`
- `src/features/app-shell/app-shell.js`
- `src/features/app-shell/app-sidebar.js`
- `src/features/app-shell/app-topbar.js`

修改核心页面：

- 登录、注册、找回密码。
- Discover、Search、Kitshop、Chat、Create、Not Found。
- Profile、实时通话、商品详情、反馈、通知和游客认证引导中可见的固定文案。

执行规则：

- 页面只接收标准 language/copy，不读取全局可变状态。
- 复用已有页面、DOM、样式、事件和错误处理；只把用户可见固定文案替换为文案 key。
- 商品名称、角色名称、知识库回答和其他后端业务内容保持原数据，不做浏览器端机器翻译。
- ARIA、placeholder、空状态、加载、错误、Toast 同步适配，避免视觉中文但辅助文案仍为英文。

验收：

- 两个站点的同一页面结构、交互和样式一致，仅文案随站点切换。
- 页面不存在同一个核心区域中英混排；动态商品内容除外。
- 登录、注册、游客、搜索、商品详情、创建限制、语音和错误路径无功能回归。

## 第三批：AI 与语音默认语言

修改：

- `server/chat-language-preference-service.js`
  - 增加可选 `siteLanguage`，放在 activation 后、character 前。
- 正式文字、正式语音、游客文字、游客语音、实时通话的现有调用点。
  - 从可信 session/site 查询获得站点语言，不信任客户端提交的语言。
- 开场消息链路。
  - 固定问候语保持管理员配置原文；新 AI 回复和 TTS 语言使用最终有效聊天语言。

验收：

- FKK 新会话 AI 默认 English；中文测试站新会话 AI 默认 Chinese (Mandarin)。
- 用户明确要求 English/Chinese 后，新选择写入现有 session；刷新继续保持。
- 旧会话、角色激活偏好和语音音色选择不被破坏。
- 客户端伪造语言不能跨站或改写服务端站点默认值。

## 第四批：本地双站点真实验证

仅在本地数据库创建测试数据：

- 中文测试站：active、非默认、`default_language='Chinese (Mandarin)'`、独立测试 slug。
- 中文测试前台：只用于本地测试，绑定中文站点，问候语为中文。
- 开启该测试站游客聊天；不配置真实生产 token，不伪装真实商品源。

真实浏览器验证：

1. FKK 路径打开 Login / Discover / Search / Kitshop / Chat，页面和新 AI 回复为 English。
2. 中文测试路径打开相同页面，固定 UI 和新 AI 回复为中文。
3. 两个标签页同时打开、交替刷新和跳转，语言不相互污染。
4. 中文站会话明确要求 English 后继续 English；新浏览器新会话仍以中文开始。
5. FKK 原登录注册、游客聊天、商品搜索、商品详情、语音和正式账号链路回归。
6. 保留明确标记为本地测试用途的中文站点与测试前台，方便后续持续回归；测试会话可按需清理，但不得在验收后自动删除站点。

## 第五批：审查、文档与交付

- 语法检查、目标 self-check、完整 `npm run check:deployment`、`git diff --check`。
- 新增站点语言、自定义页面文案、正式/游客聊天语言优先级回归脚本。
- 更新 `docs/design/`、`docs/system/`、当日更新日志和本地 release。
- 由独立 Agent 分别审查前端漏翻译和后端会话/站点语言状态；P0/P1 修复后重新验证。
- 本轮只完成本地，不部署服务器、不推送 GitHub。

## 回退与检查点

- 当前工作区已有尚未提交的 TTMall 改动，语言功能不得清理、覆盖或重排这些改动。
- 每批结束先执行对应自检；失败时停在当前批，不继续叠加后续改动。
- 前端回退点是恢复 branding 的 language 消费并继续使用 English；后端回退点是移除 `siteLanguage` 参数，现有 session/activation/character 优先级不变。

## 实施状态

`Completed locally`：代码、双站点真实页面与真实 AI 链路和完整部署自检均已完成；本地中文测试站按最新产品决定持续保留，尚未部署服务器或更新 GitHub。

## 本地验收结果

- FKK branding 返回 `English / en`；临时中文站返回 `Chinese (Mandarin) / zh`，同一套页面在两个路径下分别渲染英文和中文。
- 中文站游客新会话落库为 `Chinese (Mandarin)`，真实模型用中文回复；FKK 新会话落库为 `English`，真实模型用英文回复。
- 中文站会话明确要求 English 后，`preferred_language` 更新为 English；下一条中文输入仍继续得到英文回复，证明刷新/输入语言不会覆盖会话选择。
- 本地持续保留 `中文测试站 /chinese-demo` 与前台 `小爱`，用于后续页面及 AI 语言回归；该数据不属于生产发布内容。
- 站点管理默认语言复用角色编辑器既有可搜索下拉模板、交互和样式，可按语言名称即时筛选，不维护第二套控件。
- 页面文案覆盖现有共用页面和弹窗；商品名、角色名、知识库与商品源内容按设计保留原文。后台管理页面继续使用中文。

## 第六批：完整覆盖审计与角色语言归属加固

### 目标与排除边界

- 扫描全部用户端页面、弹窗、Toast、错误、空状态、加载状态、placeholder、ARIA 与 title，补齐仍然写死的固定文案。
- 后台管理台继续固定中文，不接站点语言包。
- 通用角色与网红角色的人设、名称、简介、问候语等业务内容不做浏览器端翻译；它们只在聊天会话初始化时决定使用哪种输出语言。
- 商品名、知识库正文、管理员输入的角色内容和商品源原始内容继续保持原文。

### 语言包维护结构

- 继续使用唯一入口 `src/i18n/site-copy.js`，不引入第二套 i18n 框架。
- 增加覆盖自检，要求每个正式语言包拥有完全相同的 key；页面不得直接判断 `zh/en`。
- 增加语言包维护说明，写清新语言的文件落点、注册方式、fallback、覆盖检查和真实验收路径。
- 共享弹窗、Toast、错误和辅助功能文案通过调用方传入 copy，避免共享组件读取全局站点状态。

### 角色默认语言规则

新会话保持“已有会话与用户明确选择不可被覆盖”的原则，并按角色来源区分初始化：

1. 用户明确要求的语言。
2. 已保存会话语言。
3. 已保存的账号角色激活语言。
4. `source_type='user'` 的用户自行创建角色：创建时选择的角色语言。
5. `source_type='admin'` 的管理员创建角色（包括通用角色、后台创建的网红角色和前台）：当前可信站点的默认语言。
6. 其他历史/系统来源角色：当前站点默认语言，再回退角色已有语言。
7. English。

规则只用于创建新会话；旧会话不批量改写。用户创建角色的创建语言必须进入会话并冻结，不受当前站点默认语言覆盖；管理员创建角色不依赖后台写死的角色语言字段，同一个角色在不同站点首次建立会话时分别使用各站默认语言。

### 代码范围

- 用户端固定文案：`src/app/`、`src/pages/`、除后台与创作者后台外的 `src/features/`。
- 共享文案与维护入口：`src/i18n/`、`src/utils/user-facing-error.js`、共享 dialog/dropdown/toast 调用点。
- 会话语言初始化：`server/chat-language-preference-service.js`、正式会话和游客角色查询/创建链路。
- 回归门禁：新增语言包 key 完整性、用户端硬编码文案、管理员角色/用户角色语言优先级专项自检，并接入 `scripts/deployment-check.mjs` 与 `scripts/self-check-manifest.mjs`。

### 验收标准

- English 与 Chinese (Mandarin) 在所有用户端共用页面、弹窗、错误、Toast 和辅助文案上不出现固定文案串语；动态业务内容除外。
- 后台管理台保持中文，不因当前站点语言变化而切换。
- 管理员创建角色在英文站新会话使用 English，在中文站新会话使用 Chinese (Mandarin)。
- 用户自行创建并选择语言的角色，在任意站点新会话均优先使用创建时选择的语言。
- 旧会话、明确语言切换、激活偏好、语音与实时通话持续继承现有保存值。
- 新增第三种语言时，只需新增/注册语言包并补齐相同 key，不需要逐页修改条件判断。
- 专项自检、完整部署检查、双站点真实页面和真实 AI 会话验证通过后才可标记本地完成。
