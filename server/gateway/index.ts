import http from "http";
import path from "path";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import type { IncomingMessage } from "http";

import { createLogger } from "../../infra/logger";
import { verifyToken, wsAuthenticateOnce } from "../../infra/auth";
import { createWsRateLimiter } from "../../infra/rate_limiter";
import type { ServerMessage } from "./types";

const logger = createLogger("gateway");

export const PORT = 3000;
const dev = process.env.NODE_ENV !== "production";
const webDir = path.join(process.cwd(), "web");

// ── HTTP rate limiter with periodic GC ──

interface HttpBucket {
  count: number;
  windowStart: number;
}
const httpBuckets = new Map<string, HttpBucket>();
const HTTP_WINDOW_MS = 60_000;
const HTTP_MAX_REQUESTS = 100;

const gcInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of httpBuckets) {
    if (now - bucket.windowStart > HTTP_WINDOW_MS * 2) {
      httpBuckets.delete(key);
    }
  }
}, HTTP_WINDOW_MS);
if (typeof gcInterval.unref === "function") gcInterval.unref();

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

function extractWsToken(req: IncomingMessage): string | null {
  const { query: qs } = parse(req.url || "", true);
  if (typeof qs.token === "string") return qs.token;
  return extractAuthToken(req);
}

const AUTH_SKIP_PREFIXES = ["/_next/", "/favicon.ico", "/__nextjs"];

function shouldSkipAuth(pathname: string): boolean {
  return AUTH_SKIP_PREFIXES.some((p) => pathname.startsWith(p));
}

export interface GatewayConfig {
  onConnection: (ws: WebSocket, req: IncomingMessage) => void;
}

export function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

let wsRateLimiter: ReturnType<typeof createWsRateLimiter>;

export function getWsRateLimiter(): ReturnType<typeof createWsRateLimiter> {
  return wsRateLimiter;
}

export async function createGateway(config: GatewayConfig): Promise<HttpServer> {
  const nextApp = next({ dev, dir: webDir });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  const useAuth = !!process.env.JWT_SECRET;

  if (useAuth) {
    logger.info("[Auth] JWT auth enabled");
  } else {
    logger.info("[Auth] JWT auth disabled (no JWT_SECRET)");
  }

  wsRateLimiter = createWsRateLimiter();

  const server = http.createServer(async (req, res) => {
    try {
      if (!checkHttpRateLimit(req)) {
        logger.warn("[RateLimit] HTTP rate limit exceeded", { ip: getClientIp(req) });
        res.statusCode = 429;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Too many requests" }));
        return;
      }

      const { pathname } = parse(req.url || "", true);

      if (useAuth && !shouldSkipAuth(pathname ?? "/")) {
        const token = extractAuthToken(req);
        if (!token) {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Missing token" }));
          return;
        }
        const payload = verifyToken(token);
        if (!payload) {
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

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "");
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }

    if (useAuth) {
      const token = extractWsToken(req);
      if (!token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const payload = wsAuthenticateOnce(token);
      if (!payload) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
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
