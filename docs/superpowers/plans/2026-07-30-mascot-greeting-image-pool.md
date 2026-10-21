# 前台问候素材库实施方案

状态：已发布（`2026-08-01-greeting-media-global-product-search-20260801141019`）

## 目标

让每个前台（`mascot`）拥有独立、可运营的五槽问候素材库：前四槽为预先准备好的问候图片，第五槽为问候视频。管理员在“前台管理”编辑器中查看、上传或删除素材；用户新建该前台的聊天会话时，系统优先发送已就绪视频，没有视频时才从已就绪图片中随机选择一张，与既有问候语一同发送。

素材不是用户聊天时即时生成的自拍，也不消耗正式账号或游客的图片额度。它是前台的公共素材库。

## 已确认产品规则

- 只适用于 `mascot` 前台；不影响 creator、普通角色、角色头像、广告图片或用户聊天即时生图。
- 每个前台固定五个槽位；1–4 槽只允许图片，第 5 槽只允许 MP4 视频。已就绪素材可少于五个，但不存在任何已就绪素材时仍正常只发送既有问候语。
- 管理员可在后台查看五格素材库；空槽点击即上传，已就绪缩略图可点击放大/播放并从右上角删除。上传素材先落入素材库，不会直接发给任何用户。
- 新会话先写入既有问候文字（以及既有问候语音）；视频 ready 时随后写入视频消息，否则由服务端安全随机数选择一个 ready 图片数组编号并写入图片消息。没有 ready 素材时不写媒体消息。素材选择不调用模型，素材消息不会进入模型的 50 条文字上下文、记忆、商品统计或游客图片额度。
- 同一会话只选择和保存一次素材；刷新、重新进入同一会话、语音重试或并发请求都不换素材、不重复发送。
- 已有历史会话不补发图片；只有这项能力上线后的新会话才会获得问候图。
- 问候素材是前台公开素材，使用独立公共上传目录；不复用必须按会话授权的 `chat_image_assets`。

## 数据与状态模型

新增 `mascot_greeting_images`：

| 字段 | 说明 |
| --- | --- |
| `id` | 稳定图片记录 ID |
| `character_id` | 归属 mascot；外键关联 `ai_characters` |
| `slot_index` | 1–5，同一前台唯一 |
| `image_url` | 兼容保留的公共素材地址字段；可保存 WebP 图片或 MP4 视频 URL |
| `generation_status` | `empty` / `ready` / `failed`；聊天只选 `ready` |
| `prompt_summary` | 保留已有生成来源的历史审计摘要；上传图片为空 |
| `source_type` | `ai` / `upload`，兼容已有来源记录；当前后台页面只新增 `upload` |
| `created_at` / `updated_at` | 运营审计时间 |

图片消息继续写入既有 `chat_messages`：

- `content_type = 'mascot_greeting_image'`
- `source_type = 'system'`
- `source_ref = 'mascot-greeting-image:<imageId>'`
- `product_payload_json` 保存 `imageId`、`imageUrl`、`mediaType`、`mimeType`、槽位及固定公共素材标志。

这样历史会话可以直接展示当时实际发出的图片或视频；删除或替换素材库中的文件不会篡改已经发出的历史消息。

## 批次 1：独立素材库存储与服务端管理接口

### 修改范围

- `server/db-bootstrap-chat-tables.js`
  - 增加幂等的 `mascot_greeting_images` 建表、前台+槽位唯一索引和必要外键。
  - 不修改 `mascot_settings`，避免把五项重复 JSON 塞入当前已有的前台配置表。
