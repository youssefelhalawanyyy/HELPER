import crypto from 'node:crypto';
import os from 'node:os';
import type { NextFunction, Request, Response } from 'express';

export class AuthManager {
  readonly pin: string;
  readonly token: string;
  private pairAttempts = new Map<string, { count: number; resetAt: number }>();

  constructor(token: string) {
    this.token = token;
    this.pin = String(crypto.randomInt(100000, 999999));
  }

  verifyToken(candidate: string | undefined | null): boolean {
    if (!candidate || candidate.length !== this.token.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(this.token));
    } catch {
      return false;
    }
  }

  verifyPin(candidate: string | undefined | null, clientIp: string): { ok: boolean; rateLimited?: boolean } {
    const now = Date.now();
    const record = this.pairAttempts.get(clientIp);
    if (record && now < record.resetAt) {
      if (record.count >= 10) {
        return { ok: false, rateLimited: true };
      }
      record.count += 1;
    } else {
      this.pairAttempts.set(clientIp, { count: 1, resetAt: now + 60_000 });
    }

    if (!candidate || candidate.length !== this.pin.length) return { ok: false };
    try {
      const ok = crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(this.pin));
      if (ok) this.pairAttempts.delete(clientIp);
      return { ok };
    } catch {
      return { ok: false };
    }
  }

  extractTokenFromRequest(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    const headerToken = req.headers['x-devdeck-token'];
    if (typeof headerToken === 'string') {
      return headerToken.trim();
    }
    if (typeof req.query.token === 'string') {
      return req.query.token.trim();
    }
    return null;
  }

  requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    const token = this.extractTokenFromRequest(req);
    if (!this.verifyToken(token)) {
      res.status(401).json({ ok: false, error: 'Unauthorized: invalid or missing pairing token' });
      return;
    }
    next();
  };
}

export function getLocalLanIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const list = interfaces[name];
    if (!list) continue;
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}
