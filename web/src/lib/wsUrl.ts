/**
 * WebSocket URL for Rem backend.
 * Uses /ws path to avoid conflicting with Next.js HMR WebSocket.
 * Override via NEXT_PUBLIC_WS_URL=ws://localhost:3000/ws
 */
export function getRemWsUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_WS_URL;
  if (fromEnv) return fromEnv;
  if (typeof window === "undefined") return "";
  return `ws://${window.location.host}/ws`;
}
