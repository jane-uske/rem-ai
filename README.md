# Rem Companion AI

实时 AI 陪伴系统 —— 能聊天、有记忆、懂情绪、能说话、有形象。

## 核心功能

- **自然语言对话** — 双脑架构（Fast Brain 低延迟流式回复 + Slow Brain 后台深度分析），支持多轮上下文
- **用户记忆** — 从对话中自动提取用户信息（姓名、城市、职业、偏好等），注入后续对话
- **情绪系统** — 基于关键词识别用户情绪，维护 AI 情绪状态（neutral / happy / curious / shy / sad），影响回复风格
- **语音输入（STT）** — 支持 Whisper API 和 whisper-cpp，实时双工 PCM 流式传输 + VAD 语音活动检测
- **语音输出（TTS）** — 支持 Edge TTS / Piper / OpenAI TTS 三种后端，逐句流式合成
- **虚拟形象** — VRM 三维角色（Three.js）+ 情绪驱动；旧版含 SVG 表情头像
- **实时通信** — WebSocket 全双工通信，支持打断控制、流式 token 推送、音频流传输
- **3D Demo** — 独立 `/demo` 路由可离线切换模型、情绪、状态和动作，便于人工验收

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js + TypeScript |
| HTTP 网关 | Node.js `http` + Next.js + `ws` |
| 实时通信 | ws (WebSocket) |
| LLM | OpenAI 兼容 API（LM Studio / Qwen 等） |
| 语音识别 | Whisper API / whisper-cpp |
| 语音合成 | Edge TTS / Piper / OpenAI TTS |
| 数据库 | PostgreSQL + pgvector（向量语义检索） |
| 缓存 | Redis（ioredis） |
| 认证 | JWT（jsonwebtoken） |
| 日志 | pino 结构化日志 |
| 前端 | Next.js 15 + React 19 + Tailwind CSS v4 |
| 前端（旧版） | 原生 HTML/CSS/JS |
| 部署 | Docker + Docker Compose |

## 快速开始

```bash
# 安装后端依赖
npm install

# 安装前端依赖
npm install --prefix web

# 若需本地数据库/Redis（推荐仅把这两个放 Docker）
./scripts/start-dev-stack.sh

# 配置环境变量
cp .env.example .env   # 然后编辑 .env 填入 API Key 等

# 启动后端（端口 3000，推荐原生模式）
npm run dev:native

# 启动前端（另一个终端）
npm run web:dev

# 仅类型检查（不写 dist）
npm run typecheck
```

浏览器远程开发与办公网实时预览见 **`REMOTE_DEV.md`**。
如果 Next 开发态缓存异常，可先执行 **`npm run dev:web:clean`** 再重启服务。

### 本地验证

```bash
# 后端健康检查
curl http://127.0.0.1:3000/health

# 冒烟：主页 + /health + WebSocket chat
node scripts/smoke.mjs

# 后端测试
npm test

# 前端测试
npm run test --prefix web
```

`/health` 现在由网关直接返回轻量 JSON（`ok` / `service` / `uptimeSec`），用于本地 smoke 和基础连通性检查，不表示 DB/Redis readiness。

### 实时语义约定

- `interrupt` 只表示“一个已激活 generation 被新输入抢占”，不再用于 idle 文本发送时的清队列。
- `chat_end` 只表示文本流结束，不等于本地音频已经播放完；前端会在播放 drain 后再回到 `confirmed_end`。
- 被打断的 assistant 半句只保留为 carry-forward 上下文，不进入正式 history、不进入 slow brain、也不会按正常 assistant 消息持久化。
- 跨连接记忆当前采用“session overlay”方式：会话启动时可从持久层预加载少量事实型记忆到本地副本，live path 只读本地副本，持久层写回异步进行。

### 环境变量

