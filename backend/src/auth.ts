import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const COOKIE_NAME = 'livecast_session';

export function isAuthEnabled(): boolean {
  const pw = process.env.STUDIO_ADMIN_PASSWORD?.trim();
  return Boolean(pw && pw.length > 0);
}

function getSessionSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured && configured !== 'replace_with_session_hmac_secret') {
    return configured;
  }
  const fallback = process.env.STUDIO_ADMIN_PASSWORD?.trim() || 'local-dev-session-fallback';
  return crypto.createHash('sha256').update(fallback).digest('hex');
}

export function signSessionToken(issuedAtMs: number): string {
  const payload = String(issuedAtMs);
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('hex');
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [issuedStr, sig] = parts;
  const issuedAt = Number(issuedStr);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > 24 * 60 * 60 * 1000) return false;
  const expected = crypto
    .createHmac('sha256', getSessionSecret())
    .update(issuedStr)
    .digest('hex');
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    result[key] = val;
  }
  return result;
}

export function isRequestAuthenticated(req: Request): boolean {
  if (!isAuthEnabled()) return true;
  const cookies = parseCookies(req.headers.cookie);
  if (verifySessionToken(cookies[COOKIE_NAME])) {
    return true;
  }
  const bearer = req.headers.authorization;
  if (bearer && bearer.startsWith('Bearer ')) {
    const token = bearer.slice(7).trim();
    const expected = process.env.STUDIO_ADMIN_PASSWORD?.trim() || '';
    if (
      token.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    ) {
      return true;
    }
  }
  return false;
}

export function requireStudioAuth(req: Request, res: Response, next: NextFunction): void {
  if (isRequestAuthenticated(req)) {
    next();
    return;
  }
  res.status(401).json({
    error: 'Authentication required. Sign in with your Studio Operator password.',
  });
}

export function setSessionCookie(res: Response, req: Request): void {
  const token = signSessionToken(Date.now());
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const isCrossOrigin = Boolean(req.headers.origin);
  const useNone = isHttps && isCrossOrigin;

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: useNone ? 'none' : 'lax',
    secure: isHttps || process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response, req: Request): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const isCrossOrigin = Boolean(req.headers.origin);
  res.clearCookie(COOKIE_NAME, {
    path: '/',
    sameSite: isHttps && isCrossOrigin ? 'none' : 'lax',
    secure: isHttps || process.env.NODE_ENV === 'production',
  });
}

export function verifyOperatorPassword(candidate: string): boolean {
  const expected = process.env.STUDIO_ADMIN_PASSWORD?.trim() || '';
  if (!expected) return true;
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}
