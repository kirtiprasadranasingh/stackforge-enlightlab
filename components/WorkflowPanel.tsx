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
}: WorkflowPanelProps) {
  const hasFiles = files.length > 0;
  const active = stepIndex(phase, isGenerating, hasFiles, awaitingApproval);
  const draftingPlan = isGenerating && phase === 'plan';
  const writingCode = isGenerating && phase === 'generate';

  // Cursor-like: show the explorer as soon as the first file streams in
  if (hasFiles && (phase === 'generate' || !draftingPlan)) {
    const recent = files.slice(-6).reverse();
    return (
      <div className="flex-1 min-h-0 overflow-hidden bg-white flex flex-col gap-3">
        <div className="shrink-0 space-y-2">
          <WorkflowStepper active={active} />
          {writingCode ? (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/80 px-3 py-2.5">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-indigo-800">
                <span className="loading-dots" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
                Writing files to the workspace…
              </div>
              <ul className="mt-2 space-y-1 max-h-24 overflow-y-auto">
                {recent.map((f) => (
                  <li
                    key={f.path}
                    className="flex items-center gap-2 text-[11px] font-mono text-slate-700 truncate"
                  >
                    <span className="text-emerald-600 shrink-0">+</span>
                    <span className="truncate">{f.path}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
              Reviewable infrastructure scaffold — validate and review these files before provisioning. This is not drop-in production code.
            </div>
          )}
          {validationSummary && !writingCode ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-700 font-mono whitespace-pre-wrap">
              {validationSummary}
            </div>
          ) : null}
        </div>
        <div className="flex-1 min-h-0">
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
      <div className="flex-1 min-h-0 rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white overflow-hidden flex flex-col">
        {draftingPlan ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
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
                  className="flex items-center gap-2.5 rounded-lg border border-slate-100 bg-white px-3 py-2 text-[11px] text-slate-600"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-bold text-indigo-600">
                    {i + 1}
                  </span>
                  {label}
                </div>
              ))}
            </div>
          </div>
        ) : awaitingApproval && pendingPlan ? (
          <div className="flex-1 min-h-0 flex flex-col p-4 sm:p-5">
            <div className="shrink-0 mb-3">
              <p className="text-sm font-semibold text-slate-900">
                Architecture plan ready
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Review below, then Approve &amp; Generate in chat — or reply with changes.
              </p>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm">
              <FormattedMessage content={pendingPlan} className="text-slate-700" />
            </div>
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
            <ul className="mt-6 w-full max-w-sm space-y-1.5 text-left text-[11px] font-mono text-slate-500">
              <li className="flex gap-2"><span className="text-indigo-400">›</span> terraform/</li>
              <li className="flex gap-2"><span className="text-indigo-400">›</span> .github/workflows/ or pipeline</li>
              <li className="flex gap-2"><span className="text-indigo-400">›</span> charts/ + Dockerfile + health stub</li>
            </ul>
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