| 变量 | 说明 |
|------|------|
| `key` | LLM API Key |
| `base_url` | LLM API Base URL |
| `model` | 模型名称 |
| `tts_provider` | TTS 后端（`edge` / `piper` / `openai`） |
| `tts_voice` | TTS 音色 |
| `stt_provider` | STT 后端（`openai` / `whisper-cpp`） |
| `whisper_model` | Whisper 模型路径 |
| `whisper_lang` | Whisper 语言 |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `REDIS_URL` | Redis 连接串 |
| `JWT_SECRET` | JWT 签名密钥 |
| `LOG_LEVEL` | 日志级别（默认 `info`） |
| `PORT` | 服务端口（默认 `3000`） |
| `REM_SILENCE_NUDGE_MS` | 用户无消息后多久由 Rem 主动搭话（毫秒）；`0` 或不设为关闭 |
| `REM_SILENCE_NUDGE_MIN_TURNS` | 至少聊过几轮才允许沉默搭话（默认 `2`） |
| `REM_SLOW_BRAIN_ENABLED` | 是否启用 slow brain 后台分析（默认 `1`）。设为 `0`/`false` 可关闭后台提炼，避免与 fast path 抢同一模型预算。 |
| `REM_AVATAR_INTENT_ENABLED` | 是否启用 reply-based avatar intent 推断（默认 `1`）。设为 `0`/`false` 时不再发送 `avatar_intent`，但主回复/TTS/turn lifecycle 不变。 |
| `REM_PERSISTENT_MEMORY_OVERLAY_ENABLED` | 是否启用持久记忆 overlay（默认 `1`）。数据库可用时，会话启动阶段预加载少量事实型记忆到本地副本；设为 `0`/`false` 则完全回到纯会话内 memory。 |
| `REM_PERSISTENT_MEMORY_PRELOAD_LIMIT` | 持久记忆启动预加载上限（默认 `12`）。prompt 仍会继续受 `MAX_PROMPT_MEMORY_ENTRIES` 裁剪。 |
| `STT_PARTIAL_PREDICTION_ENABLED` | 是否启用 partial transcript 预判（默认关闭）。设为 `1`/`true` 后才会触发额外 prediction 调用。 |
| `STT_PREDICTION_PUSH_ENABLED` | 是否把 prediction 结果以 `stt_prediction` 推到前端（默认关闭）。只有 `STT_PARTIAL_PREDICTION_ENABLED` 已开启时才生效。 |
| `STT_PREDICTION_DEBOUNCE_MS` | partial prediction 的防抖毫秒数（默认 `300`）。 |
| `NEXT_PUBLIC_VRM_URL` | （前端）自定义 VRM 路径；不设则使用 `web/public/vrm/` 下默认模型。根目录 `npm run web:dev` 时 `next.config` 会读取**仓库根** `.env`。 |
| `NEXT_PUBLIC_WS_URL` | WebSocket 地址，须含 `ws://` 或 `wss://`（勿写 `localhost:3000/ws` 无前缀）。 |
| `NEXT_PUBLIC_VRM_YAW` | VRM 绕 Y 轴旋转（弧度），模型背对镜头时可调。 |
| `NEXT_PUBLIC_VRM_FRAMING` | `full`（默认）全身；`upper` 上半身特写。 |
| `NEXT_PUBLIC_VRM_DISABLE_NODE_CONSTRAINT` | 默认禁用 `VRMC_node_constraint`（避免手臂被约束拉回展示姿势）；设为 `0` 恢复。 |
| `REM_NEXT_HOSTNAME` | 传给 Next 的主机名（勿含端口）；见 `.env.example`。 |

前端排障与实现细节见 **`web/docs/FRONTEND_PITFALLS.md`**。
独立 3D 验收页见 **`/demo`**。

## 项目目录