- 新增 `server/mascot-greeting-image-service.js`
  - 负责五槽位读取、合法 mascot 校验、上传保存、删除和空槽位归一化。
  - 前四槽上传原图先校验真实 MIME 和大小，再立即缩放并转为 WebP；第五槽校验不超过 30MB 的 MP4 后，立即压缩为最大 720×1280、30fps 的 H.264/AAC MP4。压缩失败时拒绝上传，不保存未压缩源文件。
  - 视频压缩放在独立 `server/mascot-greeting-video-compression-service.js`，不把进程、临时文件和超时处理堆入素材 CRUD service。
  - 采用独立的 `uploads/mascot-greetings/` 上传策略及公开静态路径。
- `server/upload-policies.js`、`server/static-file-service.js`
  - 增加独立素材目录、MIME/大小限制与静态文件白名单；不放宽头像、聊天附件或聊天图片访问边界。
- `server/admin-mascot-routes.js`
  - 管理员页面只调用只读图池、单槽上传和删除接口；全部要求现有 `admin:mascot:write` 写权限。既有内部生成路由不在当前页面暴露。
- `server/admin-mascot-query-service.js`、`server/admin-mascot-mapper.js`
  - 让前台编辑器读取相应五格图池；列表页不额外加载大图数据。

### 不做

- 后台素材库不提供 AI 生成按钮；内部旧生图路由不得写入第五个视频槽。
- 不做站点全局图池；图池只绑定角色，因此同一个前台复用于同一角色的站点时也保持一致。
- 不让上传失败占用或替换当前已就绪素材。

### 验收

- 空库和已有库均可幂等启动，任意前台只能有 1–5 五个槽位。
- 非 mascot、归档角色、非管理员和跨角色/跨槽位请求均被服务端拒绝。
- 上传的非法格式、槽位媒体类型不符、超大文件、图片转码失败和视频压缩失败都不会写成 `ready`；既有素材保持可用。
- 上传目录只包含前台公共图片，不出现用户附件、聊天私图、Token 或模型密钥。

## 批次 2：后台编辑器中的五格素材库

### 修改范围

- `src/services/admin-mascot-service.js`
  - 添加图池读取和单槽管理请求；复用既有 `requestJson` 和错误呈现。
- `src/features/admin-console/admin-console-mascot-template.js`
  - 在既有头像和“问候语”之间加入五格“问候素材库”区域，沿用当前后台卡片/按钮/错误样式。
  - 前四格显示问候图片，第五格显示问候视频；空槽本身就是上传入口，已就绪素材点击后复用并扩展现有预览弹窗，删除按钮悬浮在卡片右上角；不新建另一页或另一套弹窗。
- 新增 `src/features/admin-console/admin-mascot-greeting-image-controls.js`
  - 只承接图库的局部状态、文件选择、单槽操作和局部重绘；不把请求/状态继续堆进 `admin-mascot-controller.js`。
- `src/features/admin-console/admin-mascot-controller.js`
  - 编辑器打开时装配该控制器；保存普通前台字段不覆盖图库。
- `src/features/app-shell/styles/admin-mascot.css`
  - 只补图库网格及移动端收缩样式，保持已有后台主题。

### 不做

- 不改变头像“上传/AI 生成/删除”的既有行为。
- 不上传或删除图片时自动保存人设、问候语、站点绑定等普通表单字段。

### 验收

- 管理员可打开任何 mascot 的编辑器并看到固定五格；空位、失败、已就绪状态明确。
- 任一槽上传/删除仅更新该格，不关闭编辑器、不覆盖其他四格或未保存的人设字段。
- 重新打开编辑器可读回已就绪图片和视频；普通头像、问候语、知识库、发广告和停用前台回归正常。

## 批次 3：首次问候的确定性素材消息

### 修改范围

- `server/mascot-greeting-image-service.js`
  - 在当前事务内检测是否已有 `mascot-greeting-image` 来源消息；没有时先选择第 5 槽 ready 视频，视频不存在才使用 `crypto.randomInt()` 从 1–4 槽的 ready 图片数组中选择一个编号并写入消息。
  - 选图在事务内锁定当前会话的唯一来源消息，保证并发加载、发送、刷新只会写一条。
  - 继承当前会话的 `guest_session_id`，但不写入 `chat_image_assets`、`guest_image_entitlements`、`chat_image_usage` 或记忆队列。
