import { RequestHandler } from "express";
import jwt from "jsonwebtoken";

interface UserPayload {
  id: string;
  iat: number;
  exp: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

function getSecret(): string | null {
  return process.env.JWT_SECRET || null;
}

const DEV_USER: UserPayload = { id: "dev", iat: 0, exp: 0 };

export function authMiddleware(): RequestHandler {
  return (req, res, next) => {
    const secret = getSecret();
    if (!secret) {
      req.user = DEV_USER;
      return next();
    }

    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing token" });
      return;
    }

    const token = header.slice(7);
    try {
      const payload = jwt.verify(token, secret) as UserPayload;
      req.user = payload;
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}

export function generateToken(userId: string): string {
  const secret = getSecret();
  if (!secret) throw new Error("JWT_SECRET not configured");
  return jwt.sign({ id: userId }, secret, { expiresIn: "24h" });
}

export function verifyToken(token: string): { id: string } | null {
  const secret = getSecret();
  if (!secret) return null;
  try {
    const payload = jwt.verify(token, secret) as { id: string };
    return { id: payload.id };
  } catch {
    return null;
  }
}

export function wsAuthenticateOnce(token: string): { id: string } | null {
  const secret = getSecret();
  if (!secret) return { id: "dev" };
  return verifyToken(token);
}
