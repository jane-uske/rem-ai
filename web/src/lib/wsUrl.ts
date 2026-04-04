/**
 * WebSocket URL for Rem backend（/ws）。
 *
 * - 一体启动（根目录 `npm run dev`）：页面与 API 同端口，用 `ws://当前 host/ws` 即可。
 * - 仅前端（`npm run web:dev`）：Next 常在 **3001**，而后端仍在 **3000**，需指向 3000 或设置 `NEXT_PUBLIC_WS_URL`。
 *
 * 环境变量须为绝对 WebSocket URL。若写成 `localhost:3000/ws`（无 `ws://`），浏览器会当成相对路径，
 * 解析成 `http(s)://当前页/localhost:3000/ws`，地址栏易出现 `/localhost:3000/...` 嵌套。
 */
function normalizeEnvWsUrl(raw: string): string {
  const t = raw.trim();
  if (/^(ws|wss):\/\//i.test(t)) return t;
  // host:port/path → ws://host:port/path
  if (/^[\w.-]+:\d+(\/.*)?$/i.test(t)) return `ws://${t}`;
  return t;
}

export function getRemWsUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_WS_URL;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
    return normalizeEnvWsUrl(fromEnv);
  }
  if (typeof window === "undefined") return "";

  const hostname = window.location.hostname;
  const port = window.location.port;

  // Next 单独 dev 常见 3001/3002；后端默认 PORT=3000
  if (port === "3001" || port === "3002") {
    return `ws://${hostname}:3000/ws`;
  }

  return `ws://${window.location.host}/ws`;
}
