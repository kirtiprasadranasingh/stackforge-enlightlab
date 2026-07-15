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
  const [showAssumptionsModal, setShowAssumptionsModal] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [lastUpdateTime, setLastUpdateTime] = useState('Today, 10:42 AM');
  const [selectedRegion, setSelectedRegion] = useState('us-east-1');
  const [selectedCidr, setSelectedCidr] = useState('10.0.0.0/16');
  const [selectedSecrets, setSelectedSecrets] = useState('placeholders');
  const [selectedProbes, setSelectedProbes] = useState('enabled');

  const getDeploymentCommands = () => {
    const hasHelm = files.some(f => f.path.toLowerCase().includes('helm') || f.path.toLowerCase().endsWith('chart.yaml') || f.path.toLowerCase().endsWith('chart.yml'));
    const hasTerraform = files.some(f => f.path.endsWith('.tf') || f.path.toLowerCase().includes('terraform'));

    if (hasHelm && hasTerraform) {
      return `# Step 1: Provision infrastructure with Terraform
cd terraform/
terraform init
terraform apply -auto-approve

# Step 2: Deploy Helm charts to cluster
cd ../helm/
helm dependency update
helm upgrade --install stackforge-app ./ -n stackforge --create-namespace`;
    }

    if (hasHelm) {
      return `# Deploy Helm chart blueprint
cd helm/
helm dependency update
helm upgrade --install stackforge-app ./ -n stackforge --create-namespace`;
    }

    if (hasTerraform) {
      return `# Provision Cloud Infrastructure
cd terraform/
terraform init
terraform plan -out=tfplan
terraform apply tfplan`;
    }

    return `# Deploy generated workspace files
# Read the README.md or execution scripts inside the ZIP archive.`;
  };


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
                setLastUpdateTime(`Today, ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
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

  // Dynamic parsing of project & provider from code
  const chartFile = files.find(f => f.path.toLowerCase().endsWith('chart.yaml') || f.path.toLowerCase().endsWith('chart.yml'));
  let parsedProjName = "Go Microservice Infra";
  if (chartFile) {
    const match = chartFile.content.match(/^name:\s*(.+)$/m);
    if (match && match[1]) {
      parsedProjName = match[1].trim();
    }
  } else {
    const pkgFile = files.find(f => f.path.toLowerCase().endsWith('package.json'));
    if (pkgFile) {
      try {
        const parsed = JSON.parse(pkgFile.content);
        if (parsed.name) parsedProjName = parsed.name;
      } catch {}
    }
  }

  let parsedProvider = `${presets.cloud === 'oracle' ? 'OCI' : presets.cloud.toUpperCase()}, Kubernetes, Helm`;
  if (files.some(f => f.path.includes('oracle') || f.path.includes('oci') || f.content.includes('oci_'))) {
    parsedProvider = "OCI, Kubernetes, Helm";
  } else if (files.some(f => f.path.includes('aws') || f.content.includes('aws_'))) {
    parsedProvider = "AWS, Kubernetes, Helm";
  } else if (files.some(f => f.path.includes('gcp') || f.content.includes('google_'))) {
    parsedProvider = "GCP, Kubernetes, Helm";
  } else if (files.some(f => f.path.includes('azure') || f.content.includes('azurerm_'))) {
    parsedProvider = "Azure, Kubernetes, Helm";
  }

  // ——— Lovable-style workspace ———
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#f8fafc]">
      {hasGeneratedFiles && (
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
              
              <Link href="/" className="flex items-center gap-2.5 shrink-0 no-underline">
                <img src="/enlight-labs-logo.png" alt="StackForge" className="w-8 h-8 object-contain rounded-lg shadow-sm" />
                <div className="flex flex-col select-none leading-none">
                  <span className="text-base font-bold text-gray-900 font-sans tracking-tight">
                    StackForge
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

              <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0 cursor-pointer shadow-inner" title="Profile">
                <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80" alt="Profile" className="w-full h-full object-cover" />
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
          <aside className={`${isSidebarOpen ? 'w-[360px] opacity-100' : 'w-0 opacity-0 overflow-hidden pointer-events-none hidden'} transition-all duration-300 shrink-0 flex flex-col gap-3 min-h-0 select-none`}>
            {/* Interactive Chat Log */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-3 border-b border-gray-100 pb-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-gray-900 tracking-tight uppercase">AI Assistant Chat</h3>
                  <span className="text-[9px] font-extrabold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full uppercase tracking-wider border border-blue-100">
                    BETA
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMessages([
                      {
                        id: 'welcome',
                        role: 'assistant',
                        content: "Hey! Describe the cloud infrastructure or application setup you want to build (e.g., 'Deploy a Node.js API with PostgreSQL to AWS EKS'), and I will turn it into a production-ready cloud stack.",
                      }
                    ]);
                    setPromptVal('');
                    handleNew();
                  }}
                  className="text-[10px] text-blue-600 hover:text-blue-700 font-bold transition-colors cursor-pointer"
                >
                  Reset Chat
                </button>
              </div>

              {/* Chat Messages Feed */}
              <div className="flex-1 overflow-y-auto space-y-3 mb-3 pr-1 text-xs select-text">
                {messages.map((m, idx) => (
                  <div
                    key={m.id || idx}
                    className={`flex gap-2 items-start ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {m.role !== 'user' && (
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white shrink-0 shadow-sm border border-blue-500/10 select-none">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21l8.982-11.795H13.62l1.382-7.205L6 13.795h5.196l-.383 2.11z" />
                        </svg>
                      </div>
                    )}
                    <div className="flex-1 flex flex-col max-w-[85%]">
                      <div
                        className={`rounded-xl px-3 py-2 border leading-relaxed shadow-sm ${
                          m.role === 'user'
                            ? 'bg-[#0066FF] border-[#0066FF] text-white rounded-tr-none'
                            : m.role === 'system'
                              ? 'bg-amber-50 text-[var(--muted-text)] border-amber-100 font-mono text-[10px]'
                              : 'bg-slate-50 border-gray-150 text-gray-800 rounded-tl-none'
                        }`}
                      >
                        <FormattedMessage content={m.content} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Input section at bottom of chat card */}
              <div className="border-t border-gray-100 pt-3 flex flex-col gap-2 shrink-0">
                <textarea
                  value={promptVal}
                  onChange={(e) => setPromptVal(e.target.value)}
                  disabled={isGenerating}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (promptVal.trim()) {
                        void sendMessage(promptVal);
                        setPromptVal('');
                      }
                    }
                  }}
                  placeholder="Ask for changes (e.g. 'Add dev/prod folders', 'Secure network NSGs')..."
                  className="w-full h-20 bg-slate-50 border border-gray-205 focus:border-indigo-500 focus:bg-white rounded-xl p-2.5 text-xs text-gray-800 focus:outline-none resize-none transition-all leading-relaxed focus:ring-1 focus:ring-indigo-100"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (promptVal.trim()) {
                      void sendMessage(promptVal);
                      setPromptVal('');
                    }
                  }}
                  disabled={isGenerating || !promptVal.trim()}
                  className="w-full text-xs font-bold py-2 bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-xl shadow-sm transition-all duration-200 active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <span>⚡ Send request</span>
                </button>
              </div>
            </div>

            {/* Actions Grid */}
            <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm shrink-0">
              <h4 className="text-[9px] font-bold text-gray-800 uppercase tracking-wider mb-2">Quick Actions</h4>
              <div className="grid grid-cols-2 gap-1.5">
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
                      void sendMessage(action.text);
                    }}
                    className="text-[10px] bg-slate-50 hover:bg-indigo-50/60 hover:text-indigo-600 text-gray-600 hover:border-indigo-200 border border-gray-200 p-2 rounded-xl text-left transition-all duration-200 font-semibold shadow-xs cursor-pointer active:scale-95 leading-tight flex items-center gap-1.5"
                  >
                    <span>{action.icon}</span>
                    <span>{action.text.replace('Add ', '').replace('Setup ', '')}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Powered by */}
            <p className="text-[9px] text-gray-400 font-semibold tracking-wide text-center py-1 shrink-0">
              🚀 Powered by Enlight Lab AI
            </p>
          </aside>

          {/* RIGHT — IDE / files area */}
          <section className="flex-1 min-w-0 flex flex-col gap-4 overflow-hidden">
            {/* Stats Row */}
            <div className="bg-white border border-gray-200 rounded-xl px-5 py-3.5 shadow-sm flex flex-col lg:flex-row items-center justify-between gap-4 select-none shrink-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full max-w-4xl">
                {/* Stat 1: Project */}
                {/* Stat 1: Project */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-500 shrink-0 shadow-sm">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-none">Project</p>
                    <p className="text-xs font-bold text-gray-800 mt-1 truncate max-w-[130px]" title={parsedProjName}>
                      {parsedProjName}
                    </p>
                  </div>
                </div>

                {/* Stat 2: Workspace Blueprint */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 shrink-0 shadow-sm">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-none">Workspace Blueprint</p>
                    <p className="text-xs font-bold text-gray-800 mt-1">
                      {files.length} files generated
                    </p>
                  </div>
                </div>

                {/* Stat 3: Provider */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-500 shrink-0 shadow-sm">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a3 3 0 1 1 0-6h19.5a3 3 0 1 1 0 6" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-none">Provider</p>
                    <p className="text-xs font-bold text-gray-800 mt-1 uppercase truncate max-w-[140px]" title={parsedProvider}>
                      {parsedProvider}
                    </p>
                  </div>
                </div>

                {/* Stat 4: Last updated */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center text-green-600 shrink-0 shadow-sm">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-none">Last updated</p>
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
                  onClick={() => setShowDeployModal(true)}
                  className="text-xs font-bold px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-[#4F46E5] border border-indigo-150 rounded-xl shadow-sm transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
                  </svg>
                  Preview Plan
                </button>
                <button
                  type="button"
                  onClick={handleDownloadZip}
                  className="text-xs font-bold px-4 py-2.5 bg-white hover:bg-slate-50 text-[#4F46E5] hover:text-[#4338CA] border border-gray-250 rounded-xl shadow-sm transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Download ZIP
                </button>
                <button
                  type="button"
                  onClick={handleCopyAllText}
                  className="text-xs font-bold px-4 py-2.5 bg-[#4F46E5] hover:bg-[#4338CA] text-white shadow-md shadow-indigo-200/50 rounded-xl transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5A3.375 3.375 0 0 0 6.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0 0 15 2.25h-1.5a2.251 2.251 0 0 0-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5" />
                  </svg>
                  Copy all
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
                <span>📋</span> Preview StackForge Deployment Plan
              </h3>
              <button
                onClick={() => setShowDeployModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
            
            <div className="text-xs text-gray-600 space-y-3 leading-relaxed">
              <p className="font-semibold text-gray-850">
                Execute these steps in your command-line interface to provision and deploy this generated blueprint in your cloud environment:
              </p>
              
              <div className="bg-slate-950 text-slate-100 p-4 rounded-xl font-mono text-[11px] leading-relaxed relative overflow-x-auto max-h-[300px] border border-slate-800">
                <pre className="whitespace-pre">{getDeploymentCommands()}</pre>
                
                <button
                  onClick={() => {
                    void copyToClipboard(getDeploymentCommands());
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
