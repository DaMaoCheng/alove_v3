# Gemma 客服上下文优化

Date: 2026-07-21
Status: local implementation; deployment not started

## Goal

让 Alove 的客服请求可以稳定携带最多 50 条历史消息，并在 Gemma 16K 上下文内完成精确计数、有限压缩和可观测回退。

## Scope

- Gemma Worker：取消固定 20/30 条消息作为上下文边界，增加 64 项输入保护上限、llama.cpp 精确 Token 计数和客服文字历史摘要。
- Alove prompt builder：保留标准消息数组中的历史消息，不再把完整历史重复拼进 `Recent Chat` system layer。
- 保留当前模型、图片格式、RunPod Endpoint、GPU 候选和缓存策略不变。

## Context policy

- Runtime target: 16,384 tokens per Slot.
- Output reservation: 2,048 tokens.
- Safety reservation: 512 tokens.
- Warning threshold: 11,500 input tokens.
- Compaction threshold: 12,000 input tokens.
- Recent original history target after compaction: about 7,000 tokens.
- At most twelve bounded summary chunks, with approximately 8,000 estimated input tokens per chunk.
- Leading system/persona/safety/output-contract messages are never summarized.
- Knowledge and product context are not summarized; callers should retrieve bounded current facts.
- Historical images are not converted to fabricated descriptions by the Worker. The current request keeps image inputs and reserves 4,096 visual tokens per image by default; this is still subject to GPU calibration.

## Verification gates

1. Worker unit tests cover 52-message payloads, exact token accounting, compaction, summary cache and context overflow.
2. Alove prompt self-check confirms historical text and the current message appear only in standard messages, not duplicated in `Recent Chat`.
3. Python/Node syntax checks and existing test suites pass.
4. Before deployment, test 10/30/50 history messages, 1-3 JPEG inputs, knowledge/product context, cache hit and 24/32/48 GB GPU profiles.

## Rollback

Use the existing Gemma Template/Release and restore the previous Worker image and environment values. No remote resource is changed by the local implementation phase.
