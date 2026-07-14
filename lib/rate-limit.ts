import { RateLimiterMemory } from 'rate-limiter-flexible';

/**
 * Rate limiting + dynamic origin lock for StackForge
 * Works on localhost, fixed domains, and Vercel (prod + preview) without hardcoding every URL.
 */

const RATE_LIMIT_REQUESTS = Number(process.env.RATE_LIMIT_REQUESTS || 8);
const RATE_LIMIT_WINDOW = Number(process.env.RATE_LIMIT_WINDOW_SEC || 60);

export const rateLimiter = new RateLimiterMemory({
  points: RATE_LIMIT_REQUESTS,
  duration: RATE_LIMIT_WINDOW,
});

export async function checkRateLimit(
  identifier: string
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const result = await rateLimiter.consume(identifier);
    return {
      allowed: true,
      remaining: result.remainingPoints,
    };
  } catch (rateLimiterRes) {
    const remaining = Math.round(
      (rateLimiterRes as { msBeforeNext: number }).msBeforeNext / 1000
    );
    return {
      allowed: false,
      remaining: Math.max(0, remaining),
    };
  }
}

export function resetRateLimit(identifier: string): void {
  rateLimiter.delete(identifier);
}

export function getClientIP(request: Request): string {
  const headers = request.headers;
  return (
    headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    headers.get('x-real-ip') ||
    headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

/** Public URL that updates with the active deployment (Vercel-aware). */
export function getPublicAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/$/, '')}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, '')}`;
  }
  return 'http://localhost:3000';
}

function defaultAllowedOrigins(): string[] {
  const fromEnv = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const defaults = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    getPublicAppUrl(),
    'https://enlightlabs.com',
    'https://www.enlightlabs.com',
    'https://enlightlab.com',
    'https://www.enlightlab.com',
    'https://stackforge.enlightlabs.com',
    'https://stackforge.enlightlab.com',
  ];

  if (process.env.VERCEL_URL) {
    defaults.push(`https://${process.env.VERCEL_URL.replace(/\/$/, '')}`);
  }
  if (process.env.VERCEL_BRANCH_URL) {
    defaults.push(`https://${process.env.VERCEL_BRANCH_URL.replace(/\/$/, '')}`);
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    defaults.push(
      `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/$/, '')}`
    );
  }

  return Array.from(new Set([...defaults, ...fromEnv]));
}

export function getAllowedOrigins(): string[] {
  return defaultAllowedOrigins();
}

function isTrustedVercelOrigin(origin: string): boolean {
  // Allow *.vercel.app so preview deploys work without listing every URL
  try {
    const host = new URL(origin).hostname;
    return host === 'vercel.app' || host.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  const normalized = origin.replace(/\/$/, '');
  if (getAllowedOrigins().includes(normalized)) return true;

  const allowVercel =
    process.env.VERCEL === '1' ||
    process.env.ALLOW_VERCEL_ORIGINS === 'true' ||
    process.env.ALLOW_VERCEL_ORIGINS === '1';

  if (allowVercel && isTrustedVercelOrigin(normalized)) return true;

  return false;
}

/**
 * Origin lock for the generate API.
 * Missing Origin allowed in development, or same-origin style calls without Origin
 * when ALLOW_NO_ORIGIN=true.
 */
export function assertOriginAllowed(
  request: Request
): { ok: true } | { ok: false; status: number; error: string } {
  const origin = request.headers.get('origin');
  const isDev = process.env.NODE_ENV !== 'production';

  if (!origin) {
    if (isDev || process.env.ALLOW_NO_ORIGIN === 'true') {
      return { ok: true };
    }
    // Same-origin browser posts sometimes omit Origin on older agents; allow on Vercel
    // when Referer matches our deployment host.
    const referer = request.headers.get('referer');
    if (referer) {
      try {
        const refOrigin = new URL(referer).origin;
        if (isOriginAllowed(refOrigin)) return { ok: true };
      } catch {
        /* ignore */
      }
    }
    return { ok: false, status: 403, error: 'Forbidden: missing origin' };
  }

  if (!isOriginAllowed(origin)) {
    return { ok: false, status: 403, error: 'Forbidden: origin not allowed' };
  }

  return { ok: true };
}

export function getCORSHeaders(origin?: string | null): HeadersInit {
  const headers: HeadersInit = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };

  if (origin && isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}
