# Rem AI — 开发任务

## Phase 0 · 项目基础

- [x] **T-001** 初始化 Node.js + TypeScript 项目
  - `package.json` + `tsconfig.json` 已配置
  - TypeScript 6, ts-node, nodemon
  - `dev` / `build` / `start` / `web:dev` / `web:build` 脚本

- [x] **T-002** 搭建项目目录结构
  - 实际结构：`server/` `agents/` `brains/` `brain/` `llm/` `memory/` `emotion/` `voice/` `utils/` `avatar/` `storage/` `infra/` `public/` `web/`

- [x] **T-003** 配置环境变量管理
  - dotenv 已安装，`.env` + `.env.example` 包含全部配置项
  - `.gitignore` 已配置

- [x] **T-004** 定义全局类型系统
  - 核心类型分布在各模块：`Memory` / `Emotion` / `PromptMessage` / `ChatMessage`
  - 存储层类型：`DbUser` / `DbSession` / `DbMessage` / `DbMemory` (`storage/types.ts`)
  - Avatar 类型：`FaceParams` / `Viseme` / `AvatarFrame` / `ActionCommand` (`avatar/types.ts`)
  - 前端类型：`MessageRole` / `ChatMessage` (`web/src/types/chat.ts`)

## Phase 1 · 网关与通信层

- [x] **T-005** 搭建 Express HTTP 服务
  - `server/server.ts`：Express + Next.js 集成，单端口服务

- [x] **T-006** 搭建 WebSocket 服务
  - ws 库 noServer 模式，`/ws` 路径升级
  - 每连接独立管理 SttStream / VadDetector / InterruptController

- [x] **T-007** 实现消息协议与路由
  - 完整 WebSocket 消息格式（type / payload）
  - 支持：chat / audio_stream / duplex_start / duplex_stop / audio_chunk / audio_end

- [x] **T-008** 实现会话管理
  - 每连接独立会话状态（pipelineChain / SttStream / VadDetector / InterruptController）

## Phase 2 · 对话引擎

- [x] **T-009** 封装 LLM Provider 调用层
  - `llm/qwen_client.ts`：OpenAI 兼容 SDK，流式调用 + AbortSignal + `<think>` 过滤

- [x] **T-010** 实现基础 Chat Engine
  - `brains/brain_router.ts`：对话历史管理（滑动窗口 10 轮）
  - `agents/conversation_agent.ts`：`chatStream()` 门面

- [x] **T-011** 实现人设（Persona）管理
  - `brain/personality.ts` + `brain/character_rules.ts`

- [x] **T-012** 对话上下文增强
  - `brain/prompt_builder.ts`：人设 + 规则 + 情绪风格 + 记忆 + 历史

- [x] **T-012.1** 实现双脑架构
  - `brains/fast_brain.ts`：低延迟流式回复
  - `brains/slow_brain.ts`：后台异步分析

## Phase 3 · 存储层

- [x] **T-013** 搭建 PostgreSQL 数据库连接
  - `storage/database.ts`：Pool 管理、健康检查、query 封装
  - 依赖：`pg` + `@types/pg`

- [x] **T-014** 设计并创建核心数据表
  - `storage/schema.sql`：users / sessions / messages / memories 表
  - pgvector 扩展，vector(1536) embedding 列
  - 索引 + UNIQUE 约束

- [x] **T-015** 搭建 Redis 连接
  - `storage/redis.ts`：ioredis 客户端，cacheGet / cacheSet / cacheDel 封装

- [x] **T-016** 实现对话历史持久化
  - `storage/repositories/message_repository.ts`：saveMessage / getSessionMessages
  - `storage/repositories/session_repository.ts`：createSession / endSession / getSession
  - 已集成到 server/server.ts

## Phase 4 · 记忆系统

- [x] **T-017** 实现短期记忆模块
  - `memory/memory_store.ts`：InMemoryRepository 实现 MemoryRepository 接口

- [x] **T-018** 实现记忆提取（Memory Extraction）
  - `memory/memory_agent.ts`：正则匹配 + 慢脑二次提取

- [x] **T-019** 实现长期记忆存储
  - `memory/memory_repository.ts`：MemoryRepository 接口（upsert / getAll / getByKey / delete / touch / getStale）
  - `storage/repositories/memory_repository.ts`：PostgreSQL + pgvector 实现
  - `memory/memory_store.ts`：InMemoryRepository 作为默认实现

- [x] **T-020** 实现记忆检索
  - `retrieveMemory()` 返回全量记忆注入 prompt
  - `storage/repositories/memory_repository.ts`：`findSimilarMemories` 向量语义检索（pgvector `<=>`）

- [x] **T-021** 实现记忆衰减与遗忘
  - `memory/memory_decay.ts`：decayScore（重要性 × 访问频率 × 时间衰减）
  - runDecay：超出上限淘汰低分条目 + 清理极低分条目
  - startDecayTimer / stopDecayTimer 定时任务
  - 已集成到 server/server.ts

## Phase 5 · 情绪系统

- [x] **T-022** 实现用户情绪识别
  - `emotion/emotion_engine.ts`：关键词规则 + 标点辅助

- [x] **T-023** 实现 AI 情绪状态机
  - `emotion/emotion_state.ts`：5 种状态 + 衰减

- [x] **T-024** 情绪注入对话系统
  - `prompt_builder.ts` 中 EMOTION_STYLE 映射

