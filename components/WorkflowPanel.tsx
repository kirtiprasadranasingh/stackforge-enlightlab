'use client';

import { useEffect, useState } from 'react';
import type { WorkflowPhase } from '@/types';
import { FileViewer } from '@/components/FileViewer';
import type { GeneratedFile } from '@/types';
import { FormattedMessage } from '@/components/FormattedMessage';

interface WorkflowPanelProps {
  phase: WorkflowPhase | 'idle';
  files: GeneratedFile[];
  isGenerating: boolean;
  generationStatus: string;
  promptText: string;
  pendingPlan: string | null;
  awaitingApproval: boolean;
  validationSummary?: string;
  onApprove?: () => void;
  onDiscard?: () => void;
}

const STEPS = [
  { id: 'clarify', label: 'Requirements' },
  { id: 'plan', label: 'Architecture plan' },
  { id: 'generate', label: 'Generate code' },
  { id: 'validate', label: 'Validate' },
] as const;

const PLAN_REVEAL_MS = 1200;

function stepIndex(
  phase: WorkflowPhase | 'idle',
  isGenerating: boolean,
  hasFiles: boolean,
  awaitingApproval: boolean
): number {
  if (phase === 'clarify') return 0;
  if (phase === 'plan' || awaitingApproval) return 1;
  if (phase === 'generate' && isGenerating) return 2;
  if (hasFiles) return 3;
  if (phase === 'generate') return 2;
  return 1;
}

