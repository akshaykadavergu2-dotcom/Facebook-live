import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://streamkarolive.netlify.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

export function getAllowedOrigins(): Set<string> {
  const allowed = new Set<string>(DEFAULT_ALLOWED_ORIGINS);
  const rawList = [
    process.env.ALLOWED_CORS_ORIGIN || '',
    process.env.FRONTEND_ORIGIN || '',
    process.env.APP_URL || '',
  ]
    .join(',')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  for (const origin of rawList) {
    allowed.add(origin);
  }
  return allowed;
}

export function isOriginAllowed(
  origin: string | undefined,
  hostHeader: string | undefined,
  forwardedHostHeader?: string | string[],
): boolean {
  if (!origin) return true;
  const normalized = origin.trim().replace(/\/+$/, '');
  const allowed = getAllowedOrigins();
  if (allowed.has('*') || allowed.has(normalized)) {
    return true;
  }
  if (
    /^https:\/\/[a-z0-9-]+--streamkarolive\.netlify\.app$/i.test(normalized) ||
    /^https:\/\/[a-z0-9-]+\.ai\.studio$/i.test(normalized) ||
    /^https:\/\/[a-z0-9.-]+\.run\.app$/i.test(normalized)
  ) {
    return true;
  }

  const hosts = [
    hostHeader,
    Array.isArray(forwardedHostHeader) ? forwardedHostHeader[0] : forwardedHostHeader,
  ].filter(Boolean) as string[];

  for (const h of hosts) {
    const cleanHost = h.split(',')[0].trim();
    if (normalized === `https://${cleanHost}` || normalized === `http://${cleanHost}`) {
      return true;
    }
  }
  return false;
}

function hasValidBackendAccessToken(req: Request): boolean {
  const expected = process.env.BACKEND_ACCESS_TOKEN?.trim();
  if (!expected) return false;
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const candidate = authHeader.slice(7).trim();
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

function isLoopbackIp(ip: string | undefined): boolean {
  if (!ip) return false;
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.startsWith('127.')
  );
}

function extractRefererOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

export function requireAllowedOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin && !isOriginAllowed(origin, req.headers.host, req.headers['x-forwarded-host'])) {
    res.status(403).json({
      error: 'Origin not allowed by backend security policy.',
    });
    return;
  }

  const secFetchSite = req.headers['sec-fetch-site'];
  if (!origin && secFetchSite === 'cross-site') {
    const refererOrigin = extractRefererOrigin(req.headers.referer);
    if (!refererOrigin || !isOriginAllowed(refererOrigin, req.headers.host, req.headers['x-forwarded-host'])) {
      res.status(403).json({
        error: 'Cross-site request blocked by backend security policy.',
      });
      return;
    }
  }

  next();
}

export function requireControlAccess(req: Request, res: Response, next: NextFunction): void {
  if (hasValidBackendAccessToken(req)) {
    next();
    return;
  }

  const origin = req.headers.origin;
  const clientHeader = req.headers['x-livecast-client'];
  const hasClientHeader =
    typeof clientHeader === 'string' && clientHeader.trim() === 'livecast-web';

  if (origin) {
    if (!isOriginAllowed(origin, req.headers.host, req.headers['x-forwarded-host'])) {
      res.status(403).json({
        error: 'Origin not allowed to control streaming operations.',
      });
      return;
    }
    if (!hasClientHeader) {
      res.status(403).json({
        error: 'Missing required studio client header for streaming control.',
      });
      return;
    }
    next();
    return;
  }

  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site') {
    res.status(403).json({
      error: 'Cross-site control request rejected.',
    });
    return;
  }

  if (secFetchSite === 'same-origin' && hasClientHeader) {
    next();
    return;
  }

  const refererOrigin = extractRefererOrigin(req.headers.referer);
  if (
    refererOrigin &&
    isOriginAllowed(refererOrigin, req.headers.host, req.headers['x-forwarded-host']) &&
    hasClientHeader
  ) {
    next();
    return;
  }

  if (process.env.NODE_ENV !== 'production' || isLoopbackIp(req.ip)) {
    next();
    return;
  }

  res.status(403).json({
    error: 'Direct unverified control requests are blocked in production. Use the authorized studio frontend.',
  });
}
