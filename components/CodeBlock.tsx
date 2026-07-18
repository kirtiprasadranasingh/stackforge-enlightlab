'use client';

import { useEffect, useMemo, useState } from 'react';
import { codeToTokens } from 'shiki';

interface CodeBlockProps {
  code: string;
  language: string;
  path?: string;
  theme?: 'dark' | 'light';
}

type LineToken = Awaited<ReturnType<typeof codeToTokens>>['tokens'][number][number];

const LANG_MAP: Record<string, string> = {
  hcl: 'hcl',
  tf: 'hcl',
  terraform: 'hcl',
  yaml: 'yaml',
  yml: 'yaml',
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  bash: 'bash',
  shell: 'bash',
  sh: 'bash',
  json: 'json',
  markdown: 'markdown',
  md: 'markdown',
  typescript: 'typescript',
  ts: 'typescript',
  javascript: 'javascript',
  js: 'javascript',
  python: 'python',
  py: 'python',
  go: 'go',
  golang: 'go',
  toml: 'toml',
  plaintext: 'text',
  text: 'text',
  plain: 'text',
};

function resolveLang(language: string, path?: string): string {
  const fromProp = LANG_MAP[(language || '').toLowerCase().trim()];
  if (fromProp && fromProp !== 'text') return fromProp;

  if (path) {
    const name = path.split('/').pop()?.toLowerCase() || '';
    if (name === 'dockerfile' || name.startsWith('dockerfile.')) return 'dockerfile';
    if (name.endsWith('.tf') || name.endsWith('.tfvars') || name.endsWith('.hcl')) return 'hcl';
    if (name.endsWith('.yml') || name.endsWith('.yaml')) return 'yaml';
    if (name.endsWith('.md')) return 'markdown';
    if (name.endsWith('.go') || name === 'go.mod' || name === 'go.sum') return 'go';
    if (name.endsWith('.json')) return 'json';
    if (name.endsWith('.py')) return 'python';
    if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'typescript';
    if (name.endsWith('.js') || name.endsWith('.jsx')) return 'javascript';
    if (name.endsWith('.sh')) return 'bash';
  }

  return fromProp || 'text';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tokensToLineHtml(lineTokens: LineToken[]): string {
  if (!lineTokens.length) return '&nbsp;';
  return lineTokens
    .map((t) => {
      const color = t.color ? `color:${t.color}` : '';
      const fontStyle = t.fontStyle ? tokenFontStyle(t.fontStyle) : '';
      const style = [color, fontStyle].filter(Boolean).join(';');
      const content = escapeHtml(t.content) || '&nbsp;';
      return style ? `<span style="${style}">${content}</span>` : content;
    })
    .join('');
}

function tokenFontStyle(fontStyle: number): string {
  const parts: string[] = [];
  if (fontStyle & 1) parts.push('font-style:italic');
  if (fontStyle & 2) parts.push('font-weight:bold');
  if (fontStyle & 4) parts.push('text-decoration:underline');
  return parts.join(';');
}

/** Highlights the entire code block and returns an array of HTML lines. */
async function highlightCode(
  code: string,
  lang: string,
  theme: string
): Promise<string[]> {
  try {
    const result = await codeToTokens(code.length ? code : ' ', {
      lang: lang as 'go',
      theme: theme as 'dark-plus',
    });
    return result.tokens.map((lineTokens) =>
      lineTokens.length ? tokensToLineHtml(lineTokens) : '&nbsp;'
    );
  } catch {
    return code.split('\n').map((line) => (line.length ? escapeHtml(line) : '&nbsp;'));
  }
}

export function CodeBlock({ code, language, path, theme = 'dark' }: CodeBlockProps) {
  const [lineHtml, setLineHtml] = useState<string[] | null>(null);
  const normalized = useMemo(() => code.replace(/\r\n/g, '\n'), [code]);
  const lines = useMemo(() => normalized.split('\n'), [normalized]);
  const shikiTheme = theme === 'light' ? 'github-light' : 'dark-plus';
  const lang = useMemo(() => resolveLang(language, path), [language, path]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setLineHtml(null);
    });

    void highlightCode(normalized, lang, shikiTheme).then((html) => {
      if (!cancelled) setLineHtml(html);
    });

    return () => {
      cancelled = true;
    };
  }, [normalized, lang, shikiTheme]);

  const isLight = theme === 'light';
  const bg = isLight ? 'bg-white' : 'bg-[#1e1e1e]';
  const gutterBg = isLight ? 'bg-[#f6f8fa]' : 'bg-[#1e1e1e]';
  const gutterFg = isLight ? 'text-[#8c959f]' : 'text-[#858585]';
  const gutterBorder = isLight ? 'border-[#d0d7de]' : 'border-[#2b2b2b]';

  const displayLines = lineHtml ?? lines.map((l) => (l.length ? escapeHtml(l) : '&nbsp;'));

  return (
    <div className={`vscode-editor min-w-full font-mono text-[13px] ${bg}`}>
      {lines.map((_, idx) => (
        <div key={idx} className="vscode-row flex min-w-full">
          <div
            className={`vscode-ln shrink-0 select-none text-right border-r ${gutterBg} ${gutterFg} ${gutterBorder}`}
            aria-hidden
          >
            {idx + 1}
          </div>
          <div
            className="vscode-code-line flex-1 min-w-0 pl-4 pr-4"
            dangerouslySetInnerHTML={{ __html: displayLines[idx] ?? '&nbsp;' }}
          />
        </div>
      ))}
    </div>
  );
}
