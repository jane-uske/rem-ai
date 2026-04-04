import http from "http";
import path from "path";
import { parse } from "node:url";
import type { NextUrlWithParsedQuery } from "next/dist/server/request-meta";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import type { IncomingMessage } from "http";

import { createLogger } from "../../infra/logger";
import { verifyToken, wsAuthenticateOnce } from "../../infra/auth";
import { createWsRateLimiter } from "../../infra/rate_limiter";
import type { ServerMessage } from "./types";

const logger = createLogger("gateway");

/** 与 `listen`、传给 Next 的 `port` 一致；可通过环境变量覆盖（见 README `PORT`） */
export const PORT = (() => {
  const n = Number(process.env.PORT);
  return Number.isFinite(n) && n > 0 && n < 65536 ? Math.floor(n) : 3000;
})();

/**
 * Next 的 `hostname` 只能是主机名，不能含端口。误设 `localhost:3000` 或完整 URL 会导致畸形绝对链接/重定向。
 */
function remNextHostname(): string {
  const raw = process.env.REM_NEXT_HOSTNAME?.trim();
  if (!raw) return "localhost";
  try {
    const u = raw.includes("://") ? new URL(raw) : new URL(`http://${raw}`);
    return u.hostname || "localhost";
  } catch {
    return "localhost";
  }
}
const dev = process.env.NODE_ENV !== "production";
const webDir = path.join(process.cwd(), "web");

/** 少数客户端/代理会把完整 URL 放进 `req.url`，必须先收成 `/path?query`，否则 Next 会拼出畸形重定向 */
function normalizeIncomingUrl(raw: string | undefined): string {
  if (!raw) return "/";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      const u = new URL(raw);
      return u.pathname + u.search;
    } catch {
      return "/";
    }
  }
  return raw;
}

/**
 * Next 文档与内部实现均以 `url.parse(req.url, true)` 为准；须配合 **await handle()**（handler 为 async）。
 */
function parseRequestUrl(req: IncomingMessage): NextUrlWithParsedQuery {
  return parse(normalizeIncomingUrl(req.url), true) as NextUrlWithParsedQuery;
}

function requestPathname(req: IncomingMessage): string {
  return parseRequestUrl(req).pathname ?? "/";
}

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
  const { query: qs } = parseRequestUrl(req);
  const t = qs.token;
  if (typeof t === "string") return t;
  if (Array.isArray(t) && typeof t[0] === "string") return t[0];
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
  /** 与 `listen(PORT)` 一致，供 Next 拼规范 URL。勿用系统环境变量 `HOST`（常为机器名）。 */
  const nextApp = next({
    dev,
    dir: webDir,
    hostname: remNextHostname(),
    port: PORT,
  });
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

      const { pathname } = parseRequestUrl(req);

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

      const parsedUrl = parseRequestUrl(req);
      await handle(req, res, parsedUrl);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      logger.error("[HTTP]", { err: message, stack });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    }
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const pathname = requestPathname(req);
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
  server.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.error("[Rem AI] 端口已被占用，请结束占用该端口的进程或修改 .env 中的 PORT", {
        port: PORT,
      });
    } else {
      logger.error("[Rem AI] HTTP 监听失败", { err: err.message, code: err.code });
    }
    process.exit(1);
  });
  server.listen(PORT, () => {
    logger.info(`[Rem AI] 服务已启动 — http://localhost:${PORT}`);
    if (dev) {
      logger.info(`[Rem AI] Next.js 开发模式`, { dir: webDir });
    }
  });
}
