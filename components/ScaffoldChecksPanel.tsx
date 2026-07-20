'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeneratedFile } from '@/types';
import {
  CHECK_LABELS,
  type ScaffoldCheckId,
} from '@/lib/scaffold-checks-shared';

interface ScaffoldChecksPanelProps {
  files: GeneratedFile[];
  isGenerating: boolean;
  /** Auto-run full checks once after generation finishes */
  autoRun?: boolean;
}

type TermLine = { id: number; text: string; kind: 'out' | 'meta' | 'err' };

const BUTTONS: { id: ScaffoldCheckId; short: string }[] = [
  { id: 'all', short: 'All checks' },
  { id: 'terraform', short: 'Terraform' },
  { id: 'helm', short: 'Helm' },
  { id: 'hadolint', short: 'Dockerfile' },
  { id: 'actionlint', short: 'Workflows' },
];

function filesFingerprint(files: GeneratedFile[]): string {
  return files.map((f) => `${f.path}:${f.content.length}`).join('|');
}

export function ScaffoldChecksPanel({
  files,
  isGenerating,
  autoRun = true,
}: ScaffoldChecksPanelProps) {
  const [lines, setLines] = useState<TermLine[]>([]);
  const [running, setRunning] = useState<ScaffoldCheckId | null>(null);
  const [lastResult, setLastResult] = useState<'ok' | 'fail' | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lineIdRef = useRef(0);
  const autoRanForRef = useRef<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const append = useCallback((text: string, kind: TermLine['kind'] = 'out') => {
    const id = ++lineIdRef.current;
    setLines((prev) => {
      const next = [...prev, { id, text, kind }];
      return next.length > 800 ? next.slice(-800) : next;
    });
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setLastResult(null);
    lineIdRef.current = 0;
  }, []);

  const runCheck = useCallback(
    async (check: ScaffoldCheckId) => {
      if (files.length === 0 || isGenerating) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setRunning(check);
      setLastResult(null);
      setCollapsed(false);
      append(`▸ ${CHECK_LABELS[check]}`, 'meta');

      try {
        const response = await fetch('/api/validate-scaffold', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ac.signal,
          body: JSON.stringify({
            check,
            files: files.map((f) => ({ path: f.path, content: f.content })),
          }),
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => null);
          throw new Error(
            (errBody as { error?: string } | null)?.error ||
              `Request failed (${response.status})`
          );
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream');
        const decoder = new TextDecoder();
        let buffer = '';
        let exitOk: boolean | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';
          for (const chunk of chunks) {
            const dataLine = chunk
              .split('\n')
              .find((l) => l.startsWith('data: '));
            if (!dataLine) continue;
            let event: {
              type?: string;
              text?: string;
              message?: string;
              error?: string;
              ok?: boolean;
              exitCode?: number;
            };
            try {
              event = JSON.parse(dataLine.slice(6));
            } catch {
              continue;
            }
            if (event.type === 'line' && event.text != null) {
              append(event.text, 'out');
            } else if (event.type === 'status' && event.message) {
              append(event.message, 'meta');
            } else if (event.type === 'error' && event.error) {
              append(event.error, 'err');
            } else if (event.type === 'done') {
              exitOk = event.ok === true || event.exitCode === 0;
            }
          }
        }

        if (exitOk === true) {
          setLastResult('ok');
          append('RESULT: PASSED', 'meta');
        } else if (exitOk === false) {
          setLastResult('fail');
          append('RESULT: FAILED', 'err');
        }
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          append('▸ Cancelled', 'meta');
        } else {
          setLastResult('fail');
          append(e instanceof Error ? e.message : 'Check failed', 'err');
        }
      } finally {
        setRunning(null);
        abortRef.current = null;
      }
    },
    [append, files, isGenerating]
  );

  // Auto-run full suite once per generated file set after streaming completes.
  useEffect(() => {
    if (!autoRun || isGenerating || files.length === 0 || running) return;
    const fp = filesFingerprint(files);
    if (autoRanForRef.current === fp) return;
    autoRanForRef.current = fp;
    void runCheck('all');
  }, [autoRun, isGenerating, files, running, runCheck]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  if (files.length === 0) return null;

  const statusLabel =
    running != null
      ? `Running ${CHECK_LABELS[running]}…`
      : lastResult === 'ok'
        ? 'Last run passed'
        : lastResult === 'fail'
          ? 'Last run failed'
          : 'Ready';

  return (
    <div className="shrink-0 flex flex-col border border-slate-800 rounded-lg overflow-hidden bg-[#0c0c0c] shadow-inner">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-800 bg-[#161616]">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="text-[11px] font-semibold text-slate-200 hover:text-white cursor-pointer flex items-center gap-1.5"
          aria-expanded={!collapsed}
        >
          <span
            className={`inline-block transition-transform ${collapsed ? '-rotate-90' : ''}`}
            aria-hidden
          >
            ▾
          </span>
          Scaffold checks
        </button>
        <span
          className={`text-[10px] font-mono truncate ${
            lastResult === 'ok'
              ? 'text-emerald-400'
              : lastResult === 'fail'
                ? 'text-rose-400'
                : running
                  ? 'text-amber-300'
                  : 'text-slate-500'
          }`}
        >
          {statusLabel}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1 justify-end">
          {BUTTONS.map((b) => (
            <button
              key={b.id}
              type="button"
              disabled={isGenerating || running != null}
              onClick={() => void runCheck(b.id)}
              title={CHECK_LABELS[b.id]}
              className="text-[10px] font-semibold px-2 py-1 rounded border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:border-slate-500 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              {b.short}
            </button>
          ))}
          {running ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="text-[10px] font-semibold px-2 py-1 rounded border border-rose-800/80 bg-rose-950 text-rose-200 hover:bg-rose-900 cursor-pointer"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={clear}
              className="text-[10px] font-semibold px-2 py-1 rounded border border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {!collapsed ? (
        <div
          ref={scrollRef}
          className="h-40 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-300"
          role="log"
          aria-live="polite"
          aria-label="Scaffold check output"
        >
          {lines.length === 0 ? (
            <p className="text-slate-600">
              Allowlisted checks only (terraform / helm / hadolint / actionlint). No
              apply or destroy. Full suite runs automatically after generate.
            </p>
          ) : (
            lines.map((l) => (
              <div
                key={l.id}
                className={
                  l.kind === 'err'
                    ? 'text-rose-300 whitespace-pre-wrap break-all'
                    : l.kind === 'meta'
                      ? 'text-sky-300/90 whitespace-pre-wrap break-all'
                      : 'whitespace-pre-wrap break-all'
                }
              >
                {l.text || '\u00a0'}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
