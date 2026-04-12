# Rem AI — 开发任务

## Current Main Thread

当前主线程以 [CURRENT_FOCUS.md](CURRENT_FOCUS.md) 为准。

**记忆 V1 / 关系层第一阶段：已完成验收。所有 10 项验收标准全部通过。

当前最高优先级：记忆 V2 / 关系层第二阶段 —— 语义 Episode 聚类与主动对话触发。

说明：
- 下面的 `T-*` 列表主要是历史建设清单
- 当前迭代优先级不要按旧 Phase 顺序理解
- 先看下面这组 `R-*` 任务，再决定是否进入旧任务表
- 当前主线程相关代码改动完成后，必须同步更新这里对应任务的状态与说明

## Current Main Thread Tasks

- [x] **R-001** 文档入口统一
  - 目标：让 agent 一进仓库就知道当前主线程是“关系层第一阶段”
  - 输入/输出：更新 `AGENTS.md`、新增 `CURRENT_FOCUS.md`、在 `TASKS.md` 增加当前主线程入口
  - 不做什么：不修改运行时代码
  - 验收标准：只看 `AGENTS.md` 就知道现在先做什么；只看 `TASKS.md` 就能找到当前任务入口
  - **状态：已完成** — `AGENTS.md` 和 `CURRENT_FOCUS.md` 已存在且内容正确

- [x] **R-002** 关系状态恢复链路文档化
  - 目标：明确 relationship state 的持久化恢复链路
  - 输入/输出：说明 session init 应加载 relationship state、`hydratePersistentRelationshipState(...)` 的职责、恢复失败时的降级行为
  - 不做什么：不在本任务里实现 restore wiring（wiring 已在代码中完成）
  - 验收标准：文档能让实现者清楚 restore 接在哪里、失败后如何退回 session 级行为

- [x] **R-003** prompt 消费链路文档化
  - 目标：明确 relationship state 如何进入 prompt
  - 输入/输出：说明 `synthesizeContext()` 的用途、`buildConversationStrategyHints()` 的用途、哪些字段属于 priority context
  - 不做什么：不重写 prompt builder
  - 验收标准：实现者能分清“长期关系上下文”和“本轮说话策略”的来源与职责

- [x] **R-004** 记忆召回升级任务定义
  - 已落地：prompt retrieval 已从 `getAll()` 升级为 relationship-aware relevant retrieval
  - 当前实现：`core facts -> core episode -> active episode -> recent shared moment/fallback facts`
  - 保留边界：未引入 embedding/索引改造，仍保留无向量回退
  - 当前状态：memory v1 可用；Memory V2 PR1 foundation 已落地 `episodes` schema / `embedding_client` / `episode_repository` / memory embedding 写入，后续进入 semantic episode recall 接线

- [x] **R-005** 中断污染保护任务定义
  - 目标：明确 interrupted partial 的污染保护边界
  - 输入/输出：说明 interrupted partial 不进 formal history、不进 slow brain、不写 relationship state
  - 不做什么：不改变现有 interrupt 语义
  - 验收标准：后续任务不会把 carry-forward 草稿误写进正式状态

- [x] **R-006** fast brain 行为层准备任务定义
  - 已落地：turn-taking 已接入 partial-growth / interruption class / prediction gate 联动
  - 当前实现：`correction / emotional_interrupt / topic_switch` 走不同 live policy；prediction 继续只读
  - 保留边界：未把慢脑分析或持久化写入塞进 fast path
  - 当前状态：voice continuity 已进入 memory v1 可验收范围；后续可继续做更深的 latency 自适应

## Memory V1 Status

- [x] per-user relationship state
- [x] reconnect continuity
- [x] prompt consumption of relationship summary / topic continuity / mood trajectory / proactive hooks
- [x] interrupted / partial assistant turn pollution guard
- [x] relationship-driven fact retrieval
- [x] explicit `episodes` layer persisted inside relationship state
- [x] `core episode` + `active episode` recall for prompt building
- [x] proactive ledger keyed by cue / episode / thread
- [x] stable relationship style slots in persona prompt
- [x] realtime continuity policy v2 with read-only prediction gating
- [x] developer preset bootstrap/reset hooks for persona + relationship testing

