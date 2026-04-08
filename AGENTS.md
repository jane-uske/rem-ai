# Agents

See `README.md` for full project docs and `agent.md` for session context / debugging notes.

## Cursor Cloud specific instructions

### Quick-start commands

| Action | Command |
|--------|---------|
| Install backend deps | `npm install` |
| Install frontend deps | `npm install --prefix web` |
| Backend typecheck | `npm run typecheck` |
| Frontend lint | `cd web && npx eslint .` |
| Start dev server (backend + Next.js) | `npm run dev` |
| Start frontend only | `npm run web:dev` |

### Dev server

`npm run dev` runs the backend (Express + WebSocket on `:3000`) **and** the Next.js frontend together via the gateway (`server/gateway/index.ts`). A separate `npm run web:dev` is only needed for pure frontend-only work (connects to backend via `NEXT_PUBLIC_WS_URL`).

### Environment

Copy `.env.example` to `.env`. The only required env vars for basic startup are none — the server runs gracefully without `key`/`base_url`/`model`, `DATABASE_URL`, or `REDIS_URL`. Without an LLM key, chat will return a fallback message. Edge TTS works out of the box (no API key).

Set `NEXT_PUBLIC_WS_URL=ws://127.0.0.1:3000/ws` in `.env` when running frontend separately from backend.

### Missing modules (as of 2026-04-08)

The repo references a `persona` module (`../persona`) and a frontend `@/lib/rem3d/runtimeAdapter` that were never committed. Stub files were created to unblock development:
- `persona/index.ts` — exports `PersonaState`, `createDefaultPersona`, `buildPersonaPrompt`
- `web/src/lib/rem3d/runtimeAdapter.ts` — exports `createAvatarRuntime`, `AvatarRuntimeAdapter`, `CreateAvatarRuntimeOptions`

### Typecheck

`npm run typecheck` has pre-existing errors related to the `persona` module (TS2307 / TS7006). The backend uses `ts-node` at runtime which works with transpile-only after the stubs are in place.

### WebSocket testing

Quick smoke test via Node.js:
```
node -e "const{WebSocket}=require('ws');const ws=new WebSocket('ws://127.0.0.1:3000/ws');ws.on('open',()=>{ws.send(JSON.stringify({type:'chat',content:'hello'}))});ws.on('message',b=>{const m=JSON.parse(b.toString());console.log(m.type,m.content);if(m.type==='chat_end'){ws.close();process.exit(0)}})"
```
