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
    // Demo host — both schemes (TLS rollout / ssl-redirect)
    'http://stackforge.144-24-100-85.nip.io',
    'https://stackforge.144-24-100-85.nip.io',
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

function getRequestHostOrigin(request: Request): string | null {
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, '');
  }

  const host = request.headers.get('host');
  if (host) {
    const proto =
      forwardedProto ||
      (host.includes('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
    return `${proto}://${host}`.replace(/\/$/, '');
  }

  try {
    return new URL(request.url).origin.replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** True when Origin host matches this deployment (handles http/https mismatch behind ingress). */
function isSameDeploymentHost(origin: string, request: Request): boolean {
  try {
    const originHost = new URL(origin).hostname.toLowerCase();
    const hosts = [
      request.headers.get('x-forwarded-host')?.split(',')[0]?.trim(),
      request.headers.get('host')?.split(',')[0]?.trim(),
    ]
      .filter(Boolean)
      .map((h) => h!.split(':')[0].toLowerCase());

    return hosts.includes(originHost);
  } catch {
    return false;
  }
}

/** Allow shared nip.io / sslip.io demo hosts without listing every IP. */
function isTrustedDemoHost(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return (
      host.endsWith('.nip.io') ||
      host.endsWith('.sslip.io') ||
      host.endsWith('.enlightlab.com') ||
      host.endsWith('.enlightlabs.com')
    );
  } catch {
    return false;
  }
}

export function isOriginAllowedForRequest(origin: string | null, request: Request): boolean {
  if (!origin) return false;
  const normalized = origin.replace(/\/$/, '');

  if (isOriginAllowed(normalized)) return true;
  if (isTrustedDemoHost(normalized)) return true;

  const requestOrigin = getRequestHostOrigin(request);
  if (requestOrigin && requestOrigin === normalized) return true;

  // Same host as this request = same-origin UI calling its own API
  return isSameDeploymentHost(normalized, request);
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
    const referer = request.headers.get('referer');
    if (referer) {
      try {
        const refOrigin = new URL(referer).origin;
        if (isOriginAllowedForRequest(refOrigin, request)) return { ok: true };
      } catch {
        /* ignore */
      }
    }
    // Same-deployment Host/X-Forwarded-Host without Origin (some proxies)
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    if (host && (host.includes('nip.io') || host.includes('sslip.io') || host.includes('enlightlab'))) {
      return { ok: true };
    }
    return { ok: false, status: 403, error: 'Forbidden: missing origin' };
  }

  if (!isOriginAllowedForRequest(origin, request)) {
    return { ok: false, status: 403, error: 'Forbidden: origin not allowed' };
  }

  return { ok: true };
}

export function getCORSHeaders(origin?: string | null, request?: Request): HeadersInit {
  const headers: HeadersInit = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };

  if (origin && (request ? isOriginAllowedForRequest(origin, request) : isOriginAllowed(origin))) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}