---

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

- [x] **T-006.1** 基础健康检查与 smoke 验证
  - 网关直接提供 `GET /health` 轻量 JSON
  - `scripts/smoke.mjs` 可验证主页 + `/health` + WebSocket chat

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
  - pgvector 扩展，`memories.embedding` 已统一到 `vector(768)`，并新增 `episodes` 表
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

- [x] **T-029.2** 打断语义收口
  - 被打断的 assistant partial 不进入 formal history / slow brain / 正常 assistant 持久化
  - `wasInterrupted` 仅由真实用户打断触发

- [x] **T-029.3** turn lifecycle 协议收口
  - idle 文本发送不再误发 `interrupt`
  - `chat_end` 与本地 playback drain 分离，前端在 drain 后再回到 `confirmed_end`

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

- [ ] **T-035.4** 前端情绪控制（待实现）
  - 与 WebSocket `emotion` / `avatar_frame` 等联动：状态展示、过渡、可选用户侧反馈
  - 服务端已有情绪管线；需在 `web/` 内做完整 UI/交互与状态同步

- [ ] **T-035.5** 前端 emoji 与展示策略（待实现）
  - 消息气泡中正确渲染 emoji；与 TTS 侧「不读 emoji」策略区分（展示保留、朗读可剥离）
  - 可选：表情拾色 / 与 2.5D、括号舞台说明的后续解析对齐

## Phase 9 · 基础设施

- [x] **T-036** 端到端流程联调
  - 文本/语音 → 情绪 + 记忆 → LLM → 流式回复 → TTS → 客户端

- [x] **T-036.1** 延迟与回放基线收口
  - `infra/latency_tracer.ts` 固定输出回归友好的 metrics shape
  - `test/server/session/duplex_harness.ts` 固定 `sparseClickNoise` / `strictNoPreviewNoise` / `fallbackLongHumNoise` / `humanSpeech` 四个场景名

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

## Phase 10 · 情绪与形象演进（待办）

- [ ] **T-040** 基于助手输出的情绪推断 + 多维表情状态（2.5D / 3D 预留）
  - **情绪来源**：由当前「仅用户输入关键词规则」演进为基于 **LLM 回复内容**（或用户 + 助手联合上下文）的情绪总结/分类；实现路径可与 [OPTIMIZATION.md](OPTIMIZATION.md) 中 **C5（LLM 辅助情绪）** 对齐（后验解析、并行小调用、strip 展示文本等）。
  - **协议与前端**：不单依赖字符串枚举；预留 **结构化情绪/表情载荷**（主情绪、强度、blend 权重或扩展 `FaceParams`），供后续 **Live2D / 3D（如 VRM）** 驱动；与现有 `emotion` / `avatar_frame` 保持兼容或加版本字段。
  - **关联**：衔接 **T-035.4**（前端情绪与 WS 同步）、**T-032**（口型与渲染引擎）。

---

## 进度统计

| 状态 | 数量 |
|------|------|
| ✅ 已完成 | 38 |
| ⬜ 未完成 | 4 |
| **总计** | **42** |

**完成率：约 90%**

### 未完成任务

| 任务 | 说明 | 依赖 |
|------|------|------|
| T-032 口型同步 | 需要音素提取 + 前端 3D 渲染引擎 | Live2D SDK 或 Three.js + VRM |
| T-035.4 前端情绪控制 | 情绪状态 UI、与 WS 推送同步、可选交互 | 现有 `emotion` / Avatar 协议 |
| T-035.5 前端 emoji | 气泡内渲染与展示策略，与 TTS 剥离区分 | 可选：与 2.5D / 舞台括号解析 |
| **T-040** 情绪推断 + 多维表情协议 | 见 Phase 10：助手侧情绪、结构化载荷、2.5D/3D | C5、T-035.4、T-032 |

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

---

## 工程优化文档

对话体验与稳定性相关的中等/简单任务（含 M1–M9、S9/S10 及 **M7 Edge 连接池** 等）的**完成与待办**见根目录 [OPTIMIZATION.md](OPTIMIZATION.md)，与 TASKS 中的产品任务（如 T-032）互补。
