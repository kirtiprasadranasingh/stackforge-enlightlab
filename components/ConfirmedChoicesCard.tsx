'use client';

import type { InterviewChoiceItem } from '@/lib/interview-choices';

interface ConfirmedChoicesCardProps {
  items: InterviewChoiceItem[];
  compact?: boolean;
}

export function ConfirmedChoicesCard({
  items,
  compact = false,
}: ConfirmedChoicesCardProps) {
  if (!items.length) return null;

  return (
    <div
      className={`w-full text-left rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)] ${
        compact ? 'p-3' : 'p-4'
      }`}
    >
      <div className="flex items-center gap-2 mb-3 pb-2.5 border-b border-slate-100">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Requirements confirmed
          </p>
          <p className="text-[12px] text-slate-600 leading-snug">
            Used to draft your infrastructure plan
          </p>
        </div>
      </div>

      <dl className={`grid gap-2.5 ${compact ? '' : 'sm:grid-cols-2'}`}>
        {items.map((item, index) => (
          <div
            key={`${item.label}-${index}`}
            className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5 min-w-0"
          >
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">
              {item.label}
            </dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900 leading-snug break-words">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
