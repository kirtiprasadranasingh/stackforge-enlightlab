import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertOriginAllowed, getCORSHeaders, checkRateLimit, getClientIP } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const LeadSchema = z.object({
  email: z.string().email(),
  intent: z.enum(['email-stack', 'talk-to-team']).default('email-stack'),
  summary: z.string().max(2000).optional(),
  fileCount: z.number().int().min(0).max(100).optional(),
});

export async function OPTIONS(request: NextRequest) {
  const gate = assertOriginAllowed(request);
  if (!gate.ok) return new NextResponse(null, { status: gate.status });
  return new NextResponse(null, {
    status: 204,
    headers: getCORSHeaders(request.headers.get('origin')),
  });
}

/**
 * Soft post-generation lead capture (ungated generation stays on /api/generate).
 * Forwards to LEAD_CAPTURE_ENDPOINT when configured; otherwise acknowledges locally.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const cors = getCORSHeaders(origin);

  const gate = assertOriginAllowed(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status, headers: cors });
  }

  const rate = await checkRateLimit(`lead:${getClientIP(request)}`);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: cors });
  }

  const body = await request.json().catch(() => null);
  const parsed = LeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid lead payload' }, { status: 400, headers: cors });
  }

  const endpoint = process.env.LEAD_CAPTURE_ENDPOINT;
  if (endpoint) {
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...parsed.data,
          source: 'stackforge',
          capturedAt: new Date().toISOString(),
        }),
      });
    } catch (err) {
      console.error('Lead forward failed:', err);
    }
  } else {
    console.info('[lead]', parsed.data.intent, parsed.data.email);
  }

  return NextResponse.json({ ok: true }, { headers: cors });
}
