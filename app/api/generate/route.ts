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
import { appendAndParse, createParseState, parseJsonFallback, parseMarkdownFallback } from '@/lib/stream-parse';
import {
  buildValidationReadmeNotice,
  parseValidationReport,
  shouldAppendValidationWarning,
} from '@/lib/validation-report';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

import type { GeneratedFile } from '@/types';

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
    headers: getCORSHeaders(origin, request),
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const cors = getCORSHeaders(origin, request);

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
    const lowerPrompt = prompt.toLowerCase().trim();

    // 1. Intercept Greetings
    const greetings = ['hi', 'hello', 'hey', 'greetings', 'yo', 'good morning', 'good afternoon', 'good evening'];
    const isGreeting = greetings.includes(lowerPrompt) || (greetings.some(g => lowerPrompt.includes(g)) && lowerPrompt.split(/\s+/).length <= 3);

    if (isGreeting) {
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(
            sse({
              type: 'status',
              message: 'Greeting user...',
            })
          );
          await new Promise(r => setTimeout(r, 400));
          controller.enqueue(
            sse({
              type: 'summary',
              summary: "Hey! I am StackForge, your AI Cloud Blueprint Generator from Enlight Labs. I can help you design and generate Terraform configurations, Dockerfiles, Helm charts, and CI/CD pipelines (GitHub Actions, GitLab CI, Jenkins) for OCI, AWS, GCP, and Azure.\n\nDescribe the cloud infrastructure or application deployment you want to generate code for, and I'll build it!",
            })
          );
          controller.enqueue(
            sse({
              type: 'warnings',
              warnings: [],
            })
          );
          controller.enqueue(sse({ type: 'done' }));
          controller.close();
        }
      });
      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...cors,
        },
      });
    }

    // 2. Intercept Out-of-Scope Execution Commands
    const executionCommands = [
      'terraform apply', 'terraform destroy', 'terraform init', 'docker run', 'docker build',
      'kubectl apply', 'kubectl create', 'kubectl delete', 'helm install', 'helm upgrade',
      'git push', 'git commit', 'npm install', 'npm run'
    ];
    const isExecutionCommand = executionCommands.some(cmd => lowerPrompt.includes(cmd));

    const actionVerbs = ['deploy', 'provision', 'run', 'apply', 'execute', 'install', 'host', 'setup'];
    const isActionCommand = actionVerbs.some(verb => {
      // Only match if the sentence starts with the verb (optionally preceded by standard politeness/intent prefixes)
      const regex = new RegExp(`^(please\\s+|can\\s+you\\s+|i\\s+want\\s+to\\s+|how\\s+to\\s+)?${verb}\\b`, 'i');
      return regex.test(lowerPrompt);
    });

    const isInformationalOrBlueprint = 
      lowerPrompt.includes('pipeline') || 
      lowerPrompt.includes('yaml') || 
      lowerPrompt.includes('manifest') || 
      lowerPrompt.includes('config') || 
      lowerPrompt.includes('how to') || 
      lowerPrompt.includes('how do i') || 
      lowerPrompt.includes('write') || 
      lowerPrompt.includes('generate') || 
      lowerPrompt.includes('create') || 
      lowerPrompt.includes('scaffold') || 
      lowerPrompt.includes('code') ||
      lowerPrompt.includes('blueprint') ||
      lowerPrompt.includes('helm') ||
      lowerPrompt.includes('dockerfile') ||
      lowerPrompt.includes('api') ||
      lowerPrompt.includes('service') ||
      lowerPrompt.includes('app') ||
      lowerPrompt.includes('application') ||
      lowerPrompt.includes('microservice') ||
      lowerPrompt.includes('workload') ||
      lowerPrompt.includes('backend') ||
      lowerPrompt.includes('frontend') ||
      lowerPrompt.includes('database') ||
      lowerPrompt.includes('postgres') ||
      lowerPrompt.includes('redis') ||
      lowerPrompt.includes('mysql');

    const hasCloudKeyword = 
      lowerPrompt.includes('aws') || 
      lowerPrompt.includes('gcp') || 
      lowerPrompt.includes('google') || 
      lowerPrompt.includes('azure') || 
      lowerPrompt.includes('oracle') || 
      lowerPrompt.includes('oci') ||
      lowerPrompt.includes('oke') ||
      lowerPrompt.includes('eks') ||
      lowerPrompt.includes('gke') ||
      lowerPrompt.includes('aks') ||
      lowerPrompt.includes('cloud run') ||
      lowerPrompt.includes('containerapp') ||
      lowerPrompt.includes('container app') ||
      lowerPrompt.includes('artifact registry') ||
      lowerPrompt.includes('secret manager') ||
      lowerPrompt.includes('ecs');

    const isCapabilityQuestion = 
      (lowerPrompt.startsWith('can you') || 
       lowerPrompt.startsWith('do you') || 
       lowerPrompt.startsWith('are you') ||
       lowerPrompt.includes('can stackforge')) &&
      (lowerPrompt.includes('deploy') || 
       lowerPrompt.includes('run') || 
       lowerPrompt.includes('execute') || 
       lowerPrompt.includes('provision') ||
       lowerPrompt.includes('manage') ||
       lowerPrompt.includes('host') ||
       lowerPrompt.includes('setup'));

    const isNewRequest = (p: string): boolean => {
      const lower = p.toLowerCase().trim();
      if (lower.startsWith('a ') || lower.startsWith('an ') || lower.startsWith('new ') || lower.startsWith('create ') || lower.startsWith('generate ') || lower.startsWith('build ') || lower.startsWith('scaffold ')) {
        return true;
      }
      if ((lower.includes('eks') || lower.includes('gke') || lower.includes('aks') || lower.includes('oke') || lower.includes('fargate') || lower.includes('ecs')) && 
          (lower.includes('api') || lower.includes('service') || lower.includes('rest') || lower.includes('app') || lower.includes('application'))) {
        if (lower.length > 35) {
          return true;
        }
      }
      return false;
    };

    const isFreshGen = !existingFiles.length || isNewRequest(prompt);
    const isFollowUp = existingFiles.length > 0 && !isFreshGen;

    const hasPrescribedConfigKeyword = 
      lowerPrompt.includes('terraform') || 
      lowerPrompt.includes('yaml') || 
      lowerPrompt.includes('manifest') || 
      lowerPrompt.includes('code') ||
      lowerPrompt.includes('blueprint') ||
      lowerPrompt.includes('helm') ||
      lowerPrompt.includes('dockerfile');

    const shouldRefuse = isExecutionCommand || 
                         (!isFollowUp && (
                           (isActionCommand && !isInformationalOrBlueprint && !hasCloudKeyword) ||
                           (isCapabilityQuestion && !hasPrescribedConfigKeyword && !hasCloudKeyword)
                         ));

    if (shouldRefuse) {
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(
            sse({
              type: 'status',
              message: 'Checking scope...',
            })
          );
          await new Promise(r => setTimeout(r, 450));
          controller.enqueue(
            sse({
              type: 'summary',
              summary: "I generate infrastructure code from a description of the stack you want — things like \"a Node API on EKS with autoscaling and a staging environment.\" I can't help with anything outside that.",
            })
          );
          controller.enqueue(
            sse({
              type: 'warnings',
              warnings: [],
            })
          );
          controller.enqueue(sse({ type: 'done' }));
          controller.close();
        }
      });
      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...cors,
        },
      });
    }

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
        const collectedFiles: GeneratedFile[] = [];
        let anyOutput = false;

        try {
          if (isFreshGen && existingFiles.length > 0) {
            controller.enqueue(sse({ type: 'clear' }));
          }

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

          // Run the Markdown fallback parser to capture any missed files
          const fallbackFiles = parseMarkdownFallback(fullText);
          for (const file of fallbackFiles) {
            const exists = collectedFiles.some(f => f.path === file.path);
            if (!exists) {
              if (!validateOutputSize([...collectedFiles, file])) break;
              collectedFiles.push(file);
              anyOutput = true;
              controller.enqueue(sse({ type: 'file', file }));
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
            if (collectedFiles.length > 0) {
              const currentFiles = [...collectedFiles];
              let attempts = 0;
              let passed = false;
              let reportText = "";

              while (attempts < 2) {
                attempts++;
                let tempDir = "";
                try {
                  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stackforge-val-'));
                  for (const file of currentFiles) {
                    const filePath = path.join(tempDir, file.path);
                    await fs.mkdir(path.dirname(filePath), { recursive: true });
                    await fs.writeFile(filePath, file.content, 'utf8');
                  }

                  const scriptPath = path.join(process.cwd(), 'scripts', 'validate-scaffold.sh');
                  let code = 0;
                  let output = "";
                  try {
                    const { stdout, stderr } = await execAsync(`bash "${scriptPath}" "${tempDir}"`, { timeout: 12000 });
                    code = 0;
                    output = stdout + stderr;
                  } catch (err: unknown) {
                    const execError = err as { code?: number; stdout?: string; stderr?: string };
                    code = execError.code || 1;
                    output = (execError.stdout || '') + (execError.stderr || '');
                  }

                  reportText = output;
                  const parsedReport = parseValidationReport(output);

                  if (!parsedReport.failed) {
                    passed = true;
                    break;
                  }

                  const failLines = parsedReport.checkLines.filter((l) =>
                    l.startsWith('FAIL')
                  );

                  if (failLines.length === 0) {
                    // Script exited non-zero but produced no actionable FAIL lines — skip auto-fix
                    passed = !shouldAppendValidationWarning(output, parsedReport);
                    break;
                  }

                  if (attempts === 2) {
                    passed = false;
                    break;
                  }

                  controller.enqueue(sse({ type: 'status', message: `Validator flagged issues. Auto-resolving (attempt ${attempts}/1)…` }));

                  const fixPrompt = `The following files failed validation:\n${failLines.join('\n')}\n\nFix only these specific issues in the affected files and return the corrected versions — do not regenerate unaffected files.`;
                  const fixPromptText = formatFollowUpPrompt({
                    message: fixPrompt,
                    presets,
                    existingFiles: currentFiles,
                    history: [],
                  });

                  const fixResult = await model.generateContent(fixPromptText);
                  const fixText = fixResult.response.text();

                  const parseStateFix = createParseState();
                  const parsedFix = appendAndParse(parseStateFix, fixText);
                  const finalParsedFix = appendAndParse(parseStateFix, '');
                  const correctedFiles = [...parsedFix.files, ...finalParsedFix.files];

                  if (correctedFiles.length > 0) {
                    for (const file of correctedFiles) {
                      const idx = currentFiles.findIndex(f => f.path === file.path);
                      if (idx !== -1) {
                        currentFiles[idx] = file;
                      } else {
                        currentFiles.push(file);
                      }
                      controller.enqueue(sse({ type: 'file', file }));
                    }
                  } else {
                    passed = false;
                    break;
                  }
                } catch (e) {
                  console.error('Validation loop error:', e);
                  break;
                } finally {
                  if (tempDir) {
                    try {
                      await fs.rm(tempDir, { recursive: true, force: true });
                    } catch (e) {
                      console.error('Failed to clean up tempDir:', e);
                    }
                  }
                }
              }

              const finalParsedReport = parseValidationReport(reportText);
              if (shouldAppendValidationWarning(reportText, finalParsedReport)) {
                try {
                  const readmeIdx = currentFiles.findIndex(f => f.path === 'README.md');
                  const notice = buildValidationReadmeNotice(finalParsedReport);
                  if (readmeIdx !== -1) {
                    const updatedContent = currentFiles[readmeIdx].content + notice;
                    currentFiles[readmeIdx] = { ...currentFiles[readmeIdx], content: updatedContent };
                    controller.enqueue(sse({ type: 'file', file: currentFiles[readmeIdx] }));
                  } else {
                    const newReadme = {
                      path: 'README.md',
                      language: 'markdown',
                      content: `# Workspace Blueprint\n\n${notice}`
                    };
                    currentFiles.push(newReadme);
                    controller.enqueue(sse({ type: 'file', file: newReadme }));
                  }
                } catch (e) {
                  console.error('README write error:', e);
                }
              }
            }
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