export function WorkflowPanel({
  phase,
  files,
  isGenerating,
  generationStatus,
  promptText,
  pendingPlan,
  awaitingApproval,
  validationSummary,
  onApprove,
  onDiscard,
}: WorkflowPanelProps) {
  const hasFiles = files.length > 0;
  const active = stepIndex(phase, isGenerating, hasFiles, awaitingApproval);
  const draftingPlan = isGenerating && phase === 'plan';
  const writingCode = isGenerating && phase === 'generate';
  const planReady = Boolean(awaitingApproval && pendingPlan && !isGenerating);

  // Brief beat after the model finishes so the plan slides in — doesn't pop instantly.
  const [planReveal, setPlanReveal] = useState<'idle' | 'settling' | 'shown'>(
    'idle'
  );

  useEffect(() => {
    if (!planReady || !pendingPlan) {
      setPlanReveal('idle');
      return;
    }
    setPlanReveal('settling');
    const timer = window.setTimeout(() => setPlanReveal('shown'), PLAN_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [planReady, pendingPlan]);

  // Cursor-like: show the explorer as soon as the first file streams in
  if (hasFiles && (phase === 'generate' || !draftingPlan)) {
    return (
      <div className="flex-1 min-h-0 overflow-hidden bg-white flex flex-col gap-2">
        <div className="shrink-0 space-y-2">
          <WorkflowStepper active={active} />
          {writingCode ? (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-white"
                aria-hidden
              >
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-slate-800">
                  Generating scaffold
                </p>
                <p className="text-[11px] font-mono text-slate-500 truncate">
                  {generationStatus?.replace(/^Writing\s+/i, '') ||
                    files[files.length - 1]?.path ||
                    'Streaming files…'}
                  <span className="text-slate-400"> · {files.length} file{files.length === 1 ? '' : 's'}</span>
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
              Reviewable infrastructure scaffold — validate and review these files before provisioning. This is not drop-in production code.
            </div>
          )}
          {validationSummary && !writingCode ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-700 font-mono whitespace-pre-wrap max-h-28 overflow-y-auto">
              {validationSummary}
            </div>
          ) : null}
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <FileViewer
            files={files}
            isGenerating={isGenerating}
            promptText={promptText}
            generationStatus={generationStatus}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <WorkflowStepper active={active} />
      <div className="flex-1 min-h-0 rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white overflow-hidden flex flex-col relative">
        {draftingPlan ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-fade-slide-up">
            <span className="loading-dots scale-125 mb-5" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            <p className="text-sm font-semibold text-slate-900">
              Drafting architecture plan
            </p>
            <p className="mt-2 text-[12px] text-slate-500 max-w-sm leading-relaxed">
              Building the stack design from your confirmed choices. You&apos;ll review and approve it before any files are created.
            </p>
            <div className="mt-6 w-full max-w-md space-y-2 text-left">
              {[
                'Confirm cloud, region, and compute',
                'Map networking, IAM, and data',
                'Outline CI/CD and file manifest',
              ].map((label, i) => (
                <div
                  key={label}
                  className="flex items-center gap-2.5 rounded-lg border border-slate-100 bg-white px-3 py-2 text-[11px] text-slate-600 animate-pop-item"
                  style={{ animationDelay: `${i * 120}ms` }}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-bold text-indigo-600">
                    {i + 1}
                  </span>
                  {label}
                </div>
              ))}
            </div>
          </div>
        ) : planReady && planReveal !== 'shown' ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <span className="loading-dots scale-125 mb-5" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            <p className="text-sm font-semibold text-slate-900">
              Assembling your architecture plan
            </p>
            <p className="mt-2 text-[12px] text-slate-500 max-w-sm leading-relaxed">
              Almost ready — laying out the blueprint on this screen…
            </p>
          </div>
        ) : planReady && pendingPlan ? (
          <div className="flex-1 min-h-0 flex flex-col animate-plan-reveal">
            <div className="shrink-0 px-4 sm:px-5 pt-4 pb-2">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    Architecture plan ready
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Review the blueprint, then approve to generate files.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto mx-4 sm:mx-5 mb-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm">
              <FormattedMessage
                content={pendingPlan.replace(
                  /\n*##\s*Approval request[\s\S]*$/i,
                  ''
                ).trim()}
                className="text-slate-700"
              />
            </div>
            {(onApprove || onDiscard) && (
              <div className="shrink-0 border-t border-indigo-100 bg-gradient-to-r from-indigo-50 via-white to-violet-50 px-4 sm:px-5 py-3.5 animate-approve-slide">
                <p className="text-[12px] font-semibold text-slate-900 mb-0.5">
                  Ready to go forward with this plan?
                </p>
                <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
                  Approve to generate Terraform, CI/CD, Helm, and a minimal health stub — or discard and revise.
                </p>
                <div className="flex flex-wrap gap-2">
                  {onApprove ? (
                    <button
                      type="button"
                      onClick={onApprove}
                      className="text-[12px] font-bold px-4 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-200/60 cursor-pointer active:scale-[0.98] transition-all"
                    >
                      Yes — Approve &amp; Generate
                    </button>
                  ) : null}
                  {onDiscard ? (
                    <button
                      type="button"
                      onClick={onDiscard}
                      className="text-[12px] font-semibold px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Discard plan
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        ) : writingCode ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <span className="loading-dots scale-125 mb-5" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            <p className="text-sm font-semibold text-indigo-700">
              Generating infrastructure files
            </p>
            <p className="mt-2 text-[12px] text-slate-500 max-w-sm leading-relaxed">
              Terraform, CI/CD, Helm charts, and a minimal health stub will stream into the explorer as each file is ready.
            </p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <p className="text-sm font-semibold text-slate-700">Workspace ready</p>
            <p className="mt-2 text-[12px] text-slate-500 max-w-sm">
              Complete the interview in chat. The architecture plan and generated files will appear here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function WorkflowStepper({ active }: { active: number }) {
  return (
    <ol className="flex items-center gap-1 sm:gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
      {STEPS.map((step, index) => {
        const done = index < active;
        const current = index === active;
        return (
          <li key={step.id} className="flex items-center gap-1 sm:gap-2 min-w-0">
            <span
              className={`shrink-0 flex h-5 w-5 items-center justify-center rounded-full text-[9px] ${
                done
                  ? 'bg-emerald-500 text-white'
                  : current
                    ? 'bg-indigo-600 text-white ring-2 ring-indigo-100'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {done ? '✓' : index + 1}
            </span>
            <span
              className={`truncate hidden sm:inline ${
                current ? 'text-indigo-700' : done ? 'text-slate-600' : ''
              }`}
            >
              {step.label}
            </span>
            {index < STEPS.length - 1 ? (
              <span className="hidden sm:inline text-slate-200">→</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
