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
extractMemory() + retrieveMemory()（`RemSessionContext.memory`，每连接）
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
slow brain（background，user_facts → 当前连接的 `InMemoryRepository`）

（可选）用户沉默超过 REM_SILENCE_NUDGE_MS → 服务端触发「陪伴搭话」管线（不写 user 入库 / 不跑慢脑）
```

## 详细步骤

1. **Interrupt Check**: 检查是否需要打断当前回复
2. **Emotion Update**: 根据用户输入更新情绪（含强度衰减逻辑，见 `emotion/`）
3. **（可选）Thinking Filler**: `rem_thinking_filler=1` 时异步合成极短填充音
4. **Memory Extraction**: 从用户输入提取新记忆
5. **Fast Brain**: 流式生成 LLM 回复（历史按 token 预算裁剪）
6. **Sentence Chunker**: 按标点切分句子
7. **TTS**: 逐句合成语音（带情绪参数）
8. **Audio Stream**: 推送音频到客户端
9. **Slow Brain**: 后台异步分析对话，事实写入记忆库

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
