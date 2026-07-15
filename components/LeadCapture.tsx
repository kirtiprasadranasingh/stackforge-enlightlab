'use client';

import { useState } from 'react';

interface LeadCaptureProps {
  summary?: string;
  fileCount?: number;
}

const DIAGNOSTIC_URL =
  process.env.NEXT_PUBLIC_DIAGNOSTIC_URL || 'https://enlightlabs.com/contact';

export function LeadCapture({ summary, fileCount }: LeadCaptureProps) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitLead = async (intent: 'email-stack' | 'talk-to-team') => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          intent,
          summary,
          fileCount,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not submit');
      }
      setSubmitted(true);
      if (intent === 'talk-to-team') {
        window.open(DIAGNOSTIC_URL, '_blank', 'noopener,noreferrer');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailStack = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    void submitLead('email-stack');
  };

  if (submitted) {
    return (
      <div className="bg-gradient-to-br from-slate-900 to-indigo-950 text-white p-5 rounded-[20px] border border-slate-800 shadow-xl flex items-center justify-center min-h-[120px] w-full mt-6 select-none animate-fade-slide-up">
        <div className="text-center">
          <div className="w-10 h-10 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h4 className="font-bold text-sm text-white mb-1">Thanks — stack reminder sent!</h4>
          <p className="text-xs text-slate-400 mb-3">
            Ready to deploy this for production? Schedule a diagnostic session with Enlight Labs.
          </p>
          <a
            href={DIAGNOSTIC_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex text-xs font-semibold px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-sm rounded-xl transition-all active:scale-95 no-underline"
          >
            Book a diagnostic
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-slate-900 to-indigo-950 text-white p-5 rounded-[20px] border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4 mt-6 select-none animate-fade-slide-up">
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-1.5">
          <span className="text-blue-500">⚡</span> Save this Blueprint
        </h3>
        <p className="text-[11px] text-slate-300 mt-1 max-w-md leading-relaxed">
          Email yourself a reminder of these configurations, or connect with the Enlight Labs engineering team to deploy them for production.
        </p>
      </div>

      <div className="shrink-0 flex flex-col gap-2 w-full md:w-auto">
        <form onSubmit={handleEmailStack} className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="bg-slate-950/80 hover:bg-slate-950 focus:bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none transition-all w-full sm:w-44"
            required
          />
          <button
            type="submit"
            disabled={submitting}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all active:scale-95 shrink-0 cursor-pointer disabled:opacity-50"
          >
            {submitting ? 'Sending…' : 'Email stack'}
          </button>
        </form>
        {error && <p className="text-[10px] text-red-400">{error}</p>}
        
        <div className="flex items-center justify-between md:justify-end gap-3 text-[10px] text-slate-400 pt-0.5">
          <span>Scaffold preview only</span>
          <button
            type="button"
            onClick={() => {
              if (email.trim()) {
                void submitLead('talk-to-team');
              } else {
                window.open(DIAGNOSTIC_URL, '_blank', 'noopener,noreferrer');
              }
            }}
            className="font-bold text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
          >
            Talk to Enlight Labs →
          </button>
        </div>
      </div>
    </div>
  );
}