- `server/chat-opening-message-service.js`
  - 在既有问候文字/语音完成后调用图池消息 service；不改变原问候语音的生成与失败恢复。
- `server/guest-session-service.js`
  - 复用同一 opening helper，而不是保留游客专用的第二套图片逻辑；游客切换到其它角色创建的新会话时，非 mascot 不发送图池图。
- `server/chat-message-store.js`
  - 映射 `mascot_greeting_image` 为统一客户端 `image` payload，并且仅将这类公共资源安全映射给对应会话读取者。
- `src/features/chat/chat-message-renderer.js`、`src/features/chat/chat-image-message.js`
  - 复用既有聊天图片卡的 ready 状态结构渲染该消息类型，不显示“生成中”或重试按钮。

### 顺序

```text
新建会话
  → 既有问候文字（及既有问候语音）
  → 有 ready 视频则发送视频
  → 否则随机一张 ready 图片
  → 否则不创建媒体消息
  → 用户第一次消息
```

### 不做

- 不修改已有会话，不给历史聊天补图。
- 不用图片替代问候语，不给问候图片生成语音，也不把它作为 AI 图片生成额度或商品图片。
- 不在页面刷新、聊天列表读取、语音重试或会话恢复时重新随机。

### 验收

- 正式用户、游客、新站点、无素材和存在 1–5 个已就绪素材分别验证。
- 同一会话重复读取、并发首次发送及刷新后只存在一条问候素材；新会话可随机命中素材库任一合规的已就绪图片或视频。
- 普通角色、creator、即时生图、附件、语音、商品卡和 30 条游客额度均不受影响。
- 已发图片或视频在聊天页与后台会话详情可见；删除素材库槽位后历史消息仍可正常显示。

## 批次 4：文档、对抗式审查与真实链路验证

### 文档与记录

- 更新 `docs/system/pages/admin/02-sites-mascot-carousel.md`：前台编辑器增加图库字段、操作、权限和边界。
- 更新 `docs/system/pages/user/03-chat-product-call.md` 与 `docs/design/03-characters-chat-memory-and-ai-behavior.md`：记录“仅新会话、预生成、随机一次、无额度消耗”的规则。
- 完成后更新 `logs/updates/2026-07-30.md`；阶段能力完成时按既有格式更新 release 记录。

### 对抗式审查重点

- 并发建会话和并发读取是否重复发图；
- 删除/替换素材库文件后，历史消息能否继续读取；
- 非管理员、非 mascot、跨角色和恶意 slot 参数是否越权；
- 生成失败、上传失败、仅部分槽位 ready 时是否错误发送空图；
- 问候素材是否意外计入聊天生图/游客额度/记忆或被清理任务删掉；
- 站点前台切换、通用模板 fallback、游客多角色会话是否错误复用另一角色图片。

### 最终真实链路验收

1. 管理员为一个测试 mascot 上传至少一张问候图片和一个问候视频，并确认后台重新打开可预览。
2. 以正式用户分别新建该 mascot 会话，确认问候文字后可出现图片或可播放视频；刷新不重复。
3. 以游客新建该站点前台会话：顺序相同，游客额度和即时生图资格不变化。
4. 删除其中一个素材，再建新会话：不会再选中已删除素材；已有旧会话仍可查看它。
5. 验证普通角色、creator、无图前台、即时生图、附件、语音和商品卡回归。

## 回退

- 关闭首次问候图片 service 调用即可停止新增图片消息；既有文字问候、语音和所有聊天不受影响。
- 图池表和素材目录独立，不会影响 `chat_image_assets`、头像或用户上传文件。
- 回退前端后，旧客户端会以普通图片消息展示已有问候图，不影响读取或会话完整性。
