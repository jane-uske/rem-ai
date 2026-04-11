# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Rem Companion AI** — Real-time AI companion system with natural conversation, memory, emotion awareness, voice capabilities, and a virtual avatar. Full-stack TypeScript application with dual-brain architecture (Fast Brain low-latency + Slow Brain background analysis).

## Commands

### Install Dependencies
```bash
npm install
npm install --prefix web
```

### Start Development
```bash
# Start PostgreSQL + Redis (Docker)
./scripts/start-dev-stack.sh

# Start backend dev server (port 3000)
npm run dev:native

# Start frontend dev server (separate terminal)
npm run web:dev

# Full stack dev (both services)
npm run dev
```

### Build
```bash
# Build both backend and frontend
npm run build

# Type checking only
npm run typecheck

# Build frontend only
npm run web:build
```

### Test
```bash
# Run all backend tests
npm test

# Run a single test file
npx mocha --require ts-node/register/transpile-only "test/path/to/test.test.ts"

# Run frontend tests
npm run test --prefix web

# Smoke test (health check + basic connectivity)
node scripts/smoke.mjs
```

### Production Start
```bash
npm start
```

### Utility Commands
```bash
# Clean Next.js cache when development acts strange
npm run dev:web:clean

# Restart backend server
npm run restart

# Stop dev infrastructure
./scripts/stop-dev-stack.sh
```

## High-Level Architecture

### Core Layers
```
Client (Next.js) → Gateway (HTTP + WebSocket) → Session (per-connection state) → Pipeline (core execution)
```

### Key Architectural Pattern: Dual-Brain System
- **Fast Brain** (`brains/fast_brain.ts`): Low-latency streaming response path for immediate user interaction
- **Slow Brain** (`brains/slow_brain.ts`): Background async analysis for long-term context and memory refinement
- **Brain Router** (`brains/brain_router.ts`): Central orchestrator coordinating both brains

### Key Modules

| Module | Purpose | Location |
|--------|---------|----------|
| Gateway | HTTP + WebSocket connection handling | `server/gateway/` |
| Session | Per-connection state management (STT/VAD/interrupt/avatar) | `server/session/` |
| Pipeline | Core conversation execution pipeline | `server/pipeline/` |
| Brain Prompt | Personality + prompt assembly | `brain/` |
| Emotion | Emotion recognition and state management | `emotion/` |
| Memory | Memory extraction, storage, decay, retrieval | `memory/` |
| Voice | STT (Whisper), VAD, TTS (multi-backend), interrupt control | `voice/` |
| LLM | OpenAI-compatible streaming client | `llm/` |
| Avatar | Virtual avatar control and emotion mapping | `avatar/` |
| Storage | PostgreSQL + pgvector, Redis | `storage/` |
| Infra | Auth, rate limiting, logging | `infra/` |
| Frontend | Next.js 15 + React 19 + Tailwind + Three.js VRM | `web/` |

### Conversation Flow (Voice Input → Voice Output)

1. **User speaks** → PCM audio streamed via WebSocket (`duplex_start` + `audio_stream` chunks)
2. **VAD detects speech** → `speech_start` interrupts any ongoing generation
3. **VAD detects silence** (`speech_end`) → triggers STT transcription
4. **STT returns text** → `runPipeline()` executes
5. **Emotion updated** → emotion pushed to client → avatar updates expression
6. **Memory extracted** → relevant memories retrieved
7. **Fast Brain** → assembles prompt → streams LLM tokens to client
8. **Sentence Chunker** → complete sentences → TTS → audio chunks pushed to client
9. **Slow Brain** → async background analysis of full conversation
10. **chat_end** → text stream complete; client continues playing audio
11. **Playback complete** → client confirms `confirmed_end` → emotion decay

### Key Features

- **Memory System**: Automatic extraction of user preferences from conversation, persistent storage with PostgreSQL + pgvector, memory decay/forgetting
- **Emotion System**: 5 emotion states (neutral/happy/curious/shy/sad) with keyword recognition, affects reply style and TTS prosody
- **Voice**: Full-duplex STT with VAD, multi-backend TTS (Edge/Piper/OpenAI) with emotion adaptation, interrupt control
- **Turn-Taking**: VAD + transcript + semantic combined judgment to reduce premature replies, state machine: `hold` → `likely_end` → `confirmed_end`
- **Avatar**: Emotion-driven expression mapping, action trigger detection (nodding/shaking/etc), 3D VRM support in Next.js frontend

### Feature Flags (Environment Variables)

| Flag | Default | Purpose |
|------|---------|---------|
| `REM_SLOW_BRAIN_ENABLED` | `1` | Enable/disable slow brain background analysis |
| `REM_PERSISTENT_MEMORY_OVERLAY_ENABLED` | `1` | Enable persistent memory overlay (PostgreSQL) |
| `REM_AVATAR_INTENT_ENABLED` | `1` | Enable reply-based avatar intent inference |
| `STT_PARTIAL_PREDICTION_ENABLED` | `0` | Enable partial transcript prediction |

### Important Files

- `server/server.ts` - Main entry point (~80 lines)
- `server/pipeline/runner.ts` - Core pipeline execution
- `brains/brain_router.ts` - Dual-brain orchestration
- `brain/prompt_builder.ts` - Prompt assembly
- `memory/memory_agent.ts` - Memory extraction logic
- `voice/interrupt_controller.ts` - Interrupt state machine
- `server/session/turn_taking.ts` - Turn-taking state management
- `web/src/hooks/useRemChat.ts` - Frontend WebSocket management

### Documentation

- `ARCHITECTURE.md` - Full detailed system architecture with diagrams
- `PIPELINE.md` - Step-by-step pipeline breakdown
- `MEMORY_SYSTEM.md` - Memory system documentation
- `OPTIMIZATION.md` - Optimization roadmap and completed work
- `README.md` - Project overview, setup instructions, environment variables reference

## Code Organization

- **TypeScript** throughout (backend + frontend)
- Uses npm workspaces (root + web)
- CommonJS for backend, ES modules for Next.js frontend
- Testing with Mocha + Chai
- Structured logging with Pino
```
