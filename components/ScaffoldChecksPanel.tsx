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
  /**
   * When checks fail, offer a one-click repair that sends FAIL lines into chat
   * as an iterative fix (keeps existing files; does not restart clarify/plan).
   */
  onFixFailures?: (failReport: string) => void;
  /** Bubble check status up for the Validate step strip (not an error banner). */
  onStatusChange?: (status: 'idle' | 'running' | 'ok' | 'fail') => void;
  /** Apply server-side normalize repairs into the workspace before checks run. */
  onNormalizedFiles?: (files: GeneratedFile[]) => void;
}

type TermLine = { id: number; text: string; kind: 'out' | 'meta' | 'err' };

const BUTTONS: { id: ScaffoldCheckId; short: string }[] = [
  { id: 'all', short: 'All checks' },
  { id: 'terraform', short: 'Terraform' },
  { id: 'helm', short: 'Helm' },
  { id: 'hadolint', short: 'Dockerfile' },
  { id: 'actionlint', short: 'Workflows' },
];

const HEIGHT_MIN = 96;
const HEIGHT_MAX = 420;
const HEIGHT_DEFAULT = 160;
const HEIGHT_STEP = 56;

function filesFingerprint(files: GeneratedFile[]): string {
  return files.map((f) => `${f.path}:${f.content.length}`).join('|');
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

export function ScaffoldChecksPanel({
  files,
  isGenerating,
  autoRun = true,
  onFixFailures,
  onStatusChange,
  onNormalizedFiles,
}: ScaffoldChecksPanelProps) {
  const [lines, setLines] = useState<TermLine[]>([]);
  const [running, setRunning] = useState<ScaffoldCheckId | null>(null);
  const [lastResult, setLastResult] = useState<'ok' | 'fail' | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [height, setHeight] = useState(HEIGHT_DEFAULT);
  const abortRef = useRef<AbortController | null>(null);
  const lineIdRef = useRef(0);
  const autoRanForRef = useRef<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const append = useCallback((text: string, kind: TermLine['kind'] = 'out') => {
    const id = ++lineIdRef.current;
    const clean = stripAnsi(text);
    setLines((prev) => {
      const next = [...prev, { id, text: clean, kind }];
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
      let timedOut = false;
      // Terraform validate on a 1-pod deploy can hang the whole API.
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, 4 * 60 * 1000);
      setRunning(check);
      setLastResult(null);
      setDismissed(false);
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
              files?: GeneratedFile[];
            };
            try {
              event = JSON.parse(dataLine.slice(6));
            } catch {
              continue;
            }
            if (event.type === 'normalized' && Array.isArray(event.files)) {
              autoRanForRef.current = filesFingerprint(event.files);
              onNormalizedFiles?.(event.files);
              append('Applied validate-stable Terraform repairs to workspace', 'meta');
            } else if (event.type === 'line' && event.text != null) {
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
        } else {
          setLastResult('fail');
          append(
            'RESULT: INCOMPLETE — connection closed before checks finished. Stop, hard-refresh if chat fails, then retry.',
            'err'
          );
        }
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          if (timedOut) {
            setLastResult('fail');
            append(
              '▸ Timed out after 4 minutes — terraform validate likely overloaded the pod. Restart stackforge, then retry checks.',
              'err'
            );
          } else {
            append('▸ Cancelled', 'meta');
          }
        } else {
          setLastResult('fail');
          const msg = e instanceof Error ? e.message : 'Check failed';
          append(
            /fetch|network|failed to fetch/i.test(msg)
              ? 'Could not reach validate API (pod overloaded or hung). Hard-refresh; if the page still spins, restart deployment/stackforge.'
              : msg,
            'err'
          );
        }
      } finally {
        window.clearTimeout(timeoutId);
        setRunning(null);
        abortRef.current = null;
      }
    },
    [append, files, isGenerating, onNormalizedFiles]
  );

  const collectFailReport = useCallback(() => {
    const failLines = lines
      .map((l) => l.text)
      .filter((t) => /^FAIL\s+-/i.test(t.trim()) || /^RESULT:\s*FAILED/i.test(t.trim()));
    if (failLines.length > 0) return failLines.join('\n');
    // Fallback: whole terminal buffer (still capped by buildValidationFixPrompt)
    return lines
      .map((l) => l.text)
      .join('\n')
      .slice(-5000);
  }, [lines]);

  const handleFixFailures = useCallback(() => {
    if (!onFixFailures || isGenerating || running != null) return;
    const report = collectFailReport();
    if (!report.trim()) return;
    onFixFailures(report);
  }, [onFixFailures, isGenerating, running, collectFailReport]);

  useEffect(() => {
    if (!onStatusChange) return;
    if (running) onStatusChange('running');
    else if (lastResult === 'ok') onStatusChange('ok');
    else if (lastResult === 'fail') onStatusChange('fail');
    else onStatusChange('idle');
  }, [running, lastResult, onStatusChange]);

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

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - e.clientY;
      const next = Math.min(
        HEIGHT_MAX,
        Math.max(HEIGHT_MIN, dragRef.current.startH + delta)
      );
      setHeight(next);
      setCollapsed(false);
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  if (files.length === 0) return null;

  if (dismissed) {
    return (
      <div className="shrink-0 flex items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5">
        <span className="text-[11px] text-slate-600">
          Scaffold checks hidden
          {lastResult === 'fail' ? (
            <span className="ml-2 text-rose-600 font-semibold">· last run failed</span>
          ) : lastResult === 'ok' ? (
            <span className="ml-2 text-emerald-600 font-semibold">· last run passed</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => setDismissed(false)}
          className="text-[10px] font-semibold px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
        >
          Show terminal
        </button>
      </div>
    );
  }

  const statusLabel =
    running != null
      ? `Running ${CHECK_LABELS[running]}…`
      : lastResult === 'ok'
        ? 'Last run passed'
        : lastResult === 'fail'
          ? 'Last run failed'
          : 'Ready';

  return (
    <div className="shrink-0 flex flex-col border border-slate-800 rounded-lg overflow-hidden bg-[#0c0c0c] shadow-inner relative">
      {/* Drag handle — pull up to grow, down to shrink */}
      <button
        type="button"
        aria-label="Resize scaffold checks panel"
        title="Drag to resize"
        onPointerDown={(e) => {
          e.preventDefault();
          dragRef.current = { startY: e.clientY, startH: height };
          document.body.style.cursor = 'ns-resize';
          document.body.style.userSelect = 'none';
        }}
        className="h-2 w-full cursor-ns-resize bg-[#161616] hover:bg-slate-700 border-b border-slate-800 flex items-center justify-center"
      >
        <span className="block h-0.5 w-8 rounded-full bg-slate-600" aria-hidden />
      </button>

      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-800 bg-[#161616]">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="text-[11px] font-semibold text-slate-200 hover:text-white cursor-pointer flex items-center gap-1.5"
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand' : 'Collapse'}
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
          <button
            type="button"
            aria-label="Make terminal smaller"
            title="Smaller"
            disabled={collapsed || height <= HEIGHT_MIN}
            onClick={() =>
              setHeight((h) => Math.max(HEIGHT_MIN, h - HEIGHT_STEP))
            }
            className="text-[11px] font-bold w-6 h-6 rounded border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            −
          </button>
          <button
            type="button"
            aria-label="Make terminal larger"
            title="Larger"
            disabled={collapsed || height >= HEIGHT_MAX}
            onClick={() => {
              setCollapsed(false);
              setHeight((h) => Math.min(HEIGHT_MAX, h + HEIGHT_STEP));
            }}
            className="text-[11px] font-bold w-6 h-6 rounded border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            +
          </button>
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
          {lastResult === 'fail' && onFixFailures ? (
            <button
              type="button"
              disabled={isGenerating || running != null}
              onClick={handleFixFailures}
              title="Send failed checks to chat and regenerate corrected files"
              className="text-[10px] font-semibold px-2 py-1 rounded border border-indigo-500/80 bg-indigo-950 text-indigo-100 hover:bg-indigo-900 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              Fix failures
            </button>
          ) : null}
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
          <button
            type="button"
            aria-label="Close scaffold checks"
            title="Close"
            onClick={() => {
              abortRef.current?.abort();
              setDismissed(true);
            }}
            className="text-[12px] font-bold w-6 h-6 rounded border border-slate-700 bg-slate-900 text-slate-400 hover:text-white hover:border-slate-500 cursor-pointer"
          >
            ×
          </button>
        </div>
      </div>

      {!collapsed ? (
        <div
          ref={scrollRef}
          style={{ height }}
          className="overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-300"
          role="log"
          aria-live="polite"
          aria-label="Scaffold check output"
        >
          {lines.length === 0 ? (
            <p className="text-slate-600">
              Allowlisted checks only (terraform / helm / hadolint / actionlint). No
              apply or destroy. Full suite runs automatically after generate. Use − / +
              or drag the top edge to resize; × closes the panel.
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
