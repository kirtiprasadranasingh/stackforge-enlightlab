import { NextRequest, NextResponse } from 'next/server';
import { getGemini, DEFAULT_MODEL, MAX_OUTPUT_TOKENS } from '@/lib/gemini';
import { SYSTEM_PROMPT, formatPrompt, formatFollowUpPrompt } from '@/lib/prompts';
import { sanitizeInput, validateOutputSize } from '@/lib/utils';
import { validateGenerateRequest, ValidationError, RateLimitError } from '@/lib/validation';
import {
  checkRateLimit,
  getClientIP,
  getCORSHeaders,
  assertOriginAllowed,
} from '@/lib/rate-limit';
import { appendAndParse, createParseState, parseJsonFallback } from '@/lib/stream-parse';

export const runtime = 'nodejs';
export const maxDuration = 120;

function sse(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const gate = assertOriginAllowed(request);
  if (!gate.ok) {
    return new NextResponse(null, { status: gate.status });
  }
  return new NextResponse(null, {
    status: 204,
    headers: getCORSHeaders(origin),
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const cors = getCORSHeaders(origin);

  try {
    const gate = assertOriginAllowed(request);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status, headers: cors });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'Server misconfigured: GEMINI_API_KEY missing' },
        { status: 500, headers: cors }
      );
    }

    const body = await request.json();
    const validation = validateGenerateRequest(body);

    if (!validation.success) {
      throw new ValidationError('Invalid request', validation.error);
    }

    const { prompt: rawPrompt, presets = { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' }, history = [], existingFiles = [] } =
      validation.data;
    const prompt = sanitizeInput(rawPrompt);
    const isFollowUp = existingFiles.length > 0;

    const clientIP = getClientIP(request);
    const rateLimitResult = await checkRateLimit(clientIP);

    if (!rateLimitResult.allowed) {
      throw new RateLimitError(
        'Rate limit exceeded. Please try again later.',
        rateLimitResult.remaining
      );
    }

    const fullPrompt = isFollowUp
      ? formatFollowUpPrompt({
          message: prompt,
          presets,
          existingFiles,
          history,
        })
      : formatPrompt(prompt, presets);

    const stream = new ReadableStream({
      async start(controller) {
        const parseState = createParseState();
        let fullText = '';
        let lastStatus = '';
        let summarySent = false;
        let warningsSent = false;
        const collectedFiles: { content: string }[] = [];
        let anyOutput = false;

        try {
          controller.enqueue(
            sse({
              type: 'status',
              message: isFollowUp
                ? 'Updating your project…'
                : 'Connecting to Gemini… preparing your stack',
            })
          );

          const model = getGemini().getGenerativeModel({
            model: DEFAULT_MODEL,
            systemInstruction: SYSTEM_PROMPT,
            generationConfig: {
              maxOutputTokens: MAX_OUTPUT_TOKENS,
            },
          });

          const geminiStream = await model.generateContentStream(fullPrompt);

          for await (const chunk of geminiStream.stream) {
            let chunkText = '';
            try {
              chunkText = chunk.text();
            } catch {
              continue;
            }
            if (!chunkText) continue;

            fullText += chunkText;
            const parsed = appendAndParse(parseState, chunkText);

            if (parsed.status && parsed.status !== lastStatus) {
              lastStatus = parsed.status;
              controller.enqueue(sse({ type: 'status', message: parsed.status }));
            }

            for (const path of parsed.deletedPaths) {
              anyOutput = true;
              controller.enqueue(sse({ type: 'delete', path }));
            }

            for (const file of parsed.files) {
              if (!validateOutputSize([...collectedFiles, file])) {
                controller.enqueue(
                  sse({
                    type: 'error',
                    error: 'Output size limit reached. Try a narrower description.',
                  })
                );
                controller.close();
                return;
              }
              collectedFiles.push(file);
              anyOutput = true;
              controller.enqueue(sse({ type: 'file', file }));
            }

            if (parsed.summary && !summarySent) {
              summarySent = true;
              anyOutput = true;
              controller.enqueue(sse({ type: 'summary', summary: parsed.summary }));
            }

            if (parsed.warnings && !warningsSent) {
              warningsSent = true;
              controller.enqueue(sse({ type: 'warnings', warnings: parsed.warnings }));
            }
          }

          // Send the final complete summary and warnings if parsed from markers
          const finalParsed = appendAndParse(parseState, '');
          if (finalParsed.summary) {
            anyOutput = true;
            controller.enqueue(sse({ type: 'summary', summary: finalParsed.summary }));
          }
          if (finalParsed.warnings && finalParsed.warnings.length > 0) {
            controller.enqueue(sse({ type: 'warnings', warnings: finalParsed.warnings }));
          }

          if (collectedFiles.length === 0 && !isFollowUp) {
            const fallback = parseJsonFallback(fullText);
            for (const file of fallback.files) {
              if (!validateOutputSize([...collectedFiles, file])) break;
              collectedFiles.push(file);
              anyOutput = true;
              controller.enqueue(sse({ type: 'file', file }));
            }
            if (fallback.summary) {
              anyOutput = true;
              controller.enqueue(sse({ type: 'summary', summary: fallback.summary }));
            }
            if (fallback.warnings && fallback.warnings.length > 0) {
              controller.enqueue(sse({ type: 'warnings', warnings: fallback.warnings }));
            }
          }

          if (!anyOutput && collectedFiles.length === 0 && !summarySent) {
            controller.enqueue(
              sse({
                type: 'error',
                error: isFollowUp
                  ? 'No updates were returned. Try a clearer change request.'
                  : 'No infrastructure artifacts were generated. Try a clearer infra description.',
              })
            );
          } else {
            controller.enqueue(sse({ type: 'done' }));
          }
          controller.close();
        } catch (error) {
          console.error('Stream error:', error);
          controller.enqueue(
            sse({
              type: 'error',
              error:
                'Generation failed: ' +
                (error instanceof Error ? error.message : 'Unknown error'),
            })
          );
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...cors,
      },
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: error.message, retryAfter: error.retryAfter },
        { status: 429, headers: cors }
      );
    }

    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message, details: error.details?.issues },
        { status: 400, headers: cors }
      );
    }

    console.error('API error:', error);
    return NextResponse.json(
      {
        error:
          'Internal server error: ' +
          (error instanceof Error ? error.message : String(error)),
      },
      { status: 500, headers: cors }
    );
  }
}
