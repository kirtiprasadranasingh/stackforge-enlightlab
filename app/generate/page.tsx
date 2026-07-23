'use client';

import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import type {
  Presets,
  GeneratedFile,
  CloudProvider,
  Orchestrator,
  CIProvider,
  WorkflowPhase,
} from '@/types';
import {
  CLOUD_OPTIONS,
  ORCHESTRATOR_OPTIONS,
  CI_OPTIONS,
  CI_OPTIONS_BY_CLOUD,
} from '@/types';
import { LeadCapture } from '@/components/LeadCapture';
import { FileViewer } from '@/components/FileViewer';
import { BrandLockup } from '@/components/BrandLockup';
import { copyToClipboard } from '@/lib/clipboard';
import { FormattedMessage } from '@/components/FormattedMessage';
import { ClarifyingInterview } from '@/components/ClarifyingInterview';
import {
  buildInterviewChoiceItems,
  formatInterviewAnswersForPlan,
  type InterviewChoiceItem,
} from '@/lib/interview-choices';
import {
  interviewAlreadyChoseCi,
  isCiSystemQuestion,
  parseClarifyingQuestion,
} from '@/lib/clarifying-questions';
import { validateInterviewAnswer } from '@/lib/interview-answer-validation';
import { ConfirmedChoicesCard } from '@/components/ConfirmedChoicesCard';
import { WorkflowPanel } from '@/components/WorkflowPanel';
import { inferPresetsFromPrompt } from '@/lib/infer-presets';
import { sanitizePlanAgainstInterview } from '@/lib/sanitize-plan';
import {
  isFullStackPrompt,
  isIterativeEditPrompt,
  requiresPlanApproval,
  buildValidationFixPrompt,
} from '@/lib/stack-intent';
import { getLanguageFromPath } from '@/lib/utils';

type SetupStep = 1 | 2 | 3 | 4;

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  kind?: 'text' | 'confirmed-choices';
  choices?: InterviewChoiceItem[];
}

interface SendOptions {
  phase?: WorkflowPhase;
  approvedPlan?: string;
  priorPlan?: string;
  /** Skip adding a user bubble (e.g. Approve button) */
  skipUserBubble?: boolean;
  /** Short text shown in the chat bubble while `rawText` is sent to the API */
  displayContent?: string;
  interviewChoices?: InterviewChoiceItem[];
}

const MIN_WORKFLOW_THINKING_MS = 2800;

function renderChatMessage(
  m: ChatMessage,
  roleClass: string
): ReactNode {
  if (m.kind === 'confirmed-choices' && m.choices?.length) {
    return <ConfirmedChoicesCard items={m.choices} compact />;
  }
  return <FormattedMessage content={m.content} className={roleClass} />;
}

function titleCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function deriveProjectName(
  files: GeneratedFile[],
  promptText: string,
  presets: Presets
): string {
  const chartFile = files.find(
    (f) =>
      f.path.toLowerCase().endsWith('chart.yaml') ||
      f.path.toLowerCase().endsWith('chart.yml')
  );
  if (chartFile) {
    const match = chartFile.content.match(/^name:\s*["']?([^\s"']+)/m);
    if (match?.[1]) return titleCase(match[1].trim());
  }

  const pkgFile = files.find((f) => f.path.toLowerCase().endsWith('package.json'));
  if (pkgFile) {
    try {
      const parsed = JSON.parse(pkgFile.content) as { name?: string };
      if (parsed.name) return titleCase(parsed.name.replace(/^@[^/]+\//, ''));
    } catch {
      /* ignore */
    }
  }

  const goMod = files.find((f) => f.path.toLowerCase().endsWith('go.mod'));
  if (goMod) {
    const mod = goMod.content.match(/^module\s+(\S+)/m);
    if (mod?.[1]) {
      const leaf = mod[1].split('/').pop() || mod[1];
      return titleCase(leaf);
    }
  }

  const tfName = files
    .filter((f) => f.path.endsWith('.tf'))
    .map((f) => f.content.match(/project[_-]?name\s*=\s*"([^"]+)"/i)?.[1])
    .find(Boolean);
  if (tfName) return titleCase(tfName);

  // Infer a short label from the user prompt
  const t = promptText.toLowerCase();
  const lang =
    /\bgo\b|golang/.test(t) ? 'Go' :
    /node\.?js|express|nestjs/.test(t) ? 'Node.js' :
    /python|django|fastapi|flask/.test(t) ? 'Python' :
    /java|spring/.test(t) ? 'Java' :
    /dotnet|\.net|c#/.test(t) ? '.NET' :
    null;

  const target =
    presets.orchestrator === 'container-apps' || /container\s*apps?/.test(t)
      ? 'Container Apps'
      : presets.orchestrator === 'aks' || /\baks\b/.test(t)
        ? 'AKS'
        : presets.orchestrator === 'eks' || /\beks\b/.test(t)
          ? 'EKS'
          : presets.orchestrator === 'ecs' || /\becs\b/.test(t)
            ? 'ECS'
            : presets.orchestrator === 'gke'
              ? 'GKE'
              : presets.orchestrator === 'cloud-run'
                ? 'Cloud Run'
                : presets.orchestrator === 'oke'
                  ? 'OKE'
                  : 'Stack';

  const cloud =
    presets.cloud === 'oracle' ? 'OCI' :
    presets.cloud === 'aws' ? 'AWS' :
    presets.cloud === 'gcp' ? 'GCP' :
    presets.cloud === 'azure' ? 'Azure' :
    'Cloud';

  if (lang) return `${lang} on ${cloud} ${target}`;
  return `${cloud} ${target} Stack`;
}

function deriveProviderLabel(files: GeneratedFile[], presets: Presets): string {
  const cloud =
    presets.cloud === 'oracle' ? 'OCI' :
    files.some((f) => /azurerm_|azure-pipelines|container.app/i.test(f.path + f.content))
      ? 'Azure'
      : files.some((f) => /\baws_|\beks\b|\becs\b/.test(f.content) || f.path.includes('aws'))
        ? 'AWS'
        : files.some((f) => /google_|gke|cloud.run/i.test(f.content))
          ? 'GCP'
          : files.some((f) => /oci_|oracle/i.test(f.content + f.path))
            ? 'OCI'
            : presets.cloud === 'aws'
              ? 'AWS'
              : presets.cloud === 'gcp'
                ? 'GCP'
                : presets.cloud === 'azure'
                  ? 'Azure'
                  : 'Cloud';

  const orch =
    presets.orchestrator === 'container-apps' ? 'Container Apps' :
    presets.orchestrator === 'cloud-run' ? 'Cloud Run' :
    presets.orchestrator === 'ecs' ? 'ECS' :
    presets.orchestrator === 'serverless' ? 'Serverless' :
    presets.orchestrator === 'aks' ? 'AKS' :
    presets.orchestrator === 'eks' ? 'EKS' :
    presets.orchestrator === 'gke' ? 'GKE' :
    presets.orchestrator === 'oke' ? 'OKE' :
    files.some((f) => /azurerm_container_app|container.app/i.test(f.content))
      ? 'Container Apps'
      : files.some((f) => f.path.includes('charts/') || f.path.includes('helm'))
        ? 'Kubernetes, Helm'
        : 'Containers';

  const ci =
    presets.ci === 'azure-devops' || files.some((f) => f.path.includes('azure-pipelines'))
      ? 'Azure DevOps'
      : presets.ci === 'gitlab-ci'
        ? 'GitLab CI'
        : presets.ci === 'jenkins'
          ? 'Jenkins'
          : presets.ci === 'aws-codepipeline'
            ? 'AWS CodePipeline'
            : presets.ci === 'gcp-cloud-build'
              ? 'Google Cloud Build'
              : presets.ci === 'oci-devops'
                ? 'OCI DevOps'
                : 'GitHub Actions';

  return `${cloud}, ${orch}, ${ci}`;
}

const SAFE_FILE_PATH = /^[a-zA-Z0-9/_.\-]+$/;

/** Keep follow-up payloads small so nginx/browser don't drop the request. */
function slimExistingFiles(
  files: GeneratedFile[],
  opts?: { maxFiles?: number; maxCharsPerFile?: number; maxTotal?: number }
) {
  const MAX_FILES = opts?.maxFiles ?? 20;
  const MAX_CHARS_PER_FILE = opts?.maxCharsPerFile ?? 4000;
  const MAX_TOTAL = opts?.maxTotal ?? 80_000;
  let total = 0;
  const out: { path: string; content: string }[] = [];
  for (const f of files.slice(0, MAX_FILES)) {
    if (!SAFE_FILE_PATH.test(f.path)) continue;
    const slice = f.content.slice(0, MAX_CHARS_PER_FILE);
    if (total + slice.length > MAX_TOTAL) break;
    total += slice.length;
    out.push({ path: f.path, content: slice });
  }
  return out;
}

function slimHistory(
  history: { role: 'user' | 'assistant'; content: string }[],
  maxMessages = 12,
  maxChars = 3500
) {
  return history
    .filter((m) => m.content.trim().length > 0)
    .slice(-maxMessages)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, maxChars),
    }));
}

