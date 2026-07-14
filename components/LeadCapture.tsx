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
      <div className="card p-6 bg-gradient-to-br from-blue-50 to-teal-50">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="font-bold text-[var(--navy-heading)] mb-2">Thanks — we got it</h3>
          <p className="text-sm text-[var(--muted-text)] mb-4">
            This is how Enlight Lab builds. Ready for a paid diagnostic on your real stack?
          </p>
          <a
            href={DIAGNOSTIC_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex text-sm font-semibold px-6 py-2.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 text-white shadow-sm rounded-xl transition-all active:scale-95 no-underline"
          >
            Book a diagnostic
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h3 className="font-bold text-[var(--navy-heading)] mb-2">Keep this stack</h3>
      <p className="text-sm text-[var(--muted-text)] mb-4">
        Soft CTA only — generation was free. Email yourself a reminder, or talk to the team that builds these for real.
      </p>

      <form onSubmit={handleEmailStack} className="space-y-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          className="input text-sm"
          required
        />
        {error && <p className="text-xs text-[var(--error)]">{error}</p>}
        <button type="submit" className="w-full text-sm font-semibold py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-sm rounded-xl transition-all active:scale-95" disabled={submitting}>
          {submitting ? 'Sending…' : 'Email this stack'}
        </button>
      </form>

      <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
        <p className="text-xs text-[var(--muted-text)] mb-3">
          Want the team that builds stacks like this for production?
        </p>
        <button
          type="button"
          className="w-full text-sm font-semibold py-2.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 text-white shadow-sm rounded-xl transition-all active:scale-95"
          disabled={submitting}
          onClick={() => {
            if (email.trim()) {
              void submitLead('talk-to-team');
            } else {
              window.open(DIAGNOSTIC_URL, '_blank', 'noopener,noreferrer');
            }
          }}
        >
          Talk to Enlight Labs
        </button>
        <p className="text-[10px] text-[var(--muted-text)] mt-2 text-center">
          Routes to our paid diagnostic — proof of how we build, not free SaaS.
        </p>
      </div>

      <p className="text-xs text-[var(--muted-text)] mt-4">
        Reviewable scaffold only. Review before you apply anything to a real account.
      </p>
    </div>
  );
}