- [x] **T-025** 情绪日志记录
  - `infra/emotion_logger.ts`：EmotionLogger 环形缓冲区（1000 条）
  - log / getHistory / getStats / exportEntries
  - 已集成到 emotion/emotion_engine.ts

## Phase 6 · 语音模块

- [x] **T-026** 实现 STT 服务
  - `voice/stt_stream.ts`：Whisper API + whisper-cpp 双后端，WebM + PCM 双模式

- [x] **T-027** 实现 VAD
  - `voice/vad_detector.ts`：能量阈值 RMS + 帧计数

- [x] **T-028** 实现 TTS 服务
  - `voice/tts.ts`：Edge TTS / Piper / OpenAI TTS 三后端
  - `utils/sentence_chunker.ts`：逐句切分

- [x] **T-029** TTS 情绪语音适配
  - `voice/tts_emotion.ts`：Emotion → EmotionVoiceParams 映射（rate / pitch / lengthScale / speed）
  - Edge TTS：情绪状态 → rate + pitch 参数
  - Piper：情绪状态 → length_scale + noise_scale
  - OpenAI：情绪状态 → speed
  - `voice/tts_stream.ts`：synthesize 支持 emotion 参数透传
  - 已集成到 server/server.ts

- [x] **T-029.1** 实现管线打断控制
  - `voice/interrupt_controller.ts`：AbortSignal + 状态机

## Phase 7 · 虚拟形象

- [x] **T-030** 定义 Avatar 驱动协议
  - `avatar/types.ts`：FaceParams（13 个 blend shape）/ Viseme（16 种口型）/ LipSyncFrame / ActionCommand / AvatarFrame

- [x] **T-031** 实现情绪 → 表情映射
  - SVG 表情：neutral / happy / curious / shy / sad
  - `avatar/emotion_mapper.ts`：EMOTION_FACE_MAP / getEmotionFace / interpolateFace / createTransition

- [ ] **T-032** 实现口型同步
  - Avatar 协议已定义（Viseme / LipSyncFrame）
  - 需要：音素提取模块 + 前端 Live2D/3D 渲染

- [x] **T-033** 实现语义 → 动作触发
  - `avatar/action_triggers.ts`：6 种动作规则（点头 / 摇头 / 挥手 / 歪头 / 耸肩 / 惊讶）
  - detectAction / detectActions 关键词匹配

- [x] **T-034** Avatar 控制器
  - `avatar/avatar_controller.ts`：AvatarController 类
  - setEmotion（平滑过渡帧）/ processReply（动作检测）/ getFrame
  - 已集成到 server/server.ts

## Phase 8 · 前端

- [x] **T-035** 实现 Next.js 前端
  - Next.js 15 + React 19 + Tailwind CSS v4
  - 组件：RemChatApp / ChatWindow / InputBar / MessageBubble / Avatar / VoiceIndicator

- [x] **T-035.1** 实现旧版原生 JS 前端
  - `public/` 目录

- [x] **T-035.2** 实现双工语音录制
  - `web/src/lib/pcmCapture.ts`：16kHz mono Int16 PCM

- [x] **T-035.3** 实现音频播放队列
  - `web/src/hooks/useAudioBase64Queue.ts`

## Phase 9 · 基础设施

- [x] **T-036** 端到端流程联调
  - 文本/语音 → 情绪 + 记忆 → LLM → 流式回复 → TTS → 客户端

- [x] **T-037** 实现认证与限流
  - `infra/auth.ts`：JWT 中间件 + generateToken / verifyToken / wsAuthenticateOnce
  - `infra/rate_limiter.ts`：HTTP 限流（100/min per IP）+ WebSocket 限流（30/10s per conn）
  - 开发模式自动跳过认证
  - WebSocket 限流已集成到 server/server.ts

- [x] **T-038** 错误处理与日志系统
  - `infra/logger.ts`：pino 结构化日志，开发模式 pretty-print
  - createLogger(module) 创建子日志器
  - 已集成到 server/server.ts，替换 console.log

- [x] **T-039** Docker 容器化部署
  - `Dockerfile`：多阶段构建（backend-build → frontend-build → production）
  - `docker-compose.yml`：App + pgvector/pgvector:pg16 + Redis 7
  - schema.sql 自动初始化数据库

---

## 进度统计

| 状态 | 数量 |
|------|------|
| ✅ 已完成 | 38 |
| ⬜ 未完成 | 1 |
| **总计** | **39** |

**完成率：97%**

### 未完成任务

| 任务 | 说明 | 依赖 |
|------|------|------|
| T-032 口型同步 | 需要音素提取 + 前端 3D 渲染引擎 | Live2D SDK 或 Three.js + VRM |

### 已完成集成（Phase 1 + Phase 2）

| 模块 | 状态 |
|------|------|
| Logger 结构化日志 | ✅ 已集成 |
| Emotion Logger | ✅ 已集成 |
| TTS Emotion 情绪语调 | ✅ 已集成 |
| Memory Decay 定时任务 | ✅ 已集成 |
| Storage (PostgreSQL + Redis) | ✅ 已集成（可选，环境变量配置时启用）|
| Avatar Controller | ✅ 已集成 |
| WebSocket Rate Limiter | ✅ 已集成 |
| Server 重构 | ✅ 已拆分为 gateway/session/pipeline |

### Server 重构（Phase 2）

`server/server.ts` 已重构为更小的模块，每个文件 ≤ 500 行：

```
server/
├── server.ts                    # 入口文件 (~80 行)
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

新增 `PIPELINE.md` 文档，描述完整数据流。
