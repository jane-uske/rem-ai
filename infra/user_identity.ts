import { createHash } from "crypto";
import type { IncomingMessage } from "http";

import { verifyToken } from "./auth";

export const DEV_STORAGE_USER_ID = "00000000-0000-4000-8000-000000000001";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stableUuidFromString(input: string): string {
  const hash = createHash("sha256").update(input).digest("hex");
  const timeLow = hash.slice(0, 8);
  const timeMid = hash.slice(8, 12);
  const timeHighAndVersion = `5${hash.slice(13, 16)}`;
  const clockSeq = ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, "0");
  const clockSeqLow = hash.slice(18, 20);
  const node = hash.slice(20, 32);
  return `${timeLow}-${timeMid}-${timeHighAndVersion}-${clockSeq}${clockSeqLow}-${node}`.toLowerCase();
}

function extractBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

function extractQueryToken(req: IncomingMessage): string | null {
  const raw = req.url;
  if (!raw) return null;
  try {
    const url = new URL(raw, "http://localhost");
    const token = url.searchParams.get("token");
    return token?.trim() || null;
  } catch {
    return null;
  }
}

export function normalizeToStorageUserId(rawUserId?: string | null): string {
  const trimmed = rawUserId?.trim();
  if (!trimmed) return DEV_STORAGE_USER_ID;
  if (UUID_RE.test(trimmed)) return trimmed.toLowerCase();
  return stableUuidFromString(`rem-user:${trimmed}`);
}

export function resolveRequestUserId(req: IncomingMessage): string {
  const token = extractQueryToken(req) ?? extractBearerToken(req);
  const payload = token ? verifyToken(token) : null;
  return normalizeToStorageUserId(payload?.id);
}
