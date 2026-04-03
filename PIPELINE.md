# Rem AI Pipeline

## 数据流

```
user input (text/audio)
    ↓
interrupt check (InterruptController)
    ↓
runPipeline()
    ↓
updateEmotion() → emotion state
    ↓
extractMemory() + retrieveMemory()
    ↓
fast brain (LLM stream)
    ↓
sentence chunker (逐句切分)
    ↓
TTS synthesize (emotion params)
    ↓
audio stream → client
    ↓
slow brain (background)
```

## 详细步骤

1. **Interrupt Check**: 检查是否需要打断当前回复
2. **Emotion Update**: 根据用户输入更新情绪
3. **Memory Extraction**: 从用户输入提取新记忆
4. **Fast Brain**: 流式生成 LLM 回复
5. **Sentence Chunker**: 按标点切分句子
6. **TTS**: 逐句合成语音（带情绪参数）
7. **Audio Stream**: 推送音频到客户端
8. **Slow Brain**: 后台异步分析对话

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