export default function GeneratePage() {
  const [setupDone, setSetupDone] = useState(true);
  const [step, setStep] = useState<SetupStep>(1);
  const [presets, setPresets] = useState<Presets>({
    cloud: 'aws',
    orchestrator: 'eks',
    ci: 'github-actions',
  });

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: "Hey! Describe the infrastructure you want. I'll ask clarifying questions first, draft a detailed plan for your approval, then generate Terraform, CI/CD, and orchestration scaffolds — plus a minimal health stub, not a full application.",
    }
  ]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const [files, setFiles] = useState<GeneratedFile[]>([]);
  const [hasGeneratedFiles, setHasGeneratedFiles] = useState(false);
  /** Open split workspace as soon as Approve starts — avoid chat jumping when first file arrives. */
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workflowPhase, setWorkflowPhase] = useState<WorkflowPhase | 'idle'>('idle');
  const [summary, setSummary] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [leftWidth, setLeftWidth] = useState(420);
  const [isDragging, setIsDragging] = useState(false);
  const [promptVal, setPromptVal] = useState('');
  const [showAssumptionsModal, setShowAssumptionsModal] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [lastUpdateTime, setLastUpdateTime] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('us-east-1');
  const [selectedCidr, setSelectedCidr] = useState('10.0.0.0/16');
  const [selectedSecrets, setSelectedSecrets] = useState('placeholders');
  const [selectedProbes, setSelectedProbes] = useState('enabled');
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<string[]>([]);
  const [questionAnswers, setQuestionAnswers] = useState<Record<number, string>>({});
  const [lastStackPrompt, setLastStackPrompt] = useState('');
  const [lastInterviewAnswers, setLastInterviewAnswers] = useState('');
  const [awaitingApproval, setAwaitingApproval] = useState(false);

  useEffect(() => {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLastUpdateTime(`Today, ${timeString}`);
  }, []);


  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(320, Math.min(800, e.clientX - 24));
      setLeftWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const abortController = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const filesRef = useRef<GeneratedFile[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const lastStackPromptRef = useRef('');
  const lastInterviewAnswersRef = useRef('');

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    // Keep the latest chat turn in view, including after the centered→split layout swap.
    const id = window.requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [messages, isGenerating, workspaceOpen]);

  const showWorkspace = workspaceOpen || hasGeneratedFiles;
  const orchOptions = ORCHESTRATOR_OPTIONS[presets.cloud] || [];

  const pickCloud = (cloud: CloudProvider) => {
    const first = (ORCHESTRATOR_OPTIONS[cloud]?.[0]?.value || 'eks') as Orchestrator;
    setPresets((p) => ({ ...p, cloud, orchestrator: first }));
    if (cloud === 'oracle') setSelectedRegion('ap-mumbai-1');
    else if (cloud === 'gcp') setSelectedRegion('us-central1');
    else if (cloud === 'azure') setSelectedRegion('eastus');
    else setSelectedRegion('us-east-1');
    setStep(2);
  };

  const pickOrch = (orchestrator: Orchestrator) => {
    setPresets((p) => ({ ...p, orchestrator }));
    setStep(3);
  };

  const pickCi = (ci: CIProvider) => {
    setPresets((p) => ({ ...p, ci }));
    setSetupDone(true);
    setMessages((prev) => [
      ...prev,
      {
        id: `sys-${Date.now()}`,
        role: 'system',
        content: `StackForge initialized with presets: Cloud: ${presets.cloud.toUpperCase()} · Orchestrator: ${presets.orchestrator} · CI/CD: ${ci}. Ask below to build your cloud stack!`,
      },
    ]);
  };

  const mergeFile = useCallback((file: GeneratedFile) => {
    const normalized: GeneratedFile = {
      ...file,
      language:
        !file.language ||
        file.language === 'plaintext' ||
        file.language === 'text' ||
        file.language === 'plain'
          ? getLanguageFromPath(file.path)
          : file.language,
    };
    setFiles((prev) => {
      const idx = prev.findIndex((f) => f.path === normalized.path);
      if (idx === -1) return [...prev, normalized];
      const next = [...prev];
      next[idx] = normalized;
      return next;
    });
  }, []);

  const sendMessage = useCallback(
    async (rawText: string, options?: SendOptions) => {
      const text = rawText.trim();
      if (!text || isGenerating) return;

      const priorHistory = messagesRef.current
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const startFresh =
        isFullStackPrompt(text) && !isIterativeEditPrompt(text);
      const hasFiles = filesRef.current.length > 0;
      const gated =
        options?.phase === 'generate'
          ? Boolean(options.approvedPlan)
          : requiresPlanApproval(text, hasFiles && !startFresh);

      let phase: WorkflowPhase;
      if (options?.phase) {
        phase = options.phase;
      } else if (options?.approvedPlan) {
        phase = 'generate';
      } else if (awaitingApproval && pendingPlan) {
        // User is revising an existing plan
        phase = 'plan';
      } else if (pendingQuestions.length > 0) {
        // Client answered clarifying questions → draft the plan
        phase = 'plan';
      } else if (gated) {
        // New / major stack → interview like a consultant first
        phase = 'clarify';
      } else {
        phase = 'generate';
      }
      const workflowStartedAt = Date.now();

      const isRepairTurnEarly =
        isIterativeEditPrompt(text) ||
        Boolean(options?.displayContent?.trim());

      const existing =
        startFresh ||
        phase === 'plan' ||
        phase === 'clarify' ||
        Boolean(options?.approvedPlan)
          ? []
          : slimExistingFiles(
              filesRef.current,
              isRepairTurnEarly
                ? { maxFiles: 24, maxCharsPerFile: 5000, maxTotal: 90_000 }
                : undefined
            );

      if (!options?.skipUserBubble) {
        setMessages((prev) => [
          ...prev,
          {
            id: `u-${Date.now()}`,
            role: 'user',
            content: options?.interviewChoices?.length
              ? ''
              : options?.displayContent?.trim() || text,
            kind: options?.interviewChoices?.length ? 'confirmed-choices' : 'text',
            choices: options?.interviewChoices,
          },
        ]);
      }
      setInput('');
      setIsGenerating(true);
      setWorkflowPhase(phase);
      // Chat keeps a short status only — the right panel owns detailed progress copy
      // so we don't show "architecture coming" in two places.
      setGenerationStatus(
        phase === 'clarify'
          ? 'Asking requirements…'
          : phase === 'plan'
            ? options?.priorPlan || awaitingApproval
              ? 'Revising plan…'
              : 'Planning…'
            : Boolean(options?.approvedPlan) || startFresh || !hasFiles
              ? 'Writing files…'
              : 'Working…'
      );
      setError(null);
      setWarnings([]);
      abortController.current = new AbortController();

      if (phase === 'plan' || phase === 'clarify') {
        setPendingQuestions([]);
        setQuestionAnswers({});
        // Always clear prior scaffolds when planning — never show "N files generated"
        // while the architecture is still being drafted.
        setFiles([]);
        setHasGeneratedFiles(false);
        setSummary('');
        setLastUpdateTime('—');
        // Keep the original stack request when answering questions or revising a plan
        if (phase === 'clarify' || !lastStackPromptRef.current) {
          lastStackPromptRef.current = text;
          setLastStackPrompt(text);
        } else if (
          !awaitingApproval &&
          pendingQuestions.length === 0 &&
          startFresh
        ) {
          setLastStackPrompt(text);
        }
      }

      if (phase === 'plan' || (phase === 'generate' && (startFresh || options?.approvedPlan))) {
        setWorkspaceOpen(true);
      }

      if (phase === 'generate' && (startFresh || options?.approvedPlan)) {
        setFiles([]);
        setHasGeneratedFiles(false);
        setWorkspaceOpen(true);
        setSummary('');
        setAwaitingApproval(false);
        setPendingQuestions([]);
        setQuestionAnswers({});
      }

      const originalRequestPresets = inferPresetsFromPrompt(
        [lastStackPrompt || text, options?.approvedPlan || ''].join('\n'),
        presets
      );
      const resolvedPresets = options?.approvedPlan
        ? inferPresetsFromPrompt(
            [lastStackPrompt || text, options.approvedPlan].join('\n'),
            presets
          )
        : phase === 'plan' && lastStackPrompt && text !== lastStackPrompt
          ? inferPresetsFromPrompt(text, originalRequestPresets)
          : originalRequestPresets;
      if (
        resolvedPresets.cloud !== presets.cloud ||
        resolvedPresets.orchestrator !== presets.orchestrator ||
        resolvedPresets.ci !== presets.ci
      ) {
        setPresets(resolvedPresets);
      }

      let assistantText = '';
      let receivedPlan = '';
      let receivedQuestions: string[] = [];
      const snapshotBefore =
        phase === 'generate' && !options?.approvedPlan && !startFresh
          ? filesRef.current.map((f) => ({
              path: f.path,
              content: f.content,
            }))
          : [];

      const isRepairTurn = isRepairTurnEarly;

      // Fresh generate reuses the original stack prompt; repair turns must keep
      // the fix text (otherwise Fix failures restarts the clarify interview).
      // Always append interview answers so region/DB/scale/access survive even
      // when history is cleared for Zod payload size.
      const interviewBlock =
        lastInterviewAnswersRef.current || lastInterviewAnswers || '';
      const requestPrompt =
        phase === 'generate' && lastStackPrompt && !isRepairTurn
          ? interviewBlock
            ? `${lastStackPrompt}\n\n${interviewBlock}`
            : lastStackPrompt
          : phase === 'plan' && lastStackPrompt && text !== lastStackPrompt
            ? `${lastStackPrompt}\n\nClient answers / revision feedback:\n${text}`
            : text;

      // Generate + Fix failures: files (+ fail logs) only — long chat/plans trip Zod.
      const requestHistory =
        phase === 'generate'
          ? []
          : slimHistory(
              priorHistory.map((m) => ({
                role: m.role,
                content: m.content,
              }))
            );

      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: requestPrompt.slice(0, 16000),
            presets: resolvedPresets,
            history: requestHistory,
            existingFiles: existing,
            phase,
            approvedPlan: options?.approvedPlan,
            priorPlan:
              options?.priorPlan ||
              (phase === 'plan' && awaitingApproval
                ? pendingPlan || undefined
                : undefined),
            interviewAnswers: interviewBlock
              ? interviewBlock.slice(0, 8000)
              : undefined,
          }),
          signal: abortController.current.signal,
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const apiError = data.error || 'Generation failed';
          if (/plan approval required/i.test(apiError) && !options?.approvedPlan) {
            throw new Error(
              'Starting architecture plan first — review it, then click Approve & Generate.'
            );
          }
          const detail =
            Array.isArray(data.details) && data.details[0]
              ? ` (${data.details[0].path?.join('.') || 'field'}: ${data.details[0].message})`
              : '';
          throw new Error(`${apiError}${detail}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const dataStr = trimmed.slice(6).trim();
            if (!dataStr) continue;

            let event: {
              type: string;
              file?: GeneratedFile;
              path?: string;
              summary?: string;
              warnings?: string[];
              message?: string;
              error?: string;
              plan?: string;
              questions?: string[];
            };
            try {
              event = JSON.parse(dataStr);
            } catch {
              continue;
            }

            if (event.type === 'error') {
              throw new Error(event.error || 'Generation failed');
            }

            switch (event.type) {
              case 'clear':
                setFiles([]);
                break;
              case 'status':
                if (event.message) {
                  // Keep chat status short; detailed progress lives on the right panel.
                  if (phase === 'plan') {
                    setGenerationStatus('Planning…');
                  } else if (phase === 'generate') {
                    const msg = event.message;
                    if (/validat|repair|auto-resolv/i.test(msg)) {
                      setGenerationStatus(msg);
                    } else if (/generat|writ|stream/i.test(msg)) {
                      setGenerationStatus('Writing files…');
                    } else {
                      setGenerationStatus(msg.slice(0, 48));
                    }
                  } else {
                    setGenerationStatus(event.message);
                  }
                }
                break;
              case 'file':
                if (event.file) {
                  setGenerationStatus(`Writing ${event.file.path}`);
                  mergeFile(event.file);
                  setHasGeneratedFiles(true);
                }
                break;
              case 'delete':
                if (event.path) {
                  setFiles((prev) => prev.filter((f) => f.path !== event.path));
                }
                break;
              case 'plan':
                if (event.plan) {
                  const interviewCtx = [
                    lastInterviewAnswersRef.current || lastInterviewAnswers || '',
                    lastStackPrompt || text || '',
                  ].join('\n');
                  const cleaned = sanitizePlanAgainstInterview(
                    event.plan,
                    interviewCtx
                  );
                  receivedPlan = cleaned;
                  setPendingPlan(cleaned);
                  setPendingQuestions([]);
                  setQuestionAnswers({});
                  setAwaitingApproval(true);
                }
                break;
              case 'questions':
                if (event.questions?.length) {
                  receivedQuestions = event.questions;
                  if (!lastStackPromptRef.current) {
                    lastStackPromptRef.current = text;
                    setLastStackPrompt(text);
                  }
                  setPendingQuestions(event.questions);
                  setQuestionAnswers({});
                  setAwaitingApproval(false);
                  setPendingPlan(null);
                }
                break;
              case 'summary':
                if (event.summary) {
                  assistantText = event.summary;
                  setSummary(event.summary);
                }
                break;
              case 'warnings':
                setWarnings(event.warnings || []);
                break;
              case 'done':
                setLastUpdateTime(
                  `Today, ${new Date().toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                );
                break;
            }
          }
        }

        if (phase === 'clarify' || phase === 'plan') {
          const remainingThinkingTime =
            MIN_WORKFLOW_THINKING_MS - (Date.now() - workflowStartedAt);
          if (remainingThinkingTime > 0) {
            await new Promise((resolve) =>
              window.setTimeout(resolve, remainingThinkingTime)
            );
          }
        }

        const resolvedPhase: WorkflowPhase = receivedPlan
          ? 'plan'
          : receivedQuestions.length
            ? 'clarify'
            : phase;

        if (resolvedPhase === 'plan' || resolvedPhase === 'clarify') {
          let content = assistantText || '';
          if (receivedQuestions.length) {
            content =
              content ||
              'Choose one option for each requirement below, or type a custom answer.';
          }
          if (receivedPlan) {
            // Full plan lives on the right panel (pendingPlan). Chat stays short
            // so we don't duplicate "architecture coming / plan body" in two places.
            content =
              assistantText?.trim() ||
              'Architecture plan is ready on the right. Review it, then Approve & Generate — or reply with changes.';
          }
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: 'assistant',
              content:
                content ||
                'Drafted a response — reply with answers or changes.',
            },
          ]);
        } else {
          if (options?.approvedPlan) {
            setPendingPlan(null);
            setAwaitingApproval(false);
          }
          const filesChanged =
            filesRef.current.length !== snapshotBefore.length ||
            filesRef.current.some((f) => {
              const prev = snapshotBefore.find((b) => b.path === f.path);
              return !prev || prev.content !== f.content;
            });

          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: 'assistant',
              content:
                assistantText ||
                (filesChanged
                  ? 'Updated the project files on the right.'
                  : snapshotBefore.length
                    ? 'No files were changed on the right — the previous reply may have been text only. Try your request again with more detail.'
                    : 'Generated the stack — open files on the right.'),
            },
          ]);
        }
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        const rawMsg = e instanceof Error ? e.message : 'Something went wrong';
        const msg =
          /failed to fetch|network\s?error/i.test(rawMsg)
            ? 'Could not reach the API. Try again — follow-up edits need a reachable backend (check ingress/HTTP). If the first generate worked, this is often a blocked origin or dropped large request.'
            : rawMsg;
        setError(msg);
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: 'system',
            content: msg,
          },
        ]);
      } finally {
        setIsGenerating(false);
        setGenerationStatus('');
        abortController.current = null;
        if (filesRef.current.length > 0) {
          setHasGeneratedFiles(true);
        }
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        });
        setLastUpdateTime(`Today, ${timeString}`);
      }
    },
    [
      isGenerating,
      presets,
      mergeFile,
      awaitingApproval,
      pendingPlan,
      pendingQuestions,
      lastStackPrompt,
      lastInterviewAnswers,
    ]
  );

  const approvePlan = useCallback(() => {
    const originalPrompt = lastStackPromptRef.current || lastStackPrompt;
    if (!pendingPlan || !originalPrompt || isGenerating) return;
    setWorkspaceOpen(true);
    setWorkflowPhase('generate');
    void sendMessage(originalPrompt, {
      phase: 'generate',
      approvedPlan: pendingPlan,
      skipUserBubble: true,
    });
  }, [pendingPlan, lastStackPrompt, isGenerating, sendMessage]);

  /** One-click repair from Scaffold checks — keeps files, skips clarify/plan. */
  const fixFailuresFromChecks = useCallback(
    (failReport: string) => {
      if (isGenerating || filesRef.current.length === 0) return;
      const prompt = buildValidationFixPrompt(failReport);
      void sendMessage(prompt, {
        phase: 'generate',
        displayContent:
          'Fix the failing scaffold checks and make Run all checks pass.',
      });
    },
    [isGenerating, sendMessage]
  );

  /** Workspace picks up validate-stable repairs (safe outputs, pruned refs). */
  const applyNormalizedFromChecks = useCallback((next: GeneratedFile[]) => {
    if (!next.length) return;
    setFiles(next);
    filesRef.current = next;
  }, []);

  const submitClarifyingAnswers = useCallback(() => {
    if (isGenerating || pendingQuestions.length === 0) return;

    const incomplete = pendingQuestions.some((question, index) => {
      // Already chose CI via "Change CI/CD: …" — don't require the later CI question
      if (
        isCiSystemQuestion(question) &&
        interviewAlreadyChoseCi(questionAnswers)
      ) {
        return false;
      }
      const answer = questionAnswers[index]?.trim() || '';
      if (!answer) return true;
      if (answer === 'Change the cloud') return true;
      if (answer.startsWith('Change the cloud:') && !/\|\s*Hosting:/i.test(answer)) {
        return true;
      }
      if (
        answer === 'Change the hosting platform' ||
        answer === 'Change CI/CD' ||
        answer === 'Another service' ||
        answer.endsWith(': Other')
      ) {
        return true;
      }
      const { options } = parseClarifyingQuestion(question);
      const validation = validateInterviewAnswer(question, answer, options);
      return !validation.ok;
    });
    if (incomplete) return;

    const choices = buildInterviewChoiceItems(pendingQuestions, questionAnswers);
    const formattedAnswers = formatInterviewAnswersForPlan(
      pendingQuestions,
      questionAnswers
    );
    lastInterviewAnswersRef.current = formattedAnswers;
    setLastInterviewAnswers(formattedAnswers);
    void sendMessage(formattedAnswers, { phase: 'plan', interviewChoices: choices });
  }, [isGenerating, pendingQuestions, questionAnswers, sendMessage]);

  const handleStop = () => {
    abortController.current?.abort();
    setIsGenerating(false);
    setGenerationStatus('');
  };

  const handleNew = () => {
    abortController.current?.abort();
    setSetupDone(true);
    setStep(1);
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: "Hello! I'm StackForge. Describe the infrastructure you want — I'll ask a few clarifying questions like a platform consultant, draft a detailed plan for your approval, then generate Terraform, CI/CD, and orchestration scaffolds (plus a minimal health stub — not a full application).",
      }
    ]);
    setFiles([]);
    setHasGeneratedFiles(false);
    setWorkspaceOpen(false);
    setWorkflowPhase('idle');
    setSummary('');
    setWarnings([]);
    setError(null);
    setInput('');
    setIsGenerating(false);
    setGenerationStatus('');
    setPendingPlan(null);
    setPendingQuestions([]);
    setQuestionAnswers({});
    setLastStackPrompt('');
    lastStackPromptRef.current = '';
    setLastInterviewAnswers('');
    lastInterviewAnswersRef.current = '';
    setAwaitingApproval(false);
  };


  const handleCopyAllText = useCallback(async () => {
    const blob = files
      .map((f) => `===== ${f.path} =====\n${f.content}`)
      .join('\n\n');
    await copyToClipboard(blob);
  }, [files]);

  const handleDownloadZip = useCallback(async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    files.forEach((file) => {
      zip.file(file.path, file.content);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    let filename = 'stackforge-scaffold';
    const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content;
    if (lastUser) {
      const sanitized = lastUser
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      if (sanitized) {
        filename = `stackforge-${sanitized.slice(0, 50)}`;
      }
    }
    
    a.download = `${filename}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [files, messages]);

  // ——— Setup (assessment-style) ———
  if (!setupDone) {
    return (
      <div className="min-h-screen flex flex-col bg-white bg-[linear-gradient(to_right,#80808006_1px,transparent_1px),linear-gradient(to_bottom,#80808006_1px,transparent_1px)] bg-[size:24px_24px] relative before:absolute before:inset-0 before:bg-[radial-gradient(circle_1000px_at_50%_150px,#eeeffc,transparent)] before:pointer-events-none">
        <header className="relative z-10 sticky top-0 bg-white/90 backdrop-blur-sm">
          <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
            <BrandLockup />
            <button
              type="button"
              onClick={() => setSetupDone(true)}
              className="text-sm font-medium text-[#64748B] hover:text-[#4F46E5] transition-colors cursor-pointer"
            >
              Skip
            </button>
          </div>
        </header>

        <main className="relative z-10 flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-10">
          <div className="mb-8">
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-[#0F172A]">Step {step} of 3</span>
              <span className="text-[#64748B]">{Math.round((step / 3) * 100)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-[#E2E8F0] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#4F46E5] transition-all duration-300"
                style={{ width: `${(step / 3) * 100}%` }}
              />
            </div>
          </div>

          {step === 1 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#60A5FA] mb-2">Cloud · 1 of 3</p>
              <h1 className="text-3xl font-bold text-[#0F172A] mb-2 tracking-tight">Which cloud are you on?</h1>
              <p className="text-[#64748B] mb-8">Then we&apos;ll open a chat + file workspace.</p>
              <div className="grid gap-3">
                {CLOUD_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className="text-left rounded-2xl border border-[#E2E8F0] bg-white hover:border-indigo-300 hover:bg-indigo-50/60 px-5 py-4 transition-all cursor-pointer shadow-sm"
                    onClick={() => pickCloud(opt.value as CloudProvider)}
                  >
                    <span className="block text-[15px] font-semibold text-[#0F172A]">{opt.label}</span>
                    <span className="block text-sm text-[#64748B] mt-1">{opt.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <button type="button" className="text-sm text-[#64748B] mb-4 cursor-pointer hover:text-[#4F46E5]" onClick={() => setStep(1)}>← Back</button>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#60A5FA] mb-2">Orchestration · 2 of 3</p>
              <h1 className="text-3xl font-bold text-[#0F172A] mb-2 tracking-tight">How do you run containers?</h1>
              <div className="grid gap-3 mt-8">
                {orchOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className="text-left rounded-2xl border border-[#E2E8F0] bg-white hover:border-indigo-300 hover:bg-indigo-50/60 px-5 py-4 transition-all cursor-pointer shadow-sm"
                    onClick={() => pickOrch(opt.value as Orchestrator)}
                  >
                    <span className="block text-[15px] font-semibold text-[#0F172A]">{opt.label}</span>
                    <span className="block text-sm text-[#64748B] mt-1">{opt.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <button type="button" className="text-sm text-[#64748B] mb-4 cursor-pointer hover:text-[#4F46E5]" onClick={() => setStep(2)}>← Back</button>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#60A5FA] mb-2">CI / CD · 3 of 3</p>
              <h1 className="text-3xl font-bold text-[#0F172A] mb-2 tracking-tight">Where does your pipeline live?</h1>
              <p className="text-[#64748B] mb-2 text-sm">
                Includes GitHub, GitLab, Jenkins, Azure DevOps, plus AWS CodePipeline, Google Cloud Build, and OCI DevOps.
              </p>
              <div className="grid gap-3 mt-6">
                {(CI_OPTIONS_BY_CLOUD[presets.cloud] || [])
                  .map((value) => CI_OPTIONS.find((opt) => opt.value === value))
                  .filter((opt): opt is (typeof CI_OPTIONS)[number] => Boolean(opt))
                  .map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className="text-left rounded-2xl border border-[#E2E8F0] bg-white hover:border-indigo-300 hover:bg-indigo-50/60 px-5 py-4 transition-all cursor-pointer shadow-sm"
                    onClick={() => pickCi(opt.value as CIProvider)}
                  >
                    <span className="block text-[15px] font-semibold text-[#0F172A]">{opt.label}</span>
                    <span className="block text-sm text-[#64748B] mt-1">{opt.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  // Dynamic project name + provider — only claim files once they exist
  const hasFiles = files.length > 0;
  const planReady = awaitingApproval && Boolean(pendingPlan) && !isGenerating;
  const draftingPlan = workflowPhase === 'plan' && isGenerating;
  const parsedProjName = hasFiles
    ? deriveProjectName(files, promptVal || input, presets)
    : planReady
      ? 'Plan ready'
      : draftingPlan
        ? 'Planning…'
        : workflowPhase === 'generate' && isGenerating
          ? 'Generating…'
          : '—';
  const parsedProvider = deriveProviderLabel(files, presets);
  const blueprintLabel = hasFiles
    ? isGenerating
      ? `${files.length} files writing…`
      : `${files.length} files generated`
    : planReady
      ? 'No files yet — awaiting approval'
      : draftingPlan
        ? 'No files yet — planning'
        : workflowPhase === 'generate' && isGenerating
          ? 'Waiting for first file…'
          : 'No files yet';
  const canExport = hasFiles && !isGenerating;

  const discardPlan = () => {
    setAwaitingApproval(false);
    setPendingPlan(null);
    setPendingQuestions([]);
    setQuestionAnswers({});
    setLastStackPrompt('');
    lastStackPromptRef.current = '';
    setLastInterviewAnswers('');
    lastInterviewAnswersRef.current = '';
    setWorkspaceOpen(false);
    setWorkflowPhase('idle');
  };

  // ——— Workspace (MVP-matched empty state) ———
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white bg-[linear-gradient(to_right,#80808006_1px,transparent_1px),linear-gradient(to_bottom,#80808006_1px,transparent_1px)] bg-[size:24px_24px]">
      {showWorkspace && (
        <header className="border-b border-gray-200 sticky top-0 bg-white z-50 shrink-0 select-none">
          <div className="px-6 h-14 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="text-gray-400 hover:text-gray-600 transition-colors mr-1 cursor-pointer"
                title="Toggle Sidebar"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              
              <BrandLockup />
            </div>
            
            <div className="flex items-center gap-4 shrink-0">
              {isGenerating && (
                <button
                  type="button"
                  onClick={handleStop}
                  className="text-xs font-semibold px-4 py-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white shadow-sm rounded-xl transition-all duration-200 active:scale-95 cursor-pointer"
                >
                  Stop
                </button>
              )}
              <button
                type="button"
                onClick={handleNew}
                className="text-xs font-semibold px-4 py-2.5 bg-indigo-600 hover:bg-indigo-750 text-white shadow-sm rounded-xl transition-all duration-200 active:scale-95 cursor-pointer"
              >
                New Project
              </button>
            </div>
          </div>
        </header>
      )}

      {!showWorkspace && (
        <div className="absolute top-6 left-8 z-50">
          <BrandLockup />
        </div>
      )}

      {showWorkspace ? (
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 p-4 gap-4 bg-white relative overflow-hidden before:absolute before:inset-0 before:bg-[radial-gradient(circle_900px_at_50%_80px,#eeeffc,transparent_72%)] before:pointer-events-none">
          {/* LEFT — AI Assistant Sidebar */}
          <aside
            style={{ width: isSidebarOpen ? `${leftWidth}px` : '0px' }}
            className={`relative z-10 shrink-0 flex flex-col gap-3.5 min-h-0 select-none ${isSidebarOpen ? 'opacity-100' : 'w-0 opacity-0 overflow-hidden pointer-events-none hidden'} transition-all duration-300`}
          >
            {/* Interactive Chat Log */}
            <div className="bg-white border border-indigo-100 rounded-2xl p-4.5 shadow-sm flex-1 flex flex-col min-h-0 relative">
              <div className="flex items-center justify-between mb-3.5 border-b border-gray-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-gray-900 tracking-wider uppercase font-sans">AI Assistant Chat</h3>
                  <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full uppercase tracking-wider border border-indigo-100">
                    BETA
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPromptVal('');
                    handleNew();
                  }}
                  className="text-[10px] text-indigo-600 hover:text-indigo-700 font-bold transition-colors cursor-pointer"
                >
                  Reset Chat
                </button>
              </div>

              {/* Chat Messages Feed */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-3 mb-3 pr-1 text-xs select-text scrollbar-thin min-w-0">
                {messages.map((m, idx) => (
                  <div
                    key={m.id || idx}
                    className={`flex gap-2.5 items-start min-w-0 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {m.role !== 'user' ? (
                      <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center text-white shrink-0 shadow-sm border border-indigo-200/20 select-none ring-2 ring-indigo-50" aria-hidden>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21l8.982-11.795H13.62l1.382-7.205L6 13.795h5.196l-.383 2.11z" />
                        </svg>
                      </div>
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-[#4F46E5] flex items-center justify-center text-white shrink-0 shadow-sm text-[10px] font-extrabold font-sans tracking-wide select-none" aria-hidden>
                        US
                      </div>
                    )}
                    <div className={`min-w-0 flex flex-col ${m.role === 'user' ? 'max-w-[88%] items-end' : 'max-w-[88%]'}`}>
                      {m.kind === 'confirmed-choices' && m.choices?.length ? (
                        <div className="w-full max-w-md">
                          {renderChatMessage(m, '')}
                        </div>
                      ) : (
                        <div
                          className={`rounded-2xl px-3.5 py-2.5 leading-relaxed min-w-0 max-w-full overflow-hidden ${
                            m.role === 'user'
                              ? 'bg-[#4F46E5] text-white rounded-tr-sm shadow-md shadow-indigo-200/40 font-medium'
                                : m.role === 'system'
                                ? 'bg-rose-50 border border-rose-200/80 text-rose-800 rounded-xl shadow-sm'
                                : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm'
                          }`}
                        >
                          {renderChatMessage(
                            m,
                            m.role === 'user'
                              ? 'text-white'
                              : m.role === 'system'
                                ? 'text-rose-800'
                                : 'text-slate-700'
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isGenerating && (
                  <div className="flex gap-2.5 items-center" role="status" aria-label="Generating">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center text-white shrink-0 shadow-sm">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21l8.982-11.795H13.62l1.382-7.205L6 13.795h5.196l-.383 2.11z" />
                      </svg>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white min-h-8 px-3 shadow-xs text-[11px] font-medium text-indigo-700 max-w-[260px]">
                      <span className="loading-dots" aria-hidden>
                        <span />
                        <span />
                        <span />
                      </span>
                      <span className="truncate">{generationStatus || 'Thinking…'}</span>
                    </div>
                  </div>
                )}
                {awaitingApproval && pendingPlan && !isGenerating && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[11px] text-slate-600 leading-relaxed">
                    Plan is ready on the right — use <span className="font-semibold text-slate-800">Approve &amp; Generate</span> there, or reply here with changes.
                  </div>
                )}
                {pendingQuestions.length > 0 && !isGenerating && !awaitingApproval && (
                  <ClarifyingInterview
                    key={pendingQuestions.join('||')}
                    questions={pendingQuestions}
                    answers={questionAnswers}
                    onAnswer={(index, answer) =>
                      setQuestionAnswers((current) => ({
                        ...current,
                        [index]: answer,
                      }))
                    }
                    onSubmit={submitClarifyingAnswers}
                  />
                )}
              </div>
              {/* Input section at bottom of chat card */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (promptVal.trim()) {
                    void sendMessage(promptVal, {
                      phase: awaitingApproval && pendingPlan ? 'plan' : undefined,
                      priorPlan: awaitingApproval ? pendingPlan || undefined : undefined,
                    });
                    setPromptVal('');
                  }
                }}
                className="mt-3.5 pt-3.5 border-t border-gray-100 relative flex items-center gap-2 bg-white border border-gray-200 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 rounded-full p-2 pl-4 shrink-0 transition-all duration-200 shadow-[0_4px_12px_rgba(37,99,235,0.04)] focus-within:shadow-[0_6px_20px_rgba(37,99,235,0.08)]"
              >
                <input
                  type="text"
                  value={promptVal}
                  onChange={(e) => setPromptVal(e.target.value)}
                  disabled={isGenerating}
                  placeholder={
                    awaitingApproval
                      ? 'Describe plan changes…'
                      : pendingQuestions.length
                        ? 'Type your choices or your own answer…'
                        : hasFiles
                          ? 'Ask about files, request a small infra change, or fix checks…'
                          : 'Describe the cloud stack you want…'
                  }
                  className="flex-1 bg-transparent text-xs text-slate-900 placeholder-slate-400 focus:outline-none pl-1 py-1.5 border-0 min-w-0 font-sans"
                />
                <button
                  type="submit"
                  disabled={isGenerating || !promptVal.trim()}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-gradient-to-tr from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white transition-all shrink-0 cursor-pointer shadow-xs disabled:opacity-40 disabled:pointer-events-none active:scale-95"
                  title="Send message"
                >
                  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                </button>
              </form>
            </div>

            {/* Powered by */}
            <p className="text-[9px] text-slate-400 font-semibold tracking-wider text-center py-1.5 shrink-0 uppercase select-none opacity-80">
              🚀 Powered by Enlight Lab AI
            </p>
          </aside>

          {/* Resizable Divider separator handle */}
          {isSidebarOpen && (
            <div
              onMouseDown={() => setIsDragging(true)}
              className="w-1 cursor-col-resize hover:w-1.5 active:w-1.5 bg-gray-200 hover:bg-indigo-500 active:bg-indigo-650 self-stretch shrink-0 transition-all rounded shadow-inner"
              title="Drag to resize sidebar"
            />
          )}

          {/* RIGHT — IDE / files area */}
          <section className="relative z-10 flex-1 min-w-0 flex flex-col gap-4 overflow-hidden">
            {/* Stats Row */}
            <div className="bg-white border border-gray-200 rounded-xl px-5 py-3.5 shadow-sm flex flex-col lg:flex-row items-center justify-between gap-4 select-none shrink-0">
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3.5 w-full lg:w-auto">
                {/* Stat 1: Project */}
                <div className="flex items-center gap-2.5 shrink-0">
                  <div className="w-8 h-8 rounded-lg bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-500 shrink-0 shadow-xs">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider leading-none">Project</p>
                    <p className="text-xs font-bold text-gray-800 mt-1 truncate max-w-[130px]" title={parsedProjName}>
                      {parsedProjName}
                    </p>
                  </div>
                </div>

                {/* Stat 2: Workspace Blueprint */}
                <div className="flex items-center gap-2.5 shrink-0">
                  <div className="w-8 h-8 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 shrink-0 shadow-xs">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider leading-none">Workspace Blueprint</p>
                    <p className="text-xs font-bold text-gray-800 mt-1">
                      {blueprintLabel}
                    </p>
                  </div>
                </div>

                {/* Stat 3: Provider */}
                <div className="flex items-center gap-2.5 shrink-0">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-500 shrink-0 shadow-xs">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a3 3 0 1 1 0-6h19.5a3 3 0 1 1 0 6" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider leading-none">Provider</p>
                    <p className="text-xs font-bold text-gray-800 mt-1 uppercase truncate max-w-[140px]" title={parsedProvider}>
                      {parsedProvider}
                    </p>
                  </div>
                </div>

                {/* Stat 4: Last updated */}
                <div className="flex items-center gap-2.5 shrink-0">
                  <div className="w-8 h-8 rounded-lg bg-green-50 border border-green-100 flex items-center justify-center text-green-600 shrink-0 shadow-xs">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider leading-none">Last updated</p>
                    <p className="text-xs font-bold text-gray-800 mt-1">
                      {lastUpdateTime}
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2.5 shrink-0 w-full lg:w-auto justify-end">
                <button
                  type="button"
                  onClick={handleDownloadZip}
                  disabled={!canExport}
                  className="text-xs font-bold px-4 py-2.5 bg-white hover:bg-slate-50 text-[#4F46E5] hover:text-[#4338CA] border border-gray-250 rounded-xl shadow-sm transition-all active:scale-95 cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Download ZIP
                </button>
                <button
                  type="button"
                  onClick={handleCopyAllText}
                  disabled={!canExport}
                  className="text-xs font-bold px-4 py-2.5 bg-[#4F46E5] hover:bg-[#4338CA] text-white shadow-md shadow-indigo-200/50 rounded-xl transition-all active:scale-95 cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5A3.375 3.375 0 0 0 6.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0 0 15 2.25h-1.5a2.251 2.251 0 0 0-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5" />
                  </svg>
                  Copy all
                </button>
              </div>
            </div>

            {/* Split View Editor Workspace */}
            <div className="flex-1 min-h-0 overflow-hidden bg-white flex flex-col transition-opacity duration-300">
              <WorkflowPanel
                phase={workflowPhase}
                files={files}
                isGenerating={isGenerating}
                generationStatus={generationStatus}
                promptText={promptVal}
                pendingPlan={pendingPlan}
                awaitingApproval={awaitingApproval}
                onApprove={approvePlan}
                onDiscard={discardPlan}
                onFixFailures={fixFailuresFromChecks}
                onNormalizedFiles={applyNormalizedFromChecks}
              />
            </div>
          </section>
        </div>
      ) : messages.some(m => m.role === 'user') ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-white p-6 relative overflow-y-auto before:absolute before:inset-0 before:bg-[radial-gradient(circle_900px_at_50%_150px,#eeeffc,transparent_72%)] before:pointer-events-none">
          <div className="w-full max-w-2xl bg-white border border-indigo-100 rounded-[28px] shadow-[0_20px_50px_-24px_rgba(37,99,235,0.25)] p-6 sm:p-7 flex flex-col min-h-[380px] max-h-[70vh] relative z-10">
            <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-4 mb-4 pr-1 min-w-0">
              {messages.map((m, idx) => (
                <div
                  key={m.id}
                  className={`w-full flex gap-2.5 min-w-0 ${m.role === 'user' ? 'justify-end' : 'justify-start'} items-start`}
                >
                  {m.role !== 'user' && (
                    <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center text-white shrink-0 shadow-sm border border-indigo-200/20 select-none ring-2 ring-indigo-50">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21l8.982-11.795H13.62l1.382-7.205L6 13.795h5.196l-.383 2.11z" />
                      </svg>
                    </div>
                  )}
                  <div className={`min-w-0 max-w-[85%] flex flex-col ${m.role === 'user' ? 'items-end' : ''}`}>
                    {m.kind === 'confirmed-choices' && m.choices?.length ? (
                      <div className="w-full max-w-md">
                        {renderChatMessage(m, '')}
                      </div>
                    ) : (
                      <div
                        className={`rounded-2xl px-4 py-2.5 min-w-0 max-w-full overflow-hidden ${
                          m.role === 'user'
                            ? 'bg-[#4F46E5] text-white rounded-tr-sm shadow-md shadow-indigo-200/40'
                            : m.role === 'system'
                              ? 'bg-rose-50 text-rose-800 border border-rose-200/80 rounded-xl'
                              : 'bg-white border border-[#E2E8F0] text-[#0F172A] rounded-tl-sm shadow-sm'
                        }`}
                      >
                        {renderChatMessage(
                          m,
                          m.role === 'user' ? 'text-white' : m.role === 'system' ? 'text-rose-800' : 'text-slate-700'
                        )}
                      </div>
                    )}
                  </div>
                  {m.role === 'user' && (
                    <div className="w-7 h-7 rounded-full bg-[#4F46E5] flex items-center justify-center text-white shrink-0 shadow-sm text-[10px] font-extrabold font-sans tracking-wide select-none">
                      US
                    </div>
                  )}
                </div>
              ))}
              {isGenerating && (
                <div className="flex gap-2 items-center" role="status" aria-label="Generating">
                  <div className="w-7 h-7 rounded-full bg-[#4F46E5] flex items-center justify-center text-white shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21l8.982-11.795H13.62l1.382-7.205L6 13.795h5.196l-.383 2.11z" />
                    </svg>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white min-h-8 px-3 shadow-sm text-xs font-medium text-indigo-700 max-w-[300px]">
                    <span className="loading-dots" aria-hidden>
                      <span />
                      <span />
                      <span />
                    </span>
                    <span className="truncate">{generationStatus || 'Thinking…'}</span>
                  </div>
                </div>
              )}
              {awaitingApproval && pendingPlan && !isGenerating && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[11px] text-slate-600 leading-relaxed">
                  Plan is ready — approve on the main panel, or reply with changes.
                </div>
              )}
              {pendingQuestions.length > 0 && !isGenerating && !awaitingApproval && (
                <ClarifyingInterview
                  key={pendingQuestions.join('||')}
                  questions={pendingQuestions}
                  answers={questionAnswers}
                  onAnswer={(index, answer) =>
                    setQuestionAnswers((current) => ({
                      ...current,
                      [index]: answer,
                    }))
                  }
                  onSubmit={submitClarifyingAnswers}
                />
              )}
              <div ref={chatEndRef} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (input.trim().length >= 1) {
                  void sendMessage(input, {
                    phase: awaitingApproval && pendingPlan ? 'plan' : undefined,
                    priorPlan: awaitingApproval ? pendingPlan || undefined : undefined,
                  });
                }
              }}
              className="relative rounded-full bg-white border border-gray-200 shadow-[0_8px_30px_rgba(37,99,235,0.08)] focus-within:border-indigo-400 focus-within:shadow-[0_10px_36px_rgba(37,99,235,0.12)] focus-within:ring-2 focus-within:ring-indigo-100 p-2 pl-6 flex items-center gap-3 transition-all"
            >
              <input
                type="text"
                className="flex-1 bg-transparent text-[15px] leading-relaxed text-gray-900 placeholder-gray-400 focus:outline-none py-2.5 border-0 min-w-0 font-sans"
                placeholder={
                  awaitingApproval
                    ? 'Describe plan changes, then send…'
                    : pendingQuestions.length
                      ? 'Or type an extra note…'
                      : files.length > 0
                        ? 'Ask about a file, request a small infra change, or fix check failures…'
                        : 'Ask anything, e.g. deploy a Node.js API with PostgreSQL to AWS EKS'
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isGenerating}
              />
              <button
                type="submit"
                className="w-10 h-10 flex items-center justify-center rounded-full bg-gradient-to-tr from-indigo-600 to-violet-600 text-white hover:from-indigo-700 hover:to-violet-700 transition-all shrink-0 cursor-pointer shadow-sm disabled:opacity-40 disabled:pointer-events-none"
                disabled={isGenerating || input.trim().length < 1}
                aria-label="Send"
              >
                <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col bg-white overflow-hidden relative before:absolute before:inset-0 before:bg-[radial-gradient(circle_900px_at_50%_150px,#eeeffc,transparent_72%)] before:pointer-events-none">
          <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 pb-16 pt-24 w-full">
            <div className="flex flex-col items-center text-center w-full px-2">
              {/* Messaging icon — white tile + blue outlined bubble with 3 text lines */}
              <div className="w-[52px] h-[52px] rounded-[16px] bg-white flex items-center justify-center mb-7 shadow-[0_8px_24px_rgba(37,99,235,0.12)] border border-white">
                <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M5 6.5C5 5.12 6.12 4 7.5 4h9C17.88 4 19 5.12 19 6.5v7c0 1.38-1.12 2.5-2.5 2.5H11l-3.2 2.4c-.55.41-1.3.02-1.3-.66V16H7.5C6.12 16 5 14.88 5 13.5v-7Z"
                    stroke="#4F46E5"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                  <path d="M8 8.25h8M8 11h8M8 13.75h4.5" stroke="#4F46E5" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </div>

              <h1 className="text-[40px] sm:text-[44px] font-extrabold text-gray-900 tracking-tight leading-tight font-sans">
                Create your Terraform scripts in minutes.
              </h1>

              {/* Subtitle + input share the same width (one-line subtitle drives the box length) */}
              <div className="mt-4 inline-flex flex-col items-stretch max-w-full">
                <p className="text-[15px] sm:text-[16px] text-gray-500 leading-relaxed font-normal whitespace-nowrap text-center">
                  Describe the stack — I&apos;ll interview you, draft a plan, then generate Terraform, CI/CD, and a minimal health stub.
                </p>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (input.trim().length >= 1) {
                      void sendMessage(input);
                    }
                  }}
                  className="mt-9 w-full relative rounded-full bg-white border border-gray-200 shadow-[0_8px_30px_rgba(37,99,235,0.08)] focus-within:border-indigo-400 focus-within:shadow-[0_10px_36px_rgba(37,99,235,0.12)] focus-within:ring-2 focus-within:ring-indigo-100 p-2 pl-6 flex items-center gap-3 transition-all duration-200"
                >
                  <input
                    className="flex-1 bg-transparent text-[15px] text-gray-900 placeholder-gray-400 focus:outline-none py-2.5 border-0 min-w-0 font-sans"
                    placeholder="Ask anything, e.g. deploy a Node.js API with PostgreSQL to AWS EKS"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={isGenerating}
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="w-10 h-10 flex items-center justify-center rounded-full bg-gradient-to-tr from-indigo-600 to-violet-600 text-white hover:from-indigo-700 hover:to-violet-700 transition-all shrink-0 cursor-pointer shadow-sm disabled:opacity-40 disabled:pointer-events-none"
                    disabled={isGenerating || input.trim().length < 1}
                    aria-label="Send"
                  >
                    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                  </button>
                </form>
              </div>
            </div>
          </div>

          <div className="relative z-10 pb-7 flex justify-center">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-[13px] text-gray-500 bg-white border border-gray-200 rounded-full px-4 py-2.5 no-underline hover:text-gray-700 hover:border-gray-300 transition-colors font-medium shadow-sm"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#4F46E5] animate-blink-dot" />
              <span>Scroll to learn more</span>
              <svg className="w-3.5 h-3.5 text-[#4F46E5]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </Link>
          </div>
        </div>
      )}

      {showAssumptionsModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 select-none animate-fade-slide-up">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-2xl max-w-md w-full flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 uppercase flex items-center gap-1.5">
                <span>⚙️</span> Configure Assumptions
              </h3>
              <button
                onClick={() => setShowAssumptionsModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4 py-2">
              {/* Region Option */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Region</label>
                <select
                  value={selectedRegion}
                  onChange={(e) => setSelectedRegion(e.target.value)}
                  className="w-full bg-slate-50 hover:bg-slate-100/80 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 focus:outline-none transition-all cursor-pointer font-medium"
                >
                  <option value="us-east-1">AWS: us-east-1 (N. Virginia)</option>
                  <option value="us-west-2">AWS: us-west-2 (Oregon)</option>
                  <option value="ap-mumbai-1">OCI: ap-mumbai-1 (Mumbai)</option>
                  <option value="us-central1">GCP: us-central1 (Iowa)</option>
                  <option value="eastus">Azure: eastus (East US)</option>
                </select>
              </div>

              {/* CIDR Option */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">VPC / VCN CIDR</label>
                <select
                  value={selectedCidr}
                  onChange={(e) => setSelectedCidr(e.target.value)}
                  className="w-full bg-slate-50 hover:bg-slate-100/80 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 focus:outline-none transition-all cursor-pointer font-medium"
                >
                  <option value="10.0.0.0/16">10.0.0.0/16 (Default)</option>
                  <option value="172.16.0.0/16">172.16.0.0/16</option>
                  <option value="192.168.0.0/16">192.168.0.0/16</option>
                </select>
              </div>

              {/* Secrets Option */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Secrets Handling</label>
                <select
                  value={selectedSecrets}
                  onChange={(e) => setSelectedSecrets(e.target.value)}
                  className="w-full bg-slate-50 hover:bg-slate-100/80 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 focus:outline-none transition-all cursor-pointer font-medium"
                >
                  <option value="placeholders">Environment placeholders</option>
                  <option value="vault">HashiCorp Vault</option>
                  <option value="native">Native Secrets Manager</option>
                </select>
              </div>

              {/* Probes Option */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Health Probes</label>
                <select
                  value={selectedProbes}
                  onChange={(e) => setSelectedProbes(e.target.value)}
                  className="w-full bg-slate-50 hover:bg-slate-100/80 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 focus:outline-none transition-all cursor-pointer font-medium"
                >
                  <option value="enabled">Enabled (liveness + readiness)</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 mt-2">
              <button
                type="button"
                onClick={() => setShowAssumptionsModal(false)}
                className="text-xs font-bold px-4 py-2 bg-slate-100 hover:bg-slate-200 text-gray-700 rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAssumptionsModal(false);
                  const targetPrompt = promptVal.trim();
                  if (targetPrompt) {
                    const extraInstructions = `\n\n[Assumptions configuration: Region=${selectedRegion}, CIDR=${selectedCidr}, Secrets=${selectedSecrets}, Probes=${selectedProbes}]`;
                    void sendMessage(targetPrompt + extraInstructions);
                  }
                }}
                className="bg-indigo-600 hover:bg-indigo-750 text-white px-5 py-2.5 rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer active:scale-95"
              >
                Apply & Regenerate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
