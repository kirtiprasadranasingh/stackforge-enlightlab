import { NextRequest, NextResponse } from 'next/server';
import { getGemini, DEFAULT_MODEL, GENERATION_CONFIG } from '@/lib/gemini';
import {
  SYSTEM_PROMPT,
  formatPrompt,
  formatFollowUpPrompt,
  formatPlanPrompt,
} from '@/lib/prompts';
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
import { inferPresetsFromPrompt } from '@/lib/infer-presets';
import { buildClarifyingQuestions } from '@/lib/clarifying-questions';
import {
  isFullStackPrompt,
  isIterativeEditPrompt,
  requiresPlanApproval,
  isConversationalPrompt,
  isOutOfScopeOpsPrompt,
} from '@/lib/stack-intent';
import { normalizeScaffoldFile, normalizeScaffoldFiles } from '@/lib/normalize-scaffold';
import {
  buildCompletionPrompt,
  detectScaffoldProfile,
  getMissingPaths,
  parseFileManifestFromPlan,
} from '@/lib/scaffold-spec';
import type { GeneratedFile, Presets, WorkflowPhase } from '@/types';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const runtime = 'nodejs';
export const maxDuration = 300;

function sse(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

function ingestParsedFile(
  raw: GeneratedFile,
  collected: GeneratedFile[],
  onFile: (file: GeneratedFile) => void
): boolean {
  const file = normalizeScaffoldFile(raw);
  if (!file) return false;
  const idx = collected.findIndex((f) => f.path === file.path);
  if (idx === -1) collected.push(file);
  else collected[idx] = file;
  onFile(file);
  return true;
}

function parseFilesFromModelText(text: string): GeneratedFile[] {
  const state = createParseState();
  const first = appendAndParse(state, text);
  const second = appendAndParse(state, '', true);
  const merged = [...first.files, ...second.files];
  for (const f of parseMarkdownFallback(text)) {
    if (!merged.some((m) => m.path === f.path)) merged.push(f);
  }
  return normalizeScaffoldFiles(merged);
}

/** Keep chat summary short — long prose belongs in README.md */
function trimSummary(summary: string): string {
  const trimmed = summary.trim();
  if (trimmed.length <= 600) return trimmed;
  const firstPara = trimmed.split(/\n\n+/)[0] || trimmed;
  return firstPara.slice(0, 600) + (firstPara.length > 600 ? '…' : '');
}

function sseResponse(stream: ReadableStream, cors: HeadersInit): NextResponse {
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...cors,
    },
  });
}

/** Reliable first-round interview: fast, deterministic, and never partial JSON. */
function streamClarifyingPhase(
  cors: HeadersInit,
  prompt: string,
  presets: Presets
): NextResponse {
  const questions = buildClarifyingQuestions(prompt, presets);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        sse({ type: 'status', message: 'Reviewing your requirements…' })
      );
      controller.enqueue(sse({ type: 'questions', questions }));
      controller.enqueue(
        sse({
          type: 'summary',
          summary:
            "Great — here's what I've got so far. A few quick choices will help me tailor the plan. Pick an option for each (or type your own), and I'll draft a detailed infrastructure plan for your approval.",
        })
      );
      controller.enqueue(sse({ type: 'warnings', warnings: [] }));
      controller.enqueue(sse({ type: 'done' }));
      controller.close();
    },
  });

  return sseResponse(stream, cors);
}

