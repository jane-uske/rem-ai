import "dotenv/config";
import type { WebSocket } from "ws";
import type { IncomingMessage } from "http";

import { createLogger } from "../infra/logger";
import { startDecayTimer, stopDecayTimer } from "../memory/memory_decay";
import { getMemoryRepository } from "../memory/memory_store";
import { initDatabase, closeDatabase } from "../storage/database";
import { initRedis, closeRedis } from "../storage/redis";
import { createGateway, startServer, PORT } from "./gateway";
import { createSession, setDbReady as setSessionDbReady } from "./session";
import { setDbReady as setPipelineDbReady } from "./pipeline";

const logger = createLogger("server");

// Global state for optional storage
let dbReady = false;
let redisReady = false;

async function bootstrap() {
  // Start memory decay timer
  const decayTimer = startDecayTimer(getMemoryRepository());
  logger.info("[Memory] Decay timer started");

  // Optional storage initialization
  if (process.env.DATABASE_URL) {
    try {
      await initDatabase();
      dbReady = true;
      setSessionDbReady(true);
      setPipelineDbReady(true);
      logger.info("[Storage] PostgreSQL initialized");
    } catch (err) {
      logger.warn("[Storage] PostgreSQL init failed (continuing without)", { error: err });
      dbReady = false;
    }
  } else {
    logger.info("[Storage] DATABASE_URL not set, using in-memory only");
  }

  if (process.env.REDIS_URL) {
    try {
      await initRedis();
      redisReady = true;
      logger.info("[Storage] Redis initialized");
    } catch (err) {
      logger.warn("[Storage] Redis init failed (continuing without)", { error: err });
      redisReady = false;
    }
  }

  // Graceful shutdown
  process.on("SIGINT", () => {
    logger.info("[Shutdown] Received SIGINT, cleaning up...");
    stopDecayTimer(decayTimer);
    if (dbReady) void closeDatabase().catch(() => {});
    if (redisReady) void closeRedis().catch(() => {});
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    logger.info("[Shutdown] Received SIGTERM, cleaning up...");
    stopDecayTimer(decayTimer);
    if (dbReady) void closeDatabase().catch(() => {});
    if (redisReady) void closeRedis().catch(() => {});
    process.exit(0);
  });

  // Create and start gateway
  function onConnection(ws: WebSocket, req: IncomingMessage): void {
    createSession(ws, req);
  }

  const server = await createGateway({ onConnection });
  startServer(server);
}

bootstrap().catch((err) => {
  logger.error("[Rem AI] 启动失败", { error: err });
  process.exit(1);
});

export { PORT };
