# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

Rem Companion AI is a real-time AI companion with chat, memory, emotion, voice, and 3D avatar features. See `README.md` for full details.

### Running services

`npm run dev` starts the **backend + Next.js frontend together** on port 3000 (the gateway embeds Next.js). There is no need to run `npm run web:dev` separately during normal development — that command is only useful if you want to run the frontend on a separate port (3001).

### Lint / typecheck / test

| Task | Command |
|------|---------|
| Backend typecheck | `npm run typecheck` |
| Frontend lint (ESLint) | `npm run lint --prefix web` |

There are no automated test suites in this repository.

### Environment variables

Copy `.env.example` to `.env`. The only **required** variables for the server to start are `key`, `base_url`, and `model` (LLM API credentials). Without them the server still boots, but chat will fail. PostgreSQL (`DATABASE_URL`) and Redis (`REDIS_URL`) are optional — the app falls back to in-memory storage gracefully.

### Gotchas

- `nodemon` is a devDependency required by the `npm run dev` script. If `npm install` was run without it, the dev server won't start.
- The gateway integrates Next.js directly via the `next` programmatic API (see `server/gateway/index.ts`), so a single `npm run dev` process serves both the HTTP/WebSocket backend and the Next.js frontend on the same port.
- The backend uses `ts-node` to run TypeScript directly; there is no build step needed for development.
