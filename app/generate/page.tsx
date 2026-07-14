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
import { copyToClipboard } from '@/lib/clipboard';

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
  const [hasGeneratedFiles, setHasGeneratedFiles] = useState(false);
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
                if (event.file) {
                  mergeFile(event.file);
                  setHasGeneratedFiles(true);
                }
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
    setHasGeneratedFiles(false);
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
              <span className="font-medium">Step {step} of 3</span>
              <span className="text-[var(--muted-text)]">{Math.round((step / 3) * 100)}%</span>
            </div>
            <div className="progress-track h-1.5">
              <div
                className="progress-fill-blue h-full"
                style={{ width: `${(step / 3) * 100}%`, animation: 'none' }}
              />
            </div>
          </div>

          {step === 1 && (
            <div>
              <p className="section-label mb-2">Cloud · 1 of 3</p>
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
              <p className="section-label mb-2">Orchestration · 2 of 3</p>
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
              <p className="section-label mb-2">CI / CD · 3 of 3</p>
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
            <Link href="/" className="flex items-center gap-2.5 shrink-0 no-underline">
              <img src="/enlight-labs-logo.png" alt="Enlight Lab" className="h-7 w-auto object-contain" />
              <div className="flex flex-col select-none leading-none">
                <span className="text-lg font-bold tracking-tight text-indigo-600 font-sans">
                  Enlight Lab
                </span>
                <span className="text-[6.5px] font-extrabold text-gray-400 tracking-[0.15em] uppercase mt-0.5">
                  AI BLUEPRINT GENERATOR
                </span>
              </div>
            </Link>
            <span className="text-xs text-[var(--muted-text)] truncate hidden md:inline border-l border-gray-200 pl-3">
              Infrastructure Workspace
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isGenerating && (
              <button
                type="button"
                onClick={handleStop}
                className="text-xs font-semibold px-4 py-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white shadow-sm rounded-xl transition-all duration-200 active:scale-95"
              >
                Stop
              </button>
            )}
            <button
              type="button"
              onClick={handleNew}
              className="text-xs font-semibold px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-sm rounded-xl transition-all duration-200 active:scale-95"
            >
              New Project
            </button>
          </div>
        </div>
      </header>

      {/* Dynamic Workspace: Split vs. Full-Width Chat */}
      {hasGeneratedFiles ? (
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 p-4 gap-4 bg-gray-50 bg-[linear-gradient(to_right,#80808006_1px,transparent_1px),linear-gradient(to_bottom,#80808006_1px,transparent_1px)] bg-[size:24px_24px] relative before:absolute before:inset-0 before:bg-[radial-gradient(circle_800px_at_50%_150px,#eeeffc,transparent)] before:pointer-events-none">
          {/* LEFT — Chat card */}
          <section className="w-full lg:w-[420px] shrink-0 bg-white border border-gray-150 rounded-[28px] shadow-md flex flex-col min-h-0 max-h-[40vh] lg:max-h-none relative z-10 overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--navy-heading)]">Chat</p>
              <p className="text-xs text-[var(--muted-text)]">Ask for changes — files update on the right</p>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 flex flex-col min-h-0">
              {messages.map((m, idx) => (
                <div
                  key={m.id}
                  className={`w-full flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-slide-up`}
                  style={{ animationDelay: `${idx * 40}ms` }}
                >
                  <div
                    className="max-w-[85%] text-sm leading-relaxed flex flex-col"
                  >
                    <div
                      className={`rounded-2xl px-4 py-2.5 shadow-sm border ${
                        m.role === 'user'
                          ? 'bg-indigo-600 border-indigo-600 text-white rounded-tr-none'
                          : m.role === 'system'
                            ? 'bg-amber-50 text-[var(--muted-text)] border-amber-100 font-mono text-xs'
                            : 'bg-gray-50 border-gray-100 text-gray-800 rounded-tl-none'
                      }`}
                    >
                      {m.content}
                    </div>
                    {/* Utility icons for assistant replies */}
                    {m.role === 'assistant' && (
                      <div className="flex items-center gap-2 mt-1.5 ml-1 text-gray-400">
                        <button type="button" title="Revert to this version" className="hover:text-gray-600 transition-colors p-0.5">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                          </svg>
                        </button>
                        <button type="button" title="Like response" className="hover:text-gray-600 transition-colors p-0.5">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.25c.896 0 1.7-.33 2.312-.87.412-.363.953-.518 1.488-.409l1.404.288c.832.17 1.3.75 1.3 1.601V15c0 .887-.76 1.6-1.7 1.6H9.167A8.3 8.3 0 0 1 6 15V10.25ZM18 16.6h.17c.887 0 1.6-.76 1.6-1.7v-3.75c0-.887-.76-1.6-1.6-1.6H18" />
                          </svg>
                        </button>
                        <button type="button" title="Dislike response" className="hover:text-gray-600 transition-colors p-0.5">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 15h9.75M7.5 15a2.25 2.25 0 0 0-2.25-2.25m2.25 2.25v3a2.25 2.25 0 0 0 2.25 2.25h3.75a2.25 2.25 0 0 0 2.25-2.25v-3m-6 0h6m-6 0a2.25 2.25 0 0 1-2.25-2.25M17.25 15a2.25 2.25 0 0 0 2.25-2.25V9.75A2.25 2.25 0 0 0 17.25 7.5h-3.75a2.25 2.25 0 0 0-2.25 2.25v3" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          title="Copy response text"
                          onClick={() => void copyToClipboard(m.content)}
                          className="hover:text-gray-600 transition-colors p-0.5"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3a2.25 2.25 0 0 0-2.25 2.25v.008c0 .125-.08.235-.2.244A2.251 2.251 0 0 0 4.5 7.05v11.5c0 1.242 1.008 2.25 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25V7.05a2.25 2.25 0 0 0-3.55-1.908c-.12-.09-.2-.2-.2-.325v-.008Z" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isGenerating && (
                <div className="rounded-2xl bg-indigo-50 border border-indigo-100 px-4 py-2.5 text-sm text-indigo-600 self-start rounded-tl-none font-medium animate-pulse">
                  {statusMessage || 'StackForge is generating...'}
                </div>
              )}
              {error && !isGenerating && (
                <div className="rounded-2xl bg-red-50 border border-red-100 px-4 py-2.5 text-xs text-red-600 self-start rounded-tl-none">
                  {error}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Suggested Prompts / Actions */}
            {files.length > 0 && !isGenerating && (
              <div className="flex flex-wrap gap-2 px-4 pb-2 pt-1 border-t border-gray-50 bg-white">
                {['Add HPA autoscaling', 'Add dev/prod envs', 'Setup PostgreSQL DB', 'Secure network NSGs'].map((suggestion, i) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      setInput(suggestion);
                      void sendMessage(suggestion);
                    }}
                    className="text-xs bg-indigo-50/50 hover:bg-indigo-50 text-indigo-700 border border-indigo-100 hover:border-indigo-200 px-3.5 py-1.5 rounded-full transition-all duration-200 font-semibold shadow-sm cursor-pointer active:scale-95 animate-pop-item"
                    style={{ animationDelay: `${i * 75}ms` }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            {/* Chat Input Container */}
            <div className="p-3 border-t border-[var(--border-color)] bg-white">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (input.trim().length >= 1) {
                    void sendMessage(input);
                  }
                }}
                className="relative border border-gray-200 focus-glow focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100 rounded-2xl p-2 bg-gray-50 flex items-center gap-2 transition-all"
              >
                <button
                  type="button"
                  className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-150 hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors shrink-0"
                  title="Add context (files, text)"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </button>
                <input
                  className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none py-1 border-0 min-w-0"
                  placeholder={files.length ? "Ask StackForge..." : "Describe what you want to build..."}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={isGenerating}
                />
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    className="hidden sm:flex items-center gap-0.5 px-2 py-1 rounded-lg hover:bg-gray-200 text-[11px] font-semibold text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <span>Build</span>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                    title="Voice input"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                    </svg>
                  </button>
                  <button
                    type="submit"
                    className="w-8 h-8 flex items-center justify-center rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white transition-colors shrink-0"
                    disabled={isGenerating || input.trim().length < 1}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                    </svg>
                  </button>
                </div>
              </form>
            </div>
          </section>

          {/* RIGHT — IDE / files card */}
          <section className="flex-1 min-w-0 bg-white border border-gray-150 rounded-[28px] shadow-md flex flex-col overflow-hidden relative z-10">
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

            <div className="flex-1 min-h-0 overflow-hidden p-3 sm:p-4 bg-gray-50">
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
      ) : messages.length > 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-white bg-[linear-gradient(to_right,#80808006_1px,transparent_1px),linear-gradient(to_bottom,#80808006_1px,transparent_1px)] bg-[size:24px_24px] p-6 relative before:absolute before:inset-0 before:bg-[radial-gradient(circle_800px_at_50%_150px,#eeeffc,transparent)] before:pointer-events-none overflow-y-auto">
          <div className="w-full max-w-2xl bg-white border border-gray-150 rounded-[32px] shadow-xl p-6 flex flex-col min-h-[380px] max-h-[70vh] relative z-10 animate-fade-slide-up">
            {/* Scrollable messages container */}
            <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1">
              {messages.map((m, idx) => (
                <div
                  key={m.id}
                  className={`w-full flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-slide-up`}
                  style={{ animationDelay: `${idx * 40}ms` }}
                >
                  <div className="max-w-[85%] text-sm leading-relaxed flex flex-col">
                    <div
                      className={`rounded-2xl px-4 py-2.5 shadow-sm border ${
                        m.role === 'user'
                          ? 'bg-indigo-600 border-indigo-600 text-white rounded-tr-none'
                          : m.role === 'system'
                            ? 'bg-amber-50 text-[var(--muted-text)] border-amber-100 font-mono text-xs'
                            : 'bg-gray-50 border-gray-150 text-gray-800 rounded-tl-none'
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Embedded input container inside the card */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (input.trim().length >= 1) {
                  void sendMessage(input);
                }
              }}
              className="relative border border-gray-200 focus-glow focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-50/50 rounded-2xl p-2 bg-gray-50 flex items-center gap-2 transition-all"
            >
              <input
                className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none pl-3 py-1 border-0 min-w-0"
                placeholder="Ask anything, e.g. I want to implement Salesforce in our sales team"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isGenerating}
              />
              <button
                type="submit"
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white transition-colors shrink-0 cursor-pointer"
                disabled={isGenerating || input.trim().length < 1}
              >
                <svg className="w-4 h-4 transform rotate-45 -translate-x-0.5 translate-y-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </form>
          </div>

          {/* Action pill below the chat card */}
          <div className="mt-4 z-10 animate-fade-slide-up" style={{ animationDelay: '100ms' }}>
            <button
              type="button"
              onClick={() => {
                setSetupDone(false);
                setStep(1);
              }}
              className="text-xs bg-white hover:bg-gray-50 text-gray-600 border border-gray-200 px-4 py-2.5 rounded-full shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              <span>Answer 3 quick questions</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex justify-center bg-white bg-[linear-gradient(to_right,#80808006_1px,transparent_1px),linear-gradient(to_bottom,#80808006_1px,transparent_1px)] bg-[size:24px_24px] overflow-y-auto relative before:absolute before:inset-0 before:bg-[radial-gradient(circle_800px_at_50%_150px,#eeeffc,transparent)] before:pointer-events-none">
          <div className="w-full max-w-2xl px-6 py-12 flex flex-col min-h-full justify-between items-center gap-6 relative z-10">
            {/* Center icon / Title banner */}
            <div className="flex-1 flex flex-col items-center justify-center text-center my-auto py-10 animate-fade-slide-up">
              {/* Floating icon card */}
              <div className="w-14 h-14 rounded-2xl bg-white border border-gray-150 flex items-center justify-center mb-6 shadow-md relative z-20 animate-pulse-glow">
                <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z" />
                </svg>
              </div>
              <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight leading-tight">
                Shape your stack in minutes.
              </h1>
              <p className="text-sm text-gray-500 mt-2.5 max-w-md leading-relaxed font-medium">
                Tell me the presets, workload, database, and integrations. I&apos;ll turn it into a production-ready cloud stack in minutes.
              </p>
            </div>

            {/* Centered input form + Suggestions */}
            <div className="w-full flex flex-col items-center gap-4 mb-24">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (input.trim().length >= 1) {
                    void sendMessage(input);
                  }
                }}
                className="relative border border-gray-200 focus-glow focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-50/50 rounded-full p-2 bg-white flex items-center gap-2 transition-all shadow-md w-full max-w-xl animate-fade-slide-up"
                style={{ animationDelay: '100ms' }}
              >
                <input
                  className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none pl-4 py-2 border-0 min-w-0"
                  placeholder="Ask anything, e.g. I want to deploy a Node.js API with PostgreSQL to AWS EKS"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={isGenerating}
                />
                <button
                  type="submit"
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white transition-colors shrink-0 cursor-pointer"
                  disabled={isGenerating || input.trim().length < 1}
                >
                  <svg className="w-4 h-4 transform rotate-45 -translate-x-0.5 translate-y-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                </button>
              </form>

              {/* Quick Questions Pill */}
              <button
                type="button"
                onClick={() => {
                  setSetupDone(false);
                  setStep(1);
                }}
                className="text-xs bg-white hover:bg-gray-50 text-gray-600 border border-gray-200 px-4 py-2 rounded-full shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer animate-fade-slide-up"
                style={{ animationDelay: '150ms' }}
              >
                <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
                <span>Answer 3 quick questions</span>
              </button>
            </div>

            {/* Scroll Indicator */}
            <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2">
              <Link href="/" className="text-xs bg-white text-gray-500 border border-gray-150 px-4 py-2 rounded-full shadow-sm flex items-center gap-1.5 no-underline hover:text-gray-700 transition-colors font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping"></span>
                <span>Scroll to learn more</span>
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
