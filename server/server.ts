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

  process.on("SIGINT", () => {
    logger.info("[Shutdown] Received SIGINT, cleaning up...");
    stopDecayTimer(decayTimer);
    if (dbInitialized) void closeDatabase().catch(() => {});
    if (redisInitialized) void closeRedis().catch(() => {});
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    logger.info("[Shutdown] Received SIGTERM, cleaning up...");
    stopDecayTimer(decayTimer);
    if (dbInitialized) void closeDatabase().catch(() => {});
    if (redisInitialized) void closeRedis().catch(() => {});
    process.exit(0);
  });

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
