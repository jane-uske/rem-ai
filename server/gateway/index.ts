import http from "http";
import path from "path";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import type { IncomingMessage } from "http";

import { createLogger } from "../../infra/logger";
import { verifyToken } from "../../infra/auth";
import { createWsRateLimiter } from "../../infra/rate_limiter";
import type { ServerMessage } from "./types";

const logger = createLogger("gateway");

const PORT = 3000;
const dev = process.env.NODE_ENV !== "production";
const webDir = path.join(process.cwd(), "web");

// Simple HTTP rate limiter (standalone, not Express middleware)
interface HttpBucket {
  count: number;
  windowStart: number;
}
const httpBuckets = new Map<string, HttpBucket>();
const HTTP_WINDOW_MS = 60_000;
const HTTP_MAX_REQUESTS = 100;

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

function checkHttpRateLimit(req: IncomingMessage): boolean {
  const key = getClientIp(req);
  const now = Date.now();
  let bucket = httpBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= HTTP_WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    httpBuckets.set(key, bucket);
  }
  if (bucket.count >= HTTP_MAX_REQUESTS) {
    return false;
  }
  bucket.count += 1;
  return true;
}

function extractAuthToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

export interface GatewayConfig {
  onConnection: (ws: WebSocket, req: IncomingMessage) => void;
}

export function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export async function createGateway(config: GatewayConfig): Promise<HttpServer> {
  const nextApp = next({ dev, dir: webDir });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  const useAuth = !!process.env.JWT_SECRET;

  if (useAuth) {
    logger.info("[Auth] JWT auth enabled");
  } else {
    logger.info("[Auth] JWT auth disabled (dev mode)");
  }

  const server = http.createServer(async (req, res) => {
    try {
      // HTTP rate limiting
      if (!checkHttpRateLimit(req)) {
        logger.warn("[RateLimit] HTTP rate limit exceeded", { ip: getClientIp(req) });
        res.statusCode = 429;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Too many requests" }));
        return;
      }

      // JWT auth check if enabled
      if (useAuth) {
        const token = extractAuthToken(req);
        if (!token) {
          logger.warn("[Auth] Missing token", { ip: getClientIp(req) });
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Missing token" }));
          return;
        }
        const payload = verifyToken(token);
        if (!payload) {
          logger.warn("[Auth] Invalid token", { ip: getClientIp(req) });
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid or expired token" }));
          return;
        }
      }

      const parsedUrl = parse(req.url || "", true);
      void handle(req, res, parsedUrl);
    } catch (err) {
      logger.error("[HTTP]", { error: err });
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  const wsRateLimiter = createWsRateLimiter();

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "");
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });

  wss.on("connection", (ws, req) => {
    config.onConnection(ws, req);
  });

  return server;
}

export function startServer(server: HttpServer): void {
  server.listen(PORT, () => {
    logger.info(`[Rem AI] 服务已启动 — http://localhost:${PORT}`);
    if (dev) {
      logger.info(`[Rem AI] Next.js 开发模式`, { dir: webDir });
    }
  });
}

export { PORT };
