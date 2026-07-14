import { RateLimiterMemory } from 'rate-limiter-flexible';

/**
 * Rate limiting + locked request origin for StackForge
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

function defaultAllowedOrigins(): string[] {
  const fromEnv = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');

  const defaults = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
  ];

  if (appUrl) defaults.push(appUrl);

  // Production Enlight Labs domains (locked origin — no wildcard)
  defaults.push(
    'https://enlightlabs.com',
    'https://www.enlightlabs.com',
    'https://stackforge.enlightlabs.com'
  );

  return Array.from(new Set([...defaults, ...fromEnv]));
}

export function getAllowedOrigins(): string[] {
  return defaultAllowedOrigins();
}

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return getAllowedOrigins().includes(origin);
}

/**
 * Hard origin lock for the generate API.
 * Same-origin browser requests send Origin; reject unknown origins.
 * Missing Origin allowed only in development (curl/local tooling).
 */
export function assertOriginAllowed(request: Request): { ok: true } | { ok: false; status: number; error: string } {
  const origin = request.headers.get('origin');
  const isDev = process.env.NODE_ENV !== 'production';

  if (!origin) {
    if (isDev || process.env.ALLOW_NO_ORIGIN === 'true') {
      return { ok: true };
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
