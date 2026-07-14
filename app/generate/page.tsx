'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import type {
  Presets,
  GeneratedFile,
  CloudProvider,
  Orchestrator,
  CIProvider,
} from '@/types';
import {
  CLOUD_OPTIONS,
  ORCHESTRATOR_OPTIONS,
  CI_OPTIONS,
} from '@/types';
import { LeadCapture } from '@/components/LeadCapture';
import { FileViewer } from '@/components/FileViewer';

type SetupStep = 1 | 2 | 3 | 4;

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
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
      content: "Hello! I'm StackForge, your AI platform engineering assistant. Describe the infrastructure stack you want to build (e.g., 'A Node.js REST API on Oracle Cloud OKE with a load balancer and GitHub Actions CI'), and I'll generate the Terraform configurations, Dockerfiles, Helm charts, and CI/CD pipelines for you!",
    }
  ]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [files, setFiles] = useState<GeneratedFile[]>([]);
  const [summary, setSummary] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const abortController = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const filesRef = useRef<GeneratedFile[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, statusMessage, isGenerating]);

  const orchOptions = ORCHESTRATOR_OPTIONS[presets.cloud] || [];

  const pickCloud = (cloud: CloudProvider) => {
    const first = (ORCHESTRATOR_OPTIONS[cloud]?.[0]?.value || 'eks') as Orchestrator;
    setPresets((p) => ({ ...p, cloud, orchestrator: first }));
    setStep(2);
  };

  const pickOrch = (orchestrator: Orchestrator) => {
    setPresets((p) => ({ ...p, orchestrator }));
    setStep(3);
  };

  const pickCi = (ci: CIProvider) => {
    setPresets((p) => ({ ...p, ci }));
    setStep(4);
  };

  const mergeFile = useCallback((file: GeneratedFile) => {
    setFiles((prev) => {
      const idx = prev.findIndex((f) => f.path === file.path);
      if (idx === -1) return [...prev, file];
      const next = [...prev];
      next[idx] = file;
      return next;
    });
  }, []);

  const sendMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || isGenerating) return;

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text,
      };

      const priorHistory = messagesRef.current
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const existing = filesRef.current.map((f) => ({
        path: f.path,
        content: f.content,
      }));

      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setIsGenerating(true);
      setError(null);
      setWarnings([]);
      setStatusMessage('Thinking…');
      abortController.current = new AbortController();

      let assistantText = '';

      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: text,
            presets,
            history: priorHistory,
            existingFiles: existing,
          }),
          signal: abortController.current.signal,
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Generation failed');
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
              case 'status':
                if (event.message) setStatusMessage(event.message);
                break;
              case 'file':
                if (event.file) mergeFile(event.file);
                break;
              case 'delete':
                if (event.path) {
                  setFiles((prev) => prev.filter((f) => f.path !== event.path));
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
                setStatusMessage('');
                break;
            }
          }
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content:
              assistantText ||
              (existing.length
                ? 'Updated the project files on the right.'
                : 'Generated the stack — open files on the right.'),
          },
        ]);
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        const msg = e instanceof Error ? e.message : 'Something went wrong';
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
        setStatusMessage('');
        abortController.current = null;
      }
    },
    [isGenerating, presets, mergeFile]
  );

  const startSession = () => {
    if (input.trim().length < 10) return;
    const first = input.trim();
    setSetupDone(true);
    setMessages([
      {
        id: 'sys-0',
        role: 'system',
        content: `Presets: ${presets.cloud.toUpperCase()} · ${presets.orchestrator} · ${presets.ci}. Chat to build and keep editing — files update on the right.`,
      },
    ]);
    // Defer send so setupDone renders workspace first
    setTimeout(() => void sendMessage(first), 0);
  };

  const handleStop = () => {
    abortController.current?.abort();
    setIsGenerating(false);
    setStatusMessage('');
  };

  const handleNew = () => {
    abortController.current?.abort();
    setSetupDone(true);
    setStep(1);
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: "Hello! I'm StackForge, your AI platform engineering assistant. Describe the infrastructure stack you want to build (e.g., 'A Node.js REST API on Oracle Cloud OKE with a load balancer and GitHub Actions CI'), and I'll generate the Terraform configurations, Dockerfiles, Helm charts, and CI/CD pipelines for you!",
      }
    ]);
    setFiles([]);
    setSummary('');
    setWarnings([]);
    setError(null);
    setInput('');
    setStatusMessage('');
    setIsGenerating(false);
  };

  // ——— Setup (assessment-style) ———
  if (!setupDone) {
    return (
      <div className="min-h-screen flex flex-col">
        <header className="border-b border-gray-100 sticky top-0 bg-white/95 backdrop-blur-sm z-50">
          <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <img src="/enlight-labs-logo.png" alt="Enlight Lab" className="h-10 w-auto object-contain" />
            </Link>
            <Link href="/" className="text-sm font-medium text-gray-500 hover:text-indigo-600 transition-colors no-underline">
              Home
            </Link>
          </div>
        </header>

        <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-10">
          <div className="mb-8">
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium">Step {step} of 4</span>
              <span className="text-[var(--muted-text)]">{Math.round((step / 4) * 100)}%</span>
            </div>
            <div className="progress-track h-1.5">
              <div
                className="progress-fill-blue h-full"
                style={{ width: `${(step / 4) * 100}%`, animation: 'none' }}
              />
            </div>
          </div>

          {step === 1 && (
            <div>
              <p className="section-label mb-2">Cloud · 1 of 4</p>
              <h1 className="text-3xl font-bold mb-2">Which cloud are you on?</h1>
              <p className="text-[var(--muted-text)] mb-8">Then we’ll open a chat + file workspace.</p>
              <div className="grid gap-3">
                {CLOUD_OPTIONS.map((opt) => (
                  <button key={opt.value} type="button" className="choice-card" onClick={() => pickCloud(opt.value as CloudProvider)}>
                    <span className="choice-card-title">{opt.label}</span>
                    <span className="choice-card-desc">{opt.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <button type="button" className="text-sm text-[var(--muted-text)] mb-4" onClick={() => setStep(1)}>← Back</button>
              <p className="section-label mb-2">Orchestration · 2 of 4</p>
              <h1 className="text-3xl font-bold mb-2">How do you run containers?</h1>
              <div className="grid gap-3 mt-8">
                {orchOptions.map((opt) => (
                  <button key={opt.value} type="button" className="choice-card" onClick={() => pickOrch(opt.value as Orchestrator)}>
                    <span className="choice-card-title">{opt.label}</span>
                    <span className="choice-card-desc">{opt.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <button type="button" className="text-sm text-[var(--muted-text)] mb-4" onClick={() => setStep(2)}>← Back</button>
              <p className="section-label mb-2">CI / CD · 3 of 4</p>
              <h1 className="text-3xl font-bold mb-2">Where does your pipeline live?</h1>
              <div className="grid gap-3 mt-8">
                {CI_OPTIONS.map((opt) => (
                  <button key={opt.value} type="button" className="choice-card" onClick={() => pickCi(opt.value as CIProvider)}>
                    <span className="choice-card-title">{opt.label}</span>
                    <span className="choice-card-desc">{opt.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <button type="button" className="text-sm text-[var(--muted-text)] mb-4" onClick={() => setStep(3)}>← Back</button>
              <p className="section-label mb-2">Describe · 4 of 4</p>
              <h1 className="text-3xl font-bold mb-2">What should we build?</h1>
              <p className="text-[var(--muted-text)] mb-6">
                Locked:{' '}
                <span className="font-medium text-[var(--navy-heading)]">
                  {presets.cloud.toUpperCase()} · {presets.orchestrator} · {presets.ci}
                </span>
              </p>
              <textarea
                className="textarea w-full rounded-xl border border-[var(--border-color)] bg-white p-4 text-base min-h-[120px] focus:outline-none focus:ring-2 focus:ring-[var(--primary-blue)]/20"
                placeholder="e.g., Create Terraform for a Node API on EKS with autoscaling and staging"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={4000}
              />
              <div className="flex justify-between items-center mt-4 gap-3">
                <p className="text-xs text-[var(--muted-text)]">You’ll chat + edit files next (Lovable-style)</p>
                <button
                  type="button"
                  className="btn-primary disabled:opacity-50"
                  disabled={input.trim().length < 10}
                  onClick={startSession}
                >
                  Open workspace →
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  // ——— Lovable-style workspace ———
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[var(--page-bg)]">
      <header className="border-b border-gray-100 sticky top-0 bg-white/95 backdrop-blur-sm z-50 shrink-0">
        <div className="px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" className="flex items-center gap-2 shrink-0">
              <img src="/enlight-labs-logo.png" alt="Enlight Lab" className="h-10 w-auto object-contain" />
            </Link>
            <span className="text-xs text-[var(--muted-text)] truncate hidden md:inline border-l border-gray-200 pl-3">
              Infrastructure Workspace
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isGenerating && (
              <button type="button" onClick={handleStop} className="text-xs bg-red-600 hover:bg-red-700 text-white px-3.5 py-2 rounded-lg transition-colors font-medium">
                Stop
              </button>
            )}
            <button type="button" onClick={handleNew} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-lg transition-colors font-medium">
              New Project
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* LEFT — Chat */}
        <section className="w-full lg:w-[380px] xl:w-[420px] shrink-0 border-b lg:border-b-0 lg:border-r border-[var(--border-color)] bg-white flex flex-col min-h-0 max-h-[40vh] lg:max-h-none">
          <div className="px-4 py-3 border-b border-[var(--border-color)]">
            <p className="text-sm font-semibold text-[var(--navy-heading)]">Chat</p>
            <p className="text-xs text-[var(--muted-text)]">Ask for changes — files update on the right</p>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-xl px-3 py-2 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[var(--primary-blue)] text-white ml-6'
                    : m.role === 'system'
                      ? 'bg-amber-50 text-[var(--muted-text)] border border-amber-100'
                      : 'bg-gray-100 text-[var(--body-text)] mr-4'
                }`}
              >
                {m.content}
              </div>
            ))}
            {isGenerating && (
              <div className="rounded-xl bg-blue-50 border border-blue-100 px-3 py-2 text-sm text-[var(--primary-blue)]">
                {statusMessage || 'Working…'}
              </div>
            )}
            {error && !isGenerating && (
              <p className="text-xs text-[var(--error)]">{error}</p>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="p-3 border-t border-[var(--border-color)] bg-white">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage(input);
              }}
              className="flex gap-2"
            >
              <input
                className="input text-sm flex-1"
                placeholder={
                  files.length
                    ? 'e.g. Add HPA autoscaling…'
                    : 'Describe your stack…'
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isGenerating}
              />
              <button
                type="submit"
                className="btn-primary text-sm px-4 disabled:opacity-50"
                disabled={isGenerating || input.trim().length < 3}
              >
                Send
              </button>
            </form>
          </div>
        </section>

        {/* RIGHT — IDE / files */}
        <section className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          <div className="px-4 py-2 border-b border-[var(--border-color)] bg-white flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--navy-heading)]">Project</p>
              <p className="text-xs text-[var(--muted-text)] truncate">
                {files.length
                  ? `${files.length} files · reviewable scaffold`
                  : 'Files appear here as they generate'}
              </p>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden p-3 sm:p-4">
            {files.length > 0 ? (
              <div className="h-full overflow-auto space-y-4">
                {warnings.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-[var(--muted-text)]">
                    {warnings.slice(0, 3).map((w, i) => (
                      <div key={i}>• {w}</div>
                    ))}
                  </div>
                )}
                <FileViewer files={files} isGenerating={isGenerating} />
                {!isGenerating && files.length > 0 && (
                  <div className="max-w-md">
                    <LeadCapture summary={summary} fileCount={files.length} />
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center rounded-xl border border-dashed border-[var(--border-color)] bg-white/50">
                <p className="text-sm text-[var(--muted-text)] text-center px-6">
                  {isGenerating
                    ? 'Creating files…'
                    : 'Send a message to start generating your stack'}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