/** Plan/clarify phases: stream Gemini text, emit questions/plan, never files. */
async function streamPlanningPhase(params: {
  cors: HeadersInit;
  systemPrompt: string;
  userPrompt: string;
  statusMessage: string;
  /** Casual chat: only emit a summary reply, never questions or a plan. */
  conversational?: boolean;
}): Promise<NextResponse> {
  const { cors, systemPrompt, userPrompt, statusMessage, conversational } = params;
  const stream = new ReadableStream({
    async start(controller) {
      const parseState = createParseState();
      let fullText = '';
      let questionsSent = false;
      let planSent = false;
      let summarySent = false;

      try {
        controller.enqueue(sse({ type: 'status', message: statusMessage }));

        const model = getGemini().getGenerativeModel({
          model: DEFAULT_MODEL,
          systemInstruction: systemPrompt,
          generationConfig: {
            maxOutputTokens: 8192,
            thinkingConfig: { thinkingBudget: 0 },
          } as unknown as typeof GENERATION_CONFIG,
        });

        const geminiStream = await model.generateContentStream(userPrompt);

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

          // Never emit files from planning phases even if the model misbehaves
          if (parsed.questions?.length && !questionsSent) {
            questionsSent = true;
            controller.enqueue(sse({ type: 'questions', questions: parsed.questions }));
          }
          if (parsed.plan && parsed.plan.length > 40 && !planSent) {
            planSent = true;
            controller.enqueue(sse({ type: 'plan', plan: parsed.plan }));
          }
          if (parsed.summary && !summarySent) {
            summarySent = true;
            controller.enqueue(sse({ type: 'summary', summary: trimSummary(parsed.summary) }));
          }
        }

        const finalParsed = appendAndParse(parseState, '', true);
        if (finalParsed.questions?.length && !questionsSent) {
          questionsSent = true;
          controller.enqueue(sse({ type: 'questions', questions: finalParsed.questions }));
        }
        if (finalParsed.plan && finalParsed.plan.length > 40 && !planSent) {
          planSent = true;
          controller.enqueue(sse({ type: 'plan', plan: finalParsed.plan }));
        }
        if (finalParsed.summary && !summarySent) {
          summarySent = true;
          controller.enqueue(sse({ type: 'summary', summary: trimSummary(finalParsed.summary) }));
        }

        // Fallback: treat whole response as plan if markers missing but content looks like a plan
        if (!conversational && !planSent && !questionsSent && fullText.trim().length > 80) {
          const cleaned = fullText
            .replace(/<<<FILE[\s\S]*?<<<END_FILE>>>/g, '')
            .replace(/<<<[^>]+>>>/g, '')
            .trim();
          if (
            /file manifest|assumptions|resources|terraform|ci\/cd/i.test(cleaned) ||
            cleaned.length > 200
          ) {
            controller.enqueue(sse({ type: 'plan', plan: cleaned.slice(0, 18000) }));
            planSent = true;
          } else if (cleaned) {
            const qLines = cleaned
              .split('\n')
              .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
              .filter((l) => l.endsWith('?'));
            if (qLines.length) {
              controller.enqueue(sse({ type: 'questions', questions: qLines.slice(0, 8) }));
              questionsSent = true;
            }
          }
        }

        if (!summarySent) {
          const conversationalReply = fullText
            .replace(/<<<[^>]+>>>/g, '')
            .replace(/\[\s*\]/g, '')
            .trim();
          controller.enqueue(
            sse({
              type: 'summary',
              summary: conversational
                ? conversationalReply ||
                  "I'm here to help you scaffold cloud infrastructure. Describe the stack you want and I'll draft a plan."
                : planSent
                  ? 'Review the plan below. Approve to generate files, or reply with changes to revise it.'
                  : questionsSent
                    ? 'Pick an option for each question above (or type your own) so I can draft a concrete plan.'
                    : 'Could not draft a plan — try a clearer stack description.',
            })
          );
        }

        controller.enqueue(sse({ type: 'warnings', warnings: [] }));
        controller.enqueue(sse({ type: 'done' }));
        controller.close();
      } catch (error) {
        console.error('Planning stream error:', error);
        controller.enqueue(
          sse({
            type: 'error',
            error:
              'Planning failed: ' +
              (error instanceof Error ? error.message : 'Unknown error'),
          })
        );
        controller.close();
      }
    },
  });

  return sseResponse(stream, cors);
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

    const {
      prompt: rawPrompt,
      presets: rawPresets = { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' },
      history = [],
      existingFiles = [],
      phase: requestedPhase,
      approvedPlan,
      priorPlan,
    } = validation.data;
    const prompt = sanitizeInput(rawPrompt);
    const presets = inferPresetsFromPrompt(prompt, rawPresets as Presets);
    const lowerPrompt = prompt.toLowerCase().trim();
    let phase: WorkflowPhase = requestedPhase || 'generate';

    // 1. Intercept Greetings — word-boundary only; never when chat/files already exist
    const isGreeting =
      (existingFiles.length === 0 && history.length === 0) &&
      (/^(hi|hello|hey|yo|greetings|good morning|good afternoon|good evening)[!.?\s]*$/i.test(lowerPrompt) ||
        /^(hi|hello|hey)\s+\w+/i.test(lowerPrompt) && lowerPrompt.split(/\s+/).length <= 4);

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
              summary: "Hey! I am StackForge from Enlight Labs. I generate infrastructure scaffolds — Terraform, CI/CD pipelines, Dockerfiles, and orchestration manifests — plus a minimal health-check stub (not a full application).\n\nDescribe the cloud stack you want, answer a few clarifying questions, approve the plan, and I'll stream the files.",
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
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
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

    // "Deploy a Go backend to Azure…" must wipe previous AWS/EKS files — not merge as a follow-up
    // Approved plans always start a full scaffold generation (never a delta edit).
    const isFreshGen =
      Boolean(approvedPlan?.trim()) ||
      !existingFiles.length ||
      (isFullStackPrompt(prompt) && !isIterativeEditPrompt(prompt));
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
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
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

    if (isOutOfScopeOpsPrompt(prompt)) {
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(sse({ type: 'status', message: 'Checking scope…' }));
          await new Promise((r) => setTimeout(r, 300));
          controller.enqueue(
            sse({
              type: 'summary',
              summary:
                "I'm a generator only — I produce reviewable Terraform, CI/CD, and Kubernetes/Helm scaffolds (plus a minimal health stub). I don't provision cloud resources, manage DNS, pay bills, or install CMS products like WordPress.\n\nDescribe the stack you want as infrastructure code (cloud, compute, CI, database if any), and I'll interview you, draft a plan, then generate files.",
            })
          );
          controller.enqueue(sse({ type: 'warnings', warnings: [] }));
          controller.enqueue(sse({ type: 'done' }));
          controller.close();
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
    }

    if (isConversationalPrompt(prompt)) {
      const CONVERSATIONAL_SYSTEM_PROMPT = `You are StackForge, a helpful AI cloud architect assistant for Enlight Labs.
The user is making small talk, asking who you are / what you can do, or otherwise chatting — they are NOT (yet) describing infrastructure to build.
Respond directly and helpfully to what they actually said. Keep it short and friendly (2-4 sentences).

If they ask about your capabilities or what you can do, briefly explain: you generate production-grade infrastructure scaffolds — Terraform, CI/CD pipelines, and Kubernetes manifests (plus a minimal health-check app stub) — for AWS, Azure, GCP, or Oracle Cloud from a plain-English description. Invite them to describe the app and cloud they have in mind.

Hard rules:
- Answer ONLY the user's actual message. Do NOT assume any cloud, region, or stack. Never mention AWS/EKS (or any specific stack) unless the user brought it up.
- Do NOT ask clarifying/interview questions and do NOT propose a plan here.
- Do NOT generate any code, files, or <<<FILE>>> / <<<DELETE>>> markers.
Always format your response by wrapping the chat reply in the following markers:
<<<SUMMARY>>>
[Your conversational reply here]
<<<WARNINGS>>>
[]
`;
      return streamPlanningPhase({
        cors,
        systemPrompt: CONVERSATIONAL_SYSTEM_PROMPT,
        userPrompt: prompt,
        statusMessage: 'Chatting…',
        conversational: true,
      });
    }

    const gated = requiresPlanApproval(prompt, existingFiles.length > 0);

    // Clients that skip workflow phases — interview first, then plan (never invent silently)
    if (phase === 'generate' && gated && !approvedPlan?.trim()) {
      const hasPriorAssistant = history.some((m) => m.role === 'assistant');
      phase = hasPriorAssistant ? 'plan' : 'clarify';
    }

    // Clarify / plan phases — never emit files
    if (phase === 'clarify') {
      return streamClarifyingPhase(cors, prompt, presets);
    }

    if (phase === 'plan') {
      return streamPlanningPhase({
        cors,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: formatPlanPrompt({
          userPrompt: prompt,
          presets,
          priorPlan,
          history,
        }),
        statusMessage: priorPlan ? 'Revising plan…' : 'Drafting architecture plan…',
      });
    }

    const fullPrompt = isFollowUp
      ? formatFollowUpPrompt({
          message: prompt,
          presets,
          existingFiles,
          history,
        })
      : formatPrompt(prompt, presets, approvedPlan);

    const stream = new ReadableStream({
      async start(controller) {
        const parseState = createParseState();
        let fullText = '';
        let lastStatus = '';
        let summarySent = false;
        let warningsSent = false;
        const collectedFiles: GeneratedFile[] = [];
        let anyOutput = false;

        // Wall-clock budget so post-generation work (missing-file completion +
        // validate/repair) never runs past the serverless function limit and
        // leaves the client spinner hanging. Leave a margin to flush the stream.
        const requestStartedAt = Date.now();
        const HARD_DEADLINE_MS = (maxDuration - 20) * 1000;
        const timeLeftMs = () => HARD_DEADLINE_MS - (Date.now() - requestStartedAt);

        try {
          if (isFreshGen && existingFiles.length > 0) {
            controller.enqueue(sse({ type: 'clear' }));
          }

          controller.enqueue(
            sse({
              type: 'status',
              message: isFollowUp ? 'Updating…' : 'Generating…',
            })
          );

          const model = getGemini().getGenerativeModel({
            model: DEFAULT_MODEL,
            systemInstruction: SYSTEM_PROMPT,
            generationConfig: {
              ...GENERATION_CONFIG,
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
              if (
                ingestParsedFile(file, collectedFiles, (f) => {
                  controller.enqueue(sse({ type: 'file', file: f }));
                })
              ) {
                anyOutput = true;
              }
            }

            if (parsed.summary && !summarySent) {
              summarySent = true;
              anyOutput = true;
              controller.enqueue(sse({ type: 'summary', summary: trimSummary(parsed.summary) }));
            }

            if (parsed.warnings && !warningsSent) {
              warningsSent = true;
              controller.enqueue(sse({ type: 'warnings', warnings: parsed.warnings }));
            }
          }

          // Send the final complete summary and warnings if parsed from markers
          const finalParsed = appendAndParse(parseState, '', true);
          if (finalParsed.summary && !summarySent) {
            summarySent = true;
            anyOutput = true;
            controller.enqueue(sse({ type: 'summary', summary: trimSummary(finalParsed.summary) }));
          }
          if (finalParsed.warnings && !warningsSent) {
            warningsSent = true;
            controller.enqueue(sse({ type: 'warnings', warnings: finalParsed.warnings }));
          }

          if (collectedFiles.length === 0 && !isFollowUp) {
            const fallback = parseJsonFallback(fullText);
            for (const file of fallback.files) {
              if (!validateOutputSize([...collectedFiles, file])) break;
              if (
                ingestParsedFile(file, collectedFiles, (f) => {
                  controller.enqueue(sse({ type: 'file', file: f }));
                })
              ) {
                anyOutput = true;
              }
            }
            if (fallback.summary && !summarySent) {
              summarySent = true;
              anyOutput = true;
              controller.enqueue(sse({ type: 'summary', summary: trimSummary(fallback.summary) }));
            }
            if (fallback.warnings && !warningsSent) {
              warningsSent = true;
              controller.enqueue(sse({ type: 'warnings', warnings: fallback.warnings }));
            }
          }

          const fallbackFiles = parseMarkdownFallback(fullText);
          for (const file of fallbackFiles) {
            const normalized = normalizeScaffoldFile(file);
            const exists =
              normalized &&
              collectedFiles.some((f) => f.path === normalized.path);
            if (normalized && !exists) {
              if (!validateOutputSize([...collectedFiles, normalized])) break;
              if (
                ingestParsedFile(normalized, collectedFiles, (f) => {
                  controller.enqueue(sse({ type: 'file', file: f }));
                })
              ) {
                anyOutput = true;
              }
            }
          }

          if (!isFollowUp) {
            const profile = detectScaffoldProfile(prompt, presets);
            const planPaths = parseFileManifestFromPlan(approvedPlan || '');
            const requiredPaths =
              planPaths.length >= 4
                ? planPaths
                : profile
                  ? [...profile.requiredPaths]
                  : [];

            if (requiredPaths.length > 0) {
              let missing = getMissingPaths(collectedFiles, requiredPaths);
              let completionPasses = 0;
              const maxCompletionPasses = 3;

              while (missing.length > 0 && completionPasses < maxCompletionPasses) {
                // Stop completing if we can't afford another model round-trip and
                // still leave room for validation below.
                if (timeLeftMs() < 60000) break;
                completionPasses += 1;
                const batch = missing.slice(0, 8);
                controller.enqueue(
                  sse({
                    type: 'status',
                    message: `Completing ${batch.length} missing file(s)…`,
                  })
                );
                try {
                  const completionResult = await model.generateContent(
                    buildCompletionPrompt(batch, collectedFiles, profile)
                  );
                  const completionText = completionResult.response.text();
                  let added = 0;
                  for (const file of parseFilesFromModelText(completionText)) {
                    if (!validateOutputSize([...collectedFiles, file])) break;
                    if (
                      ingestParsedFile(file, collectedFiles, (f) => {
                        anyOutput = true;
                        controller.enqueue(sse({ type: 'file', file: f }));
                      })
                    ) {
                      added += 1;
                    }
                  }
                  const nextMissing = getMissingPaths(collectedFiles, requiredPaths);
                  if (added === 0 || nextMissing.length >= missing.length) {
                    missing = nextMissing;
                    break;
                  }
                  missing = nextMissing;
                } catch (completionErr) {
                  console.error('Completion pass error:', completionErr);
                  break;
                }
              }

              if (missing.length > 0 && !warningsSent) {
                warningsSent = true;
                controller.enqueue(
                  sse({
                    type: 'warnings',
                    warnings: [
                      `Still missing: ${missing.join(', ')}. Re-run Approve & Generate or add manually.`,
                    ],
                  })
                );
              }
            }
          }
          // Follow-ups must return files — do not treat prose-only replies as successful updates
          if (isFollowUp && collectedFiles.length === 0) {
            const cleanText = fullText
              .replace(/<<<FILE[\s\S]*?>>>[\s\S]*?<<<END_FILE>>>/g, '')
              .replace(/<<<[\s\S]*?>>>/g, '')
              .replace(/```[a-zA-Z]*\r?\n[\s\S]*?\r?\n```/g, '')
              .replace(/```[\s\S]*?$/g, '')
              .trim();
            if (cleanText && !summarySent) {
              summarySent = true;
              anyOutput = true;
              controller.enqueue(
                sse({
                  type: 'summary',
                  summary:
                    cleanText +
                    '\n\n⚠️ No files were updated in this turn. The project on the right is unchanged. Try again with a specific request (e.g. "Add terraform/environments/dev.tfvars and prod.tfvars and update azure-pipelines.yml with dev and prod stages").',
                })
              );
            } else if (!summarySent) {
              controller.enqueue(
                sse({
                  type: 'error',
                  error:
                    'No file updates were returned. Describe the change clearly — for dev/prod, ask for dev.tfvars, prod.tfvars, and pipeline environment stages.',
                })
              );
            }
          } else if (!anyOutput && collectedFiles.length === 0 && !summarySent) {
            const cleanText = fullText
              .replace(/<<<FILE[\s\S]*?>>>[\s\S]*?<<<END_FILE>>>/g, '')
              .replace(/<<<[\s\S]*?>>>/g, '')
              .replace(/```[a-zA-Z]*\r?\n[\s\S]*?\r?\n```/g, '')
              .replace(/```[\s\S]*?$/g, '')
              .trim();
            if (cleanText) {
              summarySent = true;
              anyOutput = true;
              controller.enqueue(sse({ type: 'summary', summary: cleanText }));
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
              const MAX_VALIDATION_ATTEMPTS = 3; // 1 validate + up to 2 auto-repair passes (bounded by the wall-clock budget below)
              let attempts = 0;
              let passed = false;
              let reportText = "";

              while (attempts < MAX_VALIDATION_ATTEMPTS) {
                // Never start a validate run we don't have time to finish; ship
                // with the advisory warning instead of hanging past the limit.
                if (timeLeftMs() < 35000) {
                  passed = false;
                  break;
                }
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
                  // Cap the validator so it can't run past our remaining budget.
                  const validateTimeout = Math.min(
                    60000,
                    Math.max(15000, timeLeftMs() - 20000)
                  );
                  let code = 0;
                  let output = "";
                  try {
                    const tfCache =
                      process.env.STACKFORGE_TF_PLUGIN_CACHE ||
                      path.join(os.tmpdir(), 'stackforge-tf-plugin-cache');
                    await fs.mkdir(tfCache, { recursive: true });
                    const { stdout, stderr } = await execAsync(
                      `bash "${scriptPath}" "${tempDir}"`,
                      {
                        timeout: validateTimeout,
                        env: {
                          ...process.env,
                          TF_IN_AUTOMATION: '1',
                          TF_PLUGIN_CACHE_DIR: tfCache,
                          STACKFORGE_TF_PLUGIN_CACHE: tfCache,
                        },
                      }
                    );
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

                  if (attempts >= MAX_VALIDATION_ATTEMPTS) {
                    // Out of repair budget — ship with the README warning appended below.
                    passed = false;
                    break;
                  }

                  // A repair pass costs a model round-trip plus another validate.
                  // If that won't fit, stop now and ship with the warning.
                  if (timeLeftMs() < 70000) {
                    passed = false;
                    break;
                  }

                  controller.enqueue(sse({ type: 'status', message: `Validator flagged issues — auto-resolving (pass ${attempts}/${MAX_VALIDATION_ATTEMPTS - 1})…` }));

                  const fixPrompt = `Static validation FAILED for the generated scaffold. Fix ONLY the issues below and return the corrected full file(s). Do not regenerate unaffected files, and do not change the cloud, region, environments, or architecture from the approved plan:\n\n${failLines.join('\n')}`;
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
                  const finalParsedFix = appendAndParse(parseStateFix, '', true);
                  const correctedFiles = normalizeScaffoldFiles([
                    ...parsedFix.files,
                    ...finalParsedFix.files,
                  ]);

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
