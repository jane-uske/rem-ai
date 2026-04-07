import "dotenv/config";
import type { WebSocket } from "ws";
import type { IncomingMessage } from "http";

import { createLogger } from "../infra/logger";
import { setDbReady, setRedisReady } from "../infra/app_state";
import { startDecayTimer, stopDecayTimer } from "../memory/memory_decay";
import { getMemoryRepository, setMemoryRepository } from "../memory/memory_store";
import { initDatabase, closeDatabase } from "../storage/database";
import { initRedis, closeRedis } from "../storage/redis";
import { getPgMemoryRepository } from "../storage/repositories/pg_memory_repository";
import { shutdownWhisperServer, warmWhisperServer } from "../voice/stt_stream";
import { warmupEdgeTtsConnections } from "../voice/tts";
import { createGateway, startServer, PORT } from "./gateway";
import { createSession } from "./session";

const logger = createLogger("server");

let dbInitialized = false;
let redisInitialized = false;

async function bootstrap() {
  let memoryRepo = getMemoryRepository();

  if (process.env.DATABASE_URL) {
    try {
      await initDatabase();
      dbInitialized = true;
      setDbReady(true);
      const pgRepo = getPgMemoryRepository("dev");
      setMemoryRepository(pgRepo);
      memoryRepo = pgRepo;
      logger.info("[Storage] PostgreSQL initialized, using PG memory repo");
    } catch (err) {
      logger.warn("[Storage] PostgreSQL init failed (continuing without)", { error: err });
      dbInitialized = false;
    }
  } else {
    logger.info("[Storage] DATABASE_URL not set, using in-memory only");
  }

  const decayTimer = startDecayTimer(memoryRepo);
  logger.info("[Memory] Decay timer started");

  if (process.env.REDIS_URL) {
    try {
      await initRedis();
      redisInitialized = true;
      setRedisReady(true);
      logger.info("[Storage] Redis initialized");
    } catch (err) {
      logger.warn("[Storage] Redis init failed (continuing without)", { error: err });
      redisInitialized = false;
    }
  }

  await warmWhisperServer().catch((err) => {
    logger.warn("[STT] whisper-server warmup skipped", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // 预热 Edge TTS 连接池，提前建立 2 个空闲连接
  await warmupEdgeTtsConnections(2).catch((err) => {
    logger.warn("[TTS] Edge TTS 连接预热跳过", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  logger.info("[TTS] Edge TTS 连接预热完成");

  let shuttingDown = false;
  const cleanupAndExit = async (signal: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[Shutdown] Received ${signal}, cleaning up...`);
    stopDecayTimer(decayTimer);
    await shutdownWhisperServer().catch(() => {});
    if (dbInitialized) await closeDatabase().catch(() => {});
    if (redisInitialized) await closeRedis().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => { void cleanupAndExit("SIGINT"); });
  process.on("SIGTERM", () => { void cleanupAndExit("SIGTERM"); });

  function onConnection(ws: WebSocket, req: IncomingMessage): void {
    createSession(ws, req);
  }

  const server = await createGateway({ onConnection });
  startServer(server);
}

bootstrap().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error("[Rem AI] 启动失败", { err: message, stack });
  process.exit(1);
});

export { PORT };
