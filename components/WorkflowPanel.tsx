'use client';

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
}

const STEPS = [
  { id: 'clarify', label: 'Requirements' },
  { id: 'plan', label: 'Architecture plan' },
  { id: 'generate', label: 'Generate code' },
  { id: 'validate', label: 'Validate' },
] as const;

function stepIndex(phase: WorkflowPhase | 'idle', isGenerating: boolean, hasFiles: boolean, awaitingApproval: boolean): number {
  if (phase === 'clarify') return 0;
  if (phase === 'plan' && isGenerating) return 1;
  if (awaitingApproval) return 1;
  if (phase === 'generate' && isGenerating && !hasFiles) return 2;
  if (hasFiles) return 3;
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
}: WorkflowPanelProps) {
  const hasFiles = files.length > 0;
  const active = stepIndex(phase, isGenerating, hasFiles, awaitingApproval);

  if (hasFiles) {
    return (
      <div className="flex-1 min-h-0 overflow-hidden bg-white flex flex-col justify-between gap-4">
        <div className="shrink-0 space-y-2">
          <WorkflowStepper active={active} />
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
            Reviewable infrastructure scaffold — validate and review these files before provisioning. This is not drop-in production code.
          </div>
          {validationSummary ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-700 font-mono whitespace-pre-wrap">
              {validationSummary}
            </div>
          ) : null}
        </div>
        <FileViewer
          files={files}
          isGenerating={isGenerating}
          promptText={promptText}
          generationStatus={generationStatus}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      <WorkflowStepper active={active} />
      <div className="flex-1 min-h-0 rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-6 flex flex-col items-center justify-center text-center">
        {isGenerating && phase === 'plan' ? (
          <>
            <span className="loading-dots scale-125 mb-4" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            <p className="text-sm font-semibold text-slate-900">Drafting architecture plan</p>
            <p className="mt-2 text-[12px] text-slate-500 max-w-md leading-relaxed">
              Turning your confirmed requirements into Terraform, CI/CD, and Kubernetes layout. You&apos;ll approve before any files are generated.
            </p>
          </>
        ) : awaitingApproval && pendingPlan ? (
          <>
            <p className="text-sm font-semibold text-slate-900 mb-3">Architecture plan ready</p>
            <div className="w-full max-h-[min(52vh,520px)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm">
              <FormattedMessage content={pendingPlan} className="text-slate-700" />
            </div>
            <p className="mt-3 text-[12px] text-slate-500">
              Approve in the chat to generate files, or reply with changes.
            </p>
          </>
        ) : (
          <>
            <span className="loading-dots scale-125 mb-4" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            <p className="text-sm font-semibold text-indigo-700">
              {generationStatus || 'Generating infrastructure files…'}
            </p>
            <p className="mt-2 text-[12px] text-slate-500 max-w-md leading-relaxed">
              Terraform, CI/CD pipelines, Helm charts, and a minimal health-check stub will stream in here. Automated checks run terraform init, validate, and plan where possible.
            </p>
          </>
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
