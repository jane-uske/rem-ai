# Rem AI

实时 AI 陪伴系统 —— 能聊天、有记忆、懂情绪、能说话、有形象。

## 核心功能

- **自然语言对话** — 双脑架构（Fast Brain 低延迟流式回复 + Slow Brain 后台深度分析），支持多轮上下文
- **用户记忆** — 从对话中自动提取用户信息（姓名、城市、职业、偏好等），注入后续对话
- **情绪系统** — 基于关键词识别用户情绪，维护 AI 情绪状态（neutral / happy / curious / shy / sad），影响回复风格
- **语音输入（STT）** — 支持 Whisper API 和 whisper-cpp，实时双工 PCM 流式传输 + VAD 语音活动检测
- **语音输出（TTS）** — 支持 Edge TTS / Piper / OpenAI TTS 三种后端，逐句流式合成
- **虚拟形象** — SVG 表情头像，根据情绪状态实时切换（5 种表情）
- **实时通信** — WebSocket 全双工通信，支持打断控制、流式 token 推送、音频流传输

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js + TypeScript |
| HTTP 框架 | Express |
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

# 配置环境变量
cp .env.example .env   # 然后编辑 .env 填入 API Key 等

# 启动后端（端口 3000）
npm run dev

# 启动前端（另一个终端）
npm run web:dev
```

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

## 项目目录

```
rem-ai/
├── server/
│   └── server.ts              # Express + WebSocket 入口，管线编排
├── agents/
│   └── conversation_agent.ts  # 对话 Agent 门面
├── brains/
│   ├── brain_router.ts        # 双脑路由（情绪 + 记忆 + 快慢脑调度）
│   ├── fast_brain.ts          # 快脑：低延迟流式 LLM 回复
│   ├── slow_brain.ts          # 慢脑：后台对话分析与长期上下文
│   └── slow_brain_store.ts    # 慢脑上下文存储
├── brain/
│   ├── personality.ts         # Rem 人设定义
│   ├── character_rules.ts     # 说话风格规则
│   └── prompt_builder.ts      # Prompt 组装（人设 + 规则 + 情绪 + 记忆 + 历史）
├── llm/
│   └── qwen_client.ts         # OpenAI 兼容流式 LLM 客户端
├── memory/
│   ├── memory_agent.ts        # 记忆提取（正则匹配 + 慢脑二次提取）
│   ├── memory_store.ts        # 内存 KV 记忆存储（InMemoryRepository）
│   ├── memory_repository.ts   # MemoryRepository 接口定义
│   └── memory_decay.ts        # 记忆衰减与遗忘（重要性 × 频率 × 时间）
├── emotion/
│   ├── emotion_engine.ts      # 情绪识别（关键词 + 标点）+ 衰减
│   └── emotion_state.ts       # 情绪状态管理（5 种状态）
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
│   ├── src/components/        # React 组件（聊天窗口、输入栏、头像、语音指示器）
│   ├── src/hooks/             # useRemChat（WebSocket）、useAudioBase64Queue
│   ├── src/lib/               # 音频工具、PCM 采集、WebSocket URL
│   └── src/types/             # 消息类型定义
├── Dockerfile                 # 多阶段构建
├── docker-compose.yml         # App + PostgreSQL + Redis
├── package.json
├── tsconfig.json
├── ARCHITECTURE.md
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
| P2 | 记忆持久化（PostgreSQL + pgvector） | **已完成**（待 wiring） |
| P2 | 语义记忆检索（向量数据库） | **已完成**（待 wiring） |
| P2 | TTS 情绪语调适配 | **已完成**（待 wiring） |
| P2 | 情绪日志记录 | **已完成**（待 wiring） |
| P3 | Avatar 驱动协议 + 动作触发 + 控制器 | **已完成**（待 wiring） |
| P3 | 口型同步 | 未完成（需音素提取 + 前端 3D 渲染） |
| P4 | JWT 认证 + 限流 | **已完成**（待 wiring） |
| P4 | 结构化日志（pino） | **已完成**（待 wiring） |
| P4 | Docker 容器化部署 | **已完成** |

> **待 wiring**：模块代码已完成，需要集成到 `server/server.ts` 主管线中。