```
rem-ai/
├── server/
│   ├── server.ts              # 服务入口，负责全局初始化和网关启动
│   ├── gateway/               # HTTP + Next.js + WebSocket 网关（含 /health）
│   ├── session/               # 每连接会话、VAD、turn state、打断接入点
│   └── pipeline/              # runPipeline，LLM/TTS/持久化编排
├── agents/
│   └── conversation_agent.ts  # 对话 Agent 门面
├── brains/
│   ├── brain_router.ts        # 双脑路由（情绪 + 记忆 + 快慢脑调度）
│   ├── fast_brain.ts          # 快脑：低延迟流式 LLM 回复
│   ├── slow_brain.ts          # 慢脑：后台对话分析与长期上下文
│   ├── slow_brain_store.ts    # SlowBrainStore（每连接实例）
│   └── rem_session_context.ts # C1：每连接情绪 + 慢脑 + 历史 + 会话记忆
├── brain/
│   ├── personality.ts         # Rem 人设定义
│   ├── character_rules.ts     # 说话风格规则
│   └── prompt_builder.ts      # Prompt 组装（人设 + 规则 + 情绪 + 记忆 + 历史）
├── llm/
│   └── qwen_client.ts         # OpenAI 兼容流式 LLM 客户端
├── memory/
│   ├── memory_agent.ts        # 记忆提取（正则匹配 + 慢脑二次提取）
│   ├── memory_store.ts        # 内存 KV 记忆存储（InMemoryRepository）
│   ├── session_memory_overlay.ts # 会话内本地优先 overlay：启动预加载 + 异步写回持久层
│   ├── memory_repository.ts   # MemoryRepository 接口定义
│   └── memory_decay.ts        # 记忆衰减与遗忘（重要性 × 频率 × 时间）
├── emotion/
│   ├── emotion_engine.ts      # 情绪识别（关键词 + 标点）
│   ├── emotion_runtime.ts     # 每连接情绪状态与强度（C1）
│   └── emotion_state.ts       # Emotion 类型别名
├── voice/
│   ├── stt_stream.ts          # STT（Whisper API / whisper-cpp，WebM + PCM 双模式）
│   ├── tts.ts                 # TTS（Edge / Piper / OpenAI 三后端）
│   ├── tts_stream.ts          # TTS 管线封装（支持 AbortSignal + 情绪参数）
│   ├── tts_emotion.ts         # TTS 情绪语音适配（rate / pitch / speed 映射）
│   ├── vad_detector.ts        # 语音活动检测（RMS 能量阈值）
│   └── interrupt_controller.ts # 管线打断控制（AbortSignal 状态机）
├── utils/
│   └── sentence_chunker.ts    # 流式断句（用于逐句 TTS）
├── storage/
│   ├── database.ts            # PostgreSQL 连接池 + 健康检查
│   ├── redis.ts               # Redis 客户端（ioredis）+ 缓存封装
│   ├── schema.sql             # 数据表定义（users / sessions / messages / memories）
│   ├── types.ts               # 存储层类型（DbUser / DbSession / DbMessage / DbMemory）
│   ├── index.ts               # 存储层统一导出
│   └── repositories/
│       ├── message_repository.ts  # 消息持久化
│       ├── session_repository.ts  # 会话管理
│       └── memory_repository.ts   # 记忆持久化（pgvector 语义检索）
├── infra/
│   ├── auth.ts                # JWT 认证中间件 + WebSocket 认证
│   ├── rate_limiter.ts        # HTTP + WebSocket 限流
│   ├── logger.ts              # pino 结构化日志
│   ├── latency_tracer.ts      # 语音主链路延迟指标（speech_end→stt_final→llm→tts→playback）
│   └── emotion_logger.ts      # 情绪日志（环形缓冲区）
├── avatar/
│   ├── types.ts               # Avatar 驱动协议（FaceParams / Viseme / AvatarFrame）
│   ├── emotion_mapper.ts      # 情绪 → 表情映射 + 平滑过渡
│   ├── action_triggers.ts     # 语义 → 动作触发（点头 / 摇头 / 挥手等）
│   ├── avatar_controller.ts   # Avatar 控制器
│   ├── index.ts               # Avatar 统一导出
│   └── assets/                # SVG 表情头像（neutral/happy/curious/shy/sad）
├── public/                    # 旧版原生 JS 前端
├── web/                       # Next.js 前端
│   ├── docs/                  # 前端踩坑与排障（FRONTEND_PITFALLS.md）
│   ├── src/components/        # RemChatApp、Rem3DAvatar、输入栏等
│   ├── src/hooks/             # useRemChat（WebSocket）、useAudioBase64Queue
│   ├── src/lib/               # wsUrl、rem3d（VRM viewer）等
│   └── src/types/             # 消息类型定义
├── Dockerfile                 # 多阶段构建
├── docker-compose.yml         # App + PostgreSQL + Redis
├── package.json
├── tsconfig.json
├── ARCHITECTURE.md
├── PIPELINE.md
├── OPTIMIZATION.md   # 架构分析、优化清单与完成状态
└── TASKS.md
```

## 开发进度

| 阶段 | 目标 | 状态 |
|------|------|------|
| P0 | 基础对话 + 流式回复 | **已完成** |
| P0 | 双脑架构（快脑 + 慢脑） | **已完成** |
| P0 | WebSocket 实时通信 + 打断控制 | **已完成** |
| P1 | 情绪识别与情感回复 | **已完成** |
| P1 | 语音输入（STT + VAD + 全双工 PCM） | **已完成** |
| P1 | 语音输出（TTS 多后端 + 情绪语调适配） | **已完成** |
| P1 | 内存记忆提取 + 记忆衰减 | **已完成** |
| P1 | SVG 表情头像 + 情绪映射 | **已完成** |
| P1 | Next.js 前端 | **已完成** |
| P2 | 记忆持久化（PostgreSQL + pgvector） | **已完成**（可选启用） |
| P2 | 语义记忆检索（向量数据库） | **已完成**（可选启用） |
| P2 | TTS 情绪语调适配 | **已完成** |
| P2 | 情绪日志记录 | **已完成** |
| P3 | Avatar 驱动协议 + 动作触发 + 控制器 | **已完成** |
| P3 | 口型同步 | 未完成（需音素提取 + 前端 3D 渲染） |
| P4 | JWT 认证 + 限流 | **已完成**（HTTP 限流可继续加强） |
| P4 | 结构化日志（pino） | **已完成** |
| P4 | Docker 容器化部署 | **已完成** |

> 主管线已拆分为 `server/gateway` / `session` / `pipeline`，多数模块已集成；细节见 [ARCHITECTURE.md](ARCHITECTURE.md)。体验与工程向的增量优化（重试、历史 token、情绪惯性、本地消息、**Edge TTS 连接池**、whisper 一次重试等）见 [OPTIMIZATION.md](OPTIMIZATION.md) 顶部 **「已完成优化」** 与 **「尚未完成」**。

## 当前已收口的体验/观测点

- 打断语义已收口：真实用户打断与 slow-brain cancel 已分离。
- turn lifecycle 已收口：`interrupt`、`chat_end`、`assistant_speaking`、`confirmed_end` 的职责不再混用。
- latency tracer 已固定输出 shape，便于做前后版本对比。
- duplex harness 已固定场景名，便于回归比较。
