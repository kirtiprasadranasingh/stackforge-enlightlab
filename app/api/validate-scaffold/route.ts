import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import {
  assertOriginAllowed,
  checkRateLimit,
  getClientIP,
  getCORSHeaders,
} from '@/lib/rate-limit';
import {
  ScaffoldCheckRequestSchema,
  runScaffoldCheck,
  writeScaffoldTemp,
  type ScaffoldCheckId,
} from '@/lib/scaffold-checks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** OKE / long-running node — terraform init can take a while */
export const maxDuration = 120;

function sse(data: unknown): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function OPTIONS(request: NextRequest) {
  const gate = assertOriginAllowed(request);
  if (!gate.ok) return new NextResponse(null, { status: gate.status });
  return new NextResponse(null, {
    status: 204,
    headers: getCORSHeaders(request.headers.get('origin'), request),
  });
}

/**
 * Client-triggered scaffold checks (allowlisted only — no free shell).
 * Streams stdout/stderr as SSE: line | status | done | error
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const cors = getCORSHeaders(origin, request);

  const gate = assertOriginAllowed(request);
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.error },
      { status: gate.status, headers: cors }
    );
  }

  const rate = await checkRateLimit(`validate:${getClientIP(request)}`);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many validation requests. Try again shortly.' },
      { status: 429, headers: cors }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = ScaffoldCheckRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid validate-scaffold payload' },
      { status: 400, headers: cors }
    );
  }

  const { check, files } = parsed.data;
  const checkId = check as ScaffoldCheckId;

  const stream = new ReadableStream({
    async start(controller) {
      let tempDir = '';
      try {
        controller.enqueue(
          sse({ type: 'status', message: `Preparing scaffold for ${checkId}…` })
        );
        tempDir = await writeScaffoldTemp(files);
        const exitCode = await runScaffoldCheck(checkId, tempDir, (line) => {
          controller.enqueue(sse({ type: 'line', text: line }));
        });
        controller.enqueue(
          sse({
            type: 'done',
            exitCode,
            ok: exitCode === 0,
            check: checkId,
          })
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Validation failed';
        controller.enqueue(sse({ type: 'error', error: message }));
        controller.enqueue(
          sse({ type: 'done', exitCode: 1, ok: false, check: checkId })
        );
      } finally {
        if (tempDir) {
          await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...cors,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
