# Rem AI Pipeline

## 数据流

```
user input (text/audio)
    ↓
interrupt check (InterruptController)
    ↓
runPipeline()
    ↓
updateEmotion(runtime) → 情绪 + 强度/惯性（`EmotionRuntime`，每连接）
    ↓
（可选 env）rem_thinking_filler=1 → 异步短「嗯」TTS，与下文 LLM 并行
    ↓
extractMemory() + retrieveMemory()（`RemSessionContext.memory`，session overlay：本地副本优先）
    ↓
brain router：trimHistoryToTokenBudget（MAX_HISTORY_TOKENS）
    ↓
fast brain：system 含 priorityContext（策略提示 + 慢脑画像）
    ↓
LLM stream（complete/stream 带 withRetry）
    ↓
sentence chunker（逐句切分）
    ↓
TTS synthesize（Edge 默认同 voice+韵律参数 **连接池** 复用 WS；`textToSpeech` withRetry + 短句缓存；emotion params）
    ↓
audio stream → client
    ↓
slow brain（background，user_facts → 当前连接的 session overlay，本地立即可见，持久层异步写回；仅在非中断完成态触发）

（可选）用户沉默超过 REM_SILENCE_NUDGE_MS → 服务端触发「陪伴搭话」管线（不写 user 入库 / 不跑慢脑）
```

### 当前语义约定

- `interrupt` 只表示“当前 active generation 被新输入抢占”。
- `chat_end` 只表示文本流结束；客户端可能仍在播最后一段 TTS。
- 被打断的 assistant partial 只保留在 `lastInterruptedReply` 作为 carry-forward 上下文，不进入正式 history、不进入 slow brain、也不按正常 assistant message 持久化。

## Current Relationship-State Gap

- relationship write-back 目前是异步的，并且只应发生在非中断完成态之后
- relationship restore 入口已经存在，但还没有完整接入 session 初始化主链路
- 当前 live path 的 memory retrieval 仍主要是 `getAll()`，还没有按 topic / mood / relationship 做优先级
- system memory key 与普通用户事实仍需要在 retrieval 层进一步分流，避免 prompt 被无差别平铺

当前主线程不是把慢脑逻辑塞进 fast path，而是在不阻塞 live response 的前提下，把 relationship continuity 闭环补齐

## 详细步骤

1. **Interrupt Check**: 检查是否需要打断当前回复
2. **Emotion Update**: 根据用户输入更新情绪（含强度衰减逻辑，见 `emotion/`）
3. **（可选）Thinking Filler**: `rem_thinking_filler=1` 时异步合成极短填充音
4. **Memory Extraction**: 从用户输入提取新记忆
5. **Fast Brain**: 流式生成 LLM 回复（历史按 token 预算裁剪）
6. **Sentence Chunker**: 按标点切分句子
7. **TTS**: 逐句合成语音（带情绪参数）
8. **Audio Stream**: 推送音频到客户端
9. **Slow Brain**: 后台异步分析对话，事实写入记忆库；中断轮次不触发

## 中断与结束语义

- 文本被打断时，`runPipeline()` 仍会发出 `chat_end`，但其 `content` 可能是 `"[interrupted]"`。
- assistant 回复只有在 `!signal.aborted` 时才会走正常持久化。
- 前端的 `confirmed_end` 允许晚于 `chat_end`，因为它要等本地播放队列真正 drain。

## 观测与回归

- `/health`：由网关直接返回轻量 JSON（`ok` / `service` / `uptimeSec`），用于 smoke 和本地连通性检查，不表示 readiness。
- `scripts/smoke.mjs`：依次验证主页、`/health` 和一轮最小 WebSocket chat。
- `infra/latency_tracer.ts`：固定输出 `speech_end_to_stt_final`、`stt_final_to_llm_first`、`llm_first_to_tts_first`、`tts_first_to_playback` 等指标，便于做前后版本对比。
- `test/server/session/duplex_harness.ts`：固定输出 `sparseClickNoise`、`strictNoPreviewNoise`、`fallbackLongHumNoise`、`humanSpeech` 四个场景，用于语音链路回归。

## 目录结构

```
server/
├── server.ts                    # 入口文件
├── gateway/
│   ├── index.ts                 # HTTP + WebSocket 网关
│   └── types.ts                 # ServerMessage 类型
├── session/
│   ├── index.ts                 # ConnectionSession 类
│   └── types.ts                 # 会话状态类型
└── pipeline/
    ├── index.ts                 # runPipeline 导出
    ├── runner.ts                # 管线执行逻辑
    └── types.ts                 # 管线类型
```
