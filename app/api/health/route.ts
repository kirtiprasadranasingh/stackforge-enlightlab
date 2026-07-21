import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lightweight probe target — must stay fast while terraform validate runs. */
export async function GET() {
  return NextResponse.json(
    { ok: true, service: 'stackforge' },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
