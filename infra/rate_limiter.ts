import type { Request, RequestHandler, Response } from "express";

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const DEFAULT_HTTP: RateLimitConfig = { windowMs: 60_000, maxRequests: 100 };
const DEFAULT_WS: RateLimitConfig = { windowMs: 10_000, maxRequests: 30 };

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

function pruneStale(now: number, windowMs: number): void {
  const stale = windowMs * 2;
  for (const [key, b] of buckets) {
    if (now - b.windowStart > stale) {
      buckets.delete(key);
    }
  }
}

let httpCleanup: ReturnType<typeof setInterval> | undefined;
let httpCleanupRefCount = 0;

function startHttpCleanup(windowMs: number): void {
  httpCleanupRefCount += 1;
  if (httpCleanup) {
    return;
  }
  httpCleanup = setInterval(() => {
    pruneStale(Date.now(), windowMs);
  }, Math.max(windowMs, 5_000));
  if (typeof httpCleanup.unref === "function") {
    httpCleanup.unref();
  }
}

function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

export function createRateLimiter(
  config?: Partial<RateLimitConfig>,
): RequestHandler {
  const windowMs = config?.windowMs ?? DEFAULT_HTTP.windowMs;
  const maxRequests = config?.maxRequests ?? DEFAULT_HTTP.maxRequests;
  startHttpCleanup(windowMs);

  return (req: Request, res: Response, next: () => void) => {
    const key = clientIp(req);
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.windowStart >= windowMs) {
      b = { count: 0, windowStart: now };
      buckets.set(key, b);
    }
    if (b.count >= maxRequests) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    b.count += 1;
    next();
  };
}

export function createWsRateLimiter(
  config?: Partial<RateLimitConfig>,
): { check(key: string): boolean } {
  const windowMs = config?.windowMs ?? DEFAULT_WS.windowMs;
  const maxRequests = config?.maxRequests ?? DEFAULT_WS.maxRequests;
  const store = new Map<string, Bucket>();

  const interval = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of store) {
      if (now - b.windowStart > windowMs * 2) {
        store.delete(k);
      }
    }
  }, Math.max(windowMs, 5_000));
  if (typeof interval.unref === "function") {
    interval.unref();
  }

  return {
    check(key: string): boolean {
      const now = Date.now();
      let b = store.get(key);
      if (!b || now - b.windowStart >= windowMs) {
        b = { count: 0, windowStart: now };
        store.set(key, b);
      }
      if (b.count >= maxRequests) {
        return false;
      }
      b.count += 1;
      return true;
    },
  };
}
