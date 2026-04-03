import http from "http";
import path from "path";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import type { IncomingMessage } from "http";

import { createLogger } from "../../infra/logger";
import { createWsRateLimiter } from "../../infra/rate_limiter";
import type { ServerMessage } from "./types";

const logger = createLogger("gateway");

const PORT = 3000;
const dev = process.env.NODE_ENV !== "production";
const webDir = path.join(process.cwd(), "web");

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

  const server = http.createServer((req, res) => {
    try {
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
