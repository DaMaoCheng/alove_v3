# ElevenLabs 前台音色待办记录

更新时间：2026-06-23

## 当前结论

- ALOVE 前台共用的 Professional Voice Clone 已创建并验证完成。
- `m98EUhgNJclFM2V0xXhQ` 已能用 `eleven_multilingual_v2` 真实生成 TTS。
- 本地数据库里，所有 mascot/front-desk 前台已从 `elevenlabs_clone_pending` 切到正式 ElevenLabs 音色。
- 当前只剩服务器部署后的线上验证。

## 当前 ElevenLabs 音色

- 名称：`ALOVE Front Desk PVC`
- voice_id：`m98EUhgNJclFM2V0xXhQ`
- 类型：`professional`
- 用途：所有 mascot/front-desk 前台共用音色
- 当前项目状态：本地前台角色已绑定 `voice_provider = elevenlabs`、`voice_id = m98EUhgNJclFM2V0xXhQ`、`voice_style = ALOVE Front Desk PVC`

## 已完成

- 已创建 Professional Voice Clone 槽位。
- 已上传原有 4 条样本。
- 已追加新的样本：
  - 文件：`食其家·牛丼咖喱(友邦金融中心店) 8.m4a`
  - ElevenLabs 样本 ID：`t9nNkVQ7lcbwrGSmI3Rf`
  - 时长：约 `10分04秒`
- ElevenLabs 样本长度要求已满足。
- ElevenLabs voice 查询确认：
  - `category = professional`
  - `is_allowed_to_fine_tune = true`
  - `verification_failures = None`
  - `dataset_duration_seconds ≈ 629.7`
  - `eleven_multilingual_v2`、`eleven_flash_v2_5`、`eleven_turbo_v2_5` 等模型为 `fine_tuned`
- 已用 `m98EUhgNJclFM2V0xXhQ` 做真实 TTS 测试，生成成功。
- 已执行 `scripts/apply-public-character-voice-persona-config.mjs`，本地绑定完成：
  - `mascot_template` / Kit：`voice_provider = elevenlabs`，`voice_id = m98EUhgNJclFM2V0xXhQ`，`voiceClone.status = ready`
  - FKK / Millie：`voice_provider = elevenlabs`，`voice_id = m98EUhgNJclFM2V0xXhQ`，`voiceClone.status = ready`
- 已更新并通过 `scripts/public-character-voice-persona-config-self-check.mjs`。

## 后续待办

- 按 release 流程部署到服务器。
- 部署后在线上测试前台聊天语音回复。

## 注意事项

- 不要用 30 槽位的 Instant Voice Clone 替代这个前台 PVC；前台音色指定使用 1 槽位 Professional Voice Clone。
- 普通角色仍继续使用现有 ElevenLabs preset / 后续 30 槽位克隆逻辑，不受前台 PVC 绑定影响。
- 不要把 ElevenLabs API key 或账号敏感信息写进日志、release 文档或前端代码。
