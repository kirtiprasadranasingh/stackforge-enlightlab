'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
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
import { FormattedMessage } from '@/components/FormattedMessage';

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
      content: "Hey! Describe the cloud infrastructure or application setup you want to build (e.g., 'Deploy a Node.js API with PostgreSQL to AWS EKS'), and I will turn it into a production-ready cloud stack.",
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

  const [leftWidth, setLeftWidth] = useState(420);
  const [isDragging, setIsDragging] = useState(false);
  const [promptVal, setPromptVal] = useState('');
  const [showDeployModal, setShowDeployModal] = useState(false);

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
  const mockAssumptions = useMemo(() => {
    return [
      presets.cloud === 'oracle'
        ? 'OCI Region: ap-mumbai-1'
        : presets.cloud === 'aws'
        ? 'AWS Region: us-east-1'
        : presets.cloud === 'gcp'
        ? 'GCP Region: us-central1'
        : 'Azure Region: eastus',
      'VPC / VCN CIDR: 10.0.0.0/16',
      presets.orchestrator === 'eks' ||
      presets.orchestrator === 'gke' ||
      presets.orchestrator === 'aks' ||
      presets.orchestrator === 'oke'
        ? 'K8s Cluster Node Pools: Active'
        : 'Serverless Container Scaling',
      'Secrets: Environment placeholders',
      'Health Probes: Enabled',
      'Resource Requests/Limits: Hard bounds applied',
    ];
  }, [presets]);

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
    <div className="h-screen flex flex-col overflow-hidden bg-[#f8fafc]">
      {hasGeneratedFiles && (
        <header className="border-b border-gray-200 sticky top-0 bg-white z-50 shrink-0 select-none">
          <div className="px-6 h-14 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/" className="flex items-center gap-2.5 shrink-0 no-underline">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-150 flex items-center justify-center text-indigo-650 shrink-0 font-extrabold text-sm shadow-sm">
                  ⚡
                </div>
                <div className="flex flex-col select-none leading-tight">
                  <span className="text-sm font-bold text-gray-900 font-sans">
                    StackForge Copilot
                  </span>
                  <span className="text-[10px] text-gray-500 font-medium">
                    by Enlight Lab
                  </span>
                </div>
              </Link>
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

              <button type="button" className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer p-1" title="Notifications">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a9.04 9.04 0 01-2.857 0m-3 0a9.04 9.04 0 01-2.857 0M5 9a7 7 0 1114 0c0 3-1 3.5-3 5.5l-1 1H9l-1-1C5 12.5 5 12 5 9z" />
                </svg>
              </button>

              <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xs text-slate-700 font-bold select-none shrink-0 cursor-pointer" title="Profile">
                SF
              </div>
            </div>
          </div>
        </header>
      )}

      {!hasGeneratedFiles && (
        <div className="absolute top-6 left-8 z-50">
          <Link href="/" className="flex items-center gap-2.5 no-underline">
            <img src="/enlight-labs-logo.png" alt="Enlight Lab" className="h-8 w-auto object-contain" />
            <div className="flex flex-col select-none leading-none">
              <span className="text-xl font-bold tracking-tight text-blue-600 font-sans">
                Enlight Lab
              </span>
              <span className="text-[7.5px] font-extrabold text-blue-600 tracking-[0.16em] uppercase mt-0.5 opacity-80">
                AI CLOUD BLUEPRINT GENERATOR
              </span>
            </div>
          </Link>
        </div>
      )}

      {/* Dynamic Workspace: Split vs. Full-Width Chat */}
      {hasGeneratedFiles ? (
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 p-4 gap-4 bg-[#f8fafc]">
          {/* LEFT — AI Assistant Sidebar */}
          <aside className="w-80 shrink-0 flex flex-col gap-4 min-h-0 overflow-y-auto select-none no-scrollbar">
            {/* AI Assistant Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-gray-900 tracking-tight uppercase">AI Assistant</h3>
                <span className="text-[9px] font-extrabold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full uppercase tracking-wider border border-blue-100">
                  BETA
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                Describe your infrastructure needs in natural language.
              </p>
              
              <button
                type="button"
                onClick={() => {
                  if (promptVal.trim()) {
                    void sendMessage(promptVal);
                  }
                }}
                disabled={isGenerating}
                className="w-full mt-3 text-xs font-bold py-2.5 bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-xl shadow-sm transition-all duration-200 active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <span>⚡ Generate infrastructure</span>
              </button>
            </div>

            {/* Your Prompt Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[10px] font-bold text-gray-800 uppercase tracking-wider">Your Prompt</h4>
                <button
                  type="button"
                  onClick={() => {
                    setPromptVal('');
                    handleNew();
                  }}
                  className="text-[10px] text-blue-600 hover:text-blue-700 font-bold transition-colors cursor-pointer"
                >
                  Clear
                </button>
              </div>
              <textarea
                value={promptVal}
                onChange={(e) => setPromptVal(e.target.value)}
                disabled={isGenerating}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (promptVal.trim()) {
                      void sendMessage(promptVal);
                    }
                  }
                }}
                placeholder="yaml / apiVersion: v2 / name: go-microservice / description: A Helm chart..."
                className="flex-1 bg-slate-50 border border-gray-200 focus:border-indigo-500 focus:bg-white rounded-xl p-3 text-xs text-gray-800 focus:outline-none resize-none transition-all leading-relaxed font-mono w-full min-h-[140px] focus:ring-1 focus:ring-indigo-100"
              />
            </div>

            {/* Key Assumptions Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <h4 className="text-[10px] font-bold text-gray-800 uppercase tracking-wider mb-2.5">Key Assumptions</h4>
              <div className="space-y-2">
                {mockAssumptions.map((ass, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] text-gray-600 leading-tight">
                    <svg className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    <span>{ass}</span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="text-[10px] text-blue-600 hover:text-blue-700 font-bold mt-2.5 transition-colors cursor-pointer"
              >
                View all
              </button>
            </div>

            {/* Actions Grid */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <h4 className="text-[10px] font-bold text-gray-800 uppercase tracking-wider mb-2.5">Actions</h4>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { text: 'Add HPA autoscaling', icon: '📈' },
                  { text: 'Add dev/prod envs', icon: '📁' },
                  { text: 'Setup PostgreSQL DB', icon: '💾' },
                  { text: 'Secure network NSGs', icon: '🛡️' }
                ].map((action) => (
                  <button
                    key={action.text}
                    type="button"
                    onClick={() => {
                      setPromptVal(action.text);
                      void sendMessage(action.text);
                    }}
                    className="text-[10px] bg-slate-50 hover:bg-indigo-50/60 hover:text-indigo-600 text-gray-600 hover:border-indigo-200 border border-gray-200 p-2.5 rounded-xl text-left transition-all duration-200 font-semibold shadow-sm cursor-pointer active:scale-95 leading-snug flex flex-col gap-1.5"
                  >
                    <span>{action.icon}</span>
                    <span>{action.text}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Powered by */}
            <p className="text-[9px] text-gray-400 font-semibold tracking-wide text-center pt-1">
              🚀 Powered by Enlight Lab AI
            </p>
          </aside>

          {/* RIGHT — IDE / files area */}
          <section className="flex-1 min-w-0 flex flex-col gap-4 overflow-hidden">
            {/* Stats Row */}
            <div className="bg-white border border-gray-200 rounded-xl px-5 py-3 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 select-none shrink-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full max-w-3xl">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 font-bold shrink-0">
                    📂
                  </div>
                  <div>
                    <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider leading-none">Project</p>
                    <p className="text-xs font-bold text-gray-800 mt-1 truncate max-w-[130px]">
                      {presets.cloud === 'oracle' ? 'OCI' : presets.cloud.toUpperCase()} Microservice Infra
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600 font-bold shrink-0">
                    📄
                  </div>
                  <div>
                    <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider leading-none">Workspace Blueprint</p>
                    <p className="text-xs font-bold text-gray-800 mt-1">
                      {files.length} files generated
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-amber-650 font-bold shrink-0">
                    ☁️
                  </div>
                  <div>
                    <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider leading-none">Provider</p>
                    <p className="text-xs font-bold text-gray-800 mt-1 uppercase truncate max-w-[110px]">
                      {presets.cloud}, {presets.orchestrator}, {presets.ci}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center text-green-600 font-bold shrink-0">
                    🕒
                  </div>
                  <div>
                    <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider leading-none">Last updated</p>
                    <p className="text-xs font-bold text-gray-800 mt-1">
                      Just now
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-2.5 shrink-0 w-full sm:w-auto justify-end">
                <button
                  onClick={handleDownloadZip}
                  className="text-xs font-bold px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 rounded-xl shadow-sm transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
                >
                  📥 Download ZIP
                </button>
                <button
                  onClick={handleCopyAllText}
                  className="text-xs font-bold px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm rounded-xl transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
                >
                  📋 Copy all
                </button>
              </div>
            </div>

            {/* Split View Editor Workspace */}
            <div className="flex-1 min-h-0 overflow-hidden bg-gray-50 flex flex-col justify-between gap-4">
              <FileViewer
                files={files}
                isGenerating={isGenerating}
                promptText={promptVal}
              />

              {/* Bottom Alert Banner */}
              {!isGenerating && files.length > 0 && (
                <div className="bg-[#EEF2FF] border border-[#C7D2FE] text-[#3730A3] p-4 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm select-none shrink-0 animate-fade-slide-up">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-[#4F46E5] text-sm shrink-0">
                      ℹ️
                    </span>
                    <div>
                      <p className="text-xs font-bold">Your infrastructure is ready!</p>
                      <p className="text-[11px] text-[#4F46E5]/90 mt-0.5">
                        {files.length} files generated successfully. You can review, download, or deploy this infrastructure.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 w-full sm:w-auto justify-end shrink-0">
                    <button
                      onClick={handleCopyAllText}
                      className="text-xs font-bold px-4 py-2.5 text-[#4F46E5] hover:bg-indigo-50 border border-transparent rounded-xl transition-colors cursor-pointer"
                    >
                      Preview Plan
                    </button>
                    <button
                      onClick={() => setShowDeployModal(true)}
                      className="bg-[#4F46E5] hover:bg-[#4338CA] text-white px-5 py-2.5 rounded-xl font-bold text-xs shadow-sm transition-all duration-200 active:scale-95 cursor-pointer flex items-center gap-1.5"
                    >
                      🚀 Deploy Infrastructure
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : messages.some(m => m.role === 'user') ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-white bg-[linear-gradient(to_right,#80808006_1px,transparent_1px),linear-gradient(to_bottom,#80808006_1px,transparent_1px)] bg-[size:24px_24px] p-6 relative before:absolute before:inset-0 before:bg-[radial-gradient(circle_800px_at_50%_45%,#eef2ff,transparent_75%)] before:pointer-events-none overflow-y-auto">
          <div className="w-full max-w-2xl bg-white border border-gray-150 rounded-[32px] shadow-xl p-6 flex flex-col min-h-[380px] max-h-[70vh] relative z-10 animate-fade-slide-up">
            {/* Scrollable messages container */}
            <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1">
              {messages.map((m, idx) => (
                <div
                  key={m.id}
                  className={`w-full flex gap-2.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'} items-start animate-fade-slide-up`}
                  style={{ animationDelay: `${idx * 40}ms` }}
                >
                  {m.role !== 'user' && (
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white shrink-0 shadow-sm border border-blue-500/10 select-none">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21l8.982-11.795H13.62l1.382-7.205L6 13.795h5.196l-.383 2.11z" />
                      </svg>
                    </div>
                  )}
                  <div className="max-w-[80%] text-sm leading-relaxed flex flex-col">
                    <div
                      className={`rounded-2xl px-4 py-2.5 shadow-sm border ${
                        m.role === 'user'
                          ? 'bg-[#0066FF] border-[#0066FF] text-white rounded-tr-none shadow-md shadow-blue-500/5'
                          : m.role === 'system'
                            ? 'bg-amber-50 text-[var(--muted-text)] border-amber-100 font-mono text-xs'
                            : 'bg-white border border-gray-150 text-gray-800 rounded-tl-none'
                      }`}
                    >
                      <FormattedMessage
                        content={m.content}
                        className={m.role === 'user' ? 'text-white' : m.role === 'system' ? 'text-[var(--muted-text)]' : 'text-gray-800'}
                      />
                    </div>
                  </div>
                  {m.role === 'user' && (
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white shrink-0 shadow-sm text-[10px] font-extrabold font-sans tracking-wide select-none">
                      US
                    </div>
                  )}
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
              className="relative border border-gray-200 focus-glow focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-50/50 rounded-full p-2 bg-[#FAFAFA] flex items-center gap-2 transition-all"
            >
              <input
                className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none pl-4 py-2 border-0 min-w-0"
                placeholder="Ask anything, e.g. deploy a Node.js API with PostgreSQL to AWS EKS"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isGenerating}
              />
              <button
                type="submit"
                className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-200 text-gray-500 hover:bg-[#0066FF] hover:text-white transition-colors shrink-0 cursor-pointer"
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
        <div className="flex-1 flex justify-center bg-white overflow-y-auto relative before:absolute before:inset-0 before:bg-[radial-gradient(circle_800px_at_50%_45%,#eef2ff,transparent_75%)] before:pointer-events-none">
          <div className="w-full max-w-2xl px-6 py-12 flex flex-col min-h-full justify-between items-center gap-6 relative z-10">
            {/* Center icon / Title banner */}
            <div className="flex-1 flex flex-col items-center justify-center text-center my-auto py-10 animate-fade-slide-up">
              {/* Floating icon card */}
              <div className="w-14 h-14 rounded-2xl bg-white border border-gray-150 flex items-center justify-center mb-6 shadow-md relative z-20 animate-pulse-glow">
                <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z" />
                </svg>
              </div>
              <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight leading-tight">
                Shape your cloud stack in minutes.
              </h1>
              <p className="text-sm text-gray-500 mt-2.5 max-w-lg leading-relaxed font-medium">
                Tell me your presets, workload, database, and pipelines. I&apos;ll turn it into a production-ready cloud stack in minutes.
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
                  placeholder="Ask anything, e.g. deploy a Node.js API with PostgreSQL to AWS EKS"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={isGenerating}
                />
                <button
                  type="submit"
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-200 text-gray-500 hover:bg-[#0066FF] hover:text-white transition-colors shrink-0 cursor-pointer"
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
              <Link href="/" className="text-xs bg-white text-gray-500 border border-gray-150 px-4 py-2.5 rounded-full shadow-sm flex items-center gap-1.5 no-underline hover:text-gray-700 hover:scale-[1.02] active:scale-95 transition-all font-medium cursor-pointer">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                <span>Scroll to learn more</span>
                <svg className="w-3 h-3 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      )}
      {showDeployModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 select-none animate-fade-slide-up">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-2xl max-w-lg w-full flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 uppercase flex items-center gap-1.5">
                <span>🚀</span> Deploying stackforge Blueprint
              </h3>
              <button
                onClick={() => setShowDeployModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
            
            <div className="text-xs text-gray-600 space-y-3 leading-relaxed">
              <p>
                StackForge is an infrastructure generator, not a hosting provider. You can deploy this scaffold by copying/downloading the workspace and running CLI commands.
              </p>
              
              <div className="bg-slate-950 text-slate-100 p-3 rounded-xl font-mono text-[11px] leading-relaxed relative">
                <p className="text-slate-500 mb-1"># Setup commands</p>
                {presets.orchestrator === 'eks' || presets.orchestrator === 'gke' || presets.orchestrator === 'aks' || presets.orchestrator === 'oke' ? (
                  <>
                    <p>cd k8s/</p>
                    <p>kubectl apply -f .</p>
                  </>
                ) : (
                  <>
                    <p>cd terraform/</p>
                    <p>terraform init</p>
                    <p>terraform apply -auto-approve</p>
                  </>
                )}
                
                <button
                  onClick={() => {
                    const text = presets.orchestrator === 'eks' || presets.orchestrator === 'gke' || presets.orchestrator === 'aks' || presets.orchestrator === 'oke'
                      ? 'cd k8s/\nkubectl apply -f .'
                      : 'cd terraform/\nterraform init\nterraform apply -auto-approve';
                    void copyToClipboard(text);
                  }}
                  className="absolute top-2.5 right-2.5 text-[9px] font-bold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded transition-all cursor-pointer"
                >
                  Copy
                </button>
              </div>
              
              <p className="bg-amber-50 border border-amber-100 rounded-lg p-2.5 text-[10px] text-amber-800">
                ⚠️ Ensure you have configured the appropriate credentials (e.g. AWS CLI, OCI configuration, Azure Login) in your shell environment before executing these commands.
              </p>
            </div>
            
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={() => setShowDeployModal(false)}
                className="text-xs font-bold px-4 py-2 bg-slate-100 hover:bg-slate-200 text-gray-700 rounded-xl transition-all active:scale-95 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
