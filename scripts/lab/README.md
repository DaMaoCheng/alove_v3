# ElevenLabs 隔离测试脚本

这些脚本只用于本地验证 ElevenLabs 音色、TTS 和后续声音克隆能力，不接入前端、数据库或角色业务链路。

## 准备

不要把 API key 写入项目文件。运行前在当前终端导出：

```bash
export ELEVENLABS_API_KEY='你的 ElevenLabs key'
```

所有脚本都会对环境变量做 `trim()`，可以排除首尾空格导致的误判。

## 查看模型和音色

```bash
node scripts/lab/elevenlabs-voices-list.mjs
```

## 按官方 JS SDK 生成 TTS

```bash
node scripts/lab/elevenlabs-tts-sdk-test.mjs
```

可选参数：

```bash
ELEVENLABS_VOICE_ID='JBFqnCBsd6RMkjVDRZzb' \
ELEVENLABS_MODEL_ID='eleven_multilingual_v2' \
ELEVENLABS_OUTPUT_FORMAT='mp3_44100_128' \
ELEVENLABS_TEXT='The first move is what sets everything in motion.' \
node scripts/lab/elevenlabs-tts-sdk-test.mjs
```

## 按 REST API 对照生成 TTS

```bash
node scripts/lab/elevenlabs-tts-rest-test.mjs
```

REST 版本严格按官方文档传参：

- `output_format` 放在 URL query。
- `text` 和 `model_id` 放在 JSON body。

如果 SDK 成功但 REST 失败，优先查 REST 拼参；如果 REST 成功但 SDK 失败，优先查 SDK 版本或参数名。

## 输出位置

音频文件会写到：

```bash
/tmp/alove-elevenlabs-test/
```

## 声音克隆

声音克隆会涉及授权和额度消耗，脚本默认禁止执行。只有确认样本来源合法、可用于克隆时，才运行：

```bash
ELEVENLABS_CONFIRM_CLONE=1 node scripts/lab/elevenlabs-ivc-test.mjs /path/to/sample.mp3
```

默认不会开启背景降噪，因为官方提示干净样本强行降噪可能降低质量。如果样本有明显底噪，再加：

```bash
ELEVENLABS_REMOVE_BACKGROUND_NOISE=true \
ELEVENLABS_CONFIRM_CLONE=1 \
node scripts/lab/elevenlabs-ivc-test.mjs /path/to/sample.mp3
```

IVC 脚本会调用 `POST /v1/voices/add`，只打印返回的 `voice_id` 和是否需要验证。
