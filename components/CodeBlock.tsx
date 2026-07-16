'use client';

import { useEffect, useMemo, useState } from 'react';
import { codeToHtml } from 'shiki';

interface CodeBlockProps {
  code: string;
  language: string;
  theme?: 'dark' | 'light';
}

const LANG_MAP: Record<string, string> = {
  hcl: 'hcl',
  tf: 'hcl',
  yaml: 'yaml',
  yml: 'yaml',
  dockerfile: 'dockerfile',
  bash: 'bash',
  shell: 'bash',
  sh: 'bash',
  json: 'json',
  markdown: 'markdown',
  md: 'markdown',
  typescript: 'typescript',
  javascript: 'javascript',
  python: 'python',
  go: 'go',
  plaintext: 'text',
};

export function CodeBlock({ code, language, theme = 'dark' }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  const lines = useMemo(() => code.split('\n'), [code]);
  const shikiTheme = theme === 'light' ? 'github-light' : 'dark-plus';

  useEffect(() => {
    let cancelled = false;
    const lang = LANG_MAP[language.toLowerCase()] || 'text';

    codeToHtml(code, {
      lang,
      theme: shikiTheme,
    })
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {
        if (!cancelled) {
          codeToHtml(code, { lang, theme: theme === 'light' ? 'github-light' : 'github-dark' })
            .then((result) => {
              if (!cancelled) setHtml(result);
            })
            .catch(() => {
              if (!cancelled) setHtml(null);
            });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, language, theme, shikiTheme]);

  const gutter = (
    <div
      className={`vscode-gutter shrink-0 select-none text-right ${
        theme === 'light' ? 'bg-[#f3f3f3] text-[#237893]' : 'bg-[#1e1e1e] text-[#858585]'
      }`}
      aria-hidden
    >
      {lines.map((_, idx) => (
        <div key={idx} className="vscode-ln">
          {idx + 1}
        </div>
      ))}
    </div>
  );

  if (!html) {
    return (
      <div className={`vscode-editor flex min-w-full font-mono text-[13px] leading-[1.55] ${
        theme === 'light' ? 'bg-white text-[#24292e]' : 'bg-[#1e1e1e] text-[#d4d4d4]'
      }`}>
        {gutter}
        <pre className="vscode-code flex-1 m-0 overflow-x-auto p-0 pl-4 pr-4 py-3">
          <code className="block min-w-full">
            {lines.map((line, idx) => (
              <span key={idx} className="block whitespace-pre">
                {line || ' '}
              </span>
            ))}
          </code>
        </pre>
      </div>
    );
  }

  return (
    <div className={`vscode-editor flex min-w-full font-mono text-[13px] leading-[1.55] ${
      theme === 'light' ? 'bg-white text-[#24292e]' : 'bg-[#1e1e1e] text-[#d4d4d4]'
    }`}>
      {gutter}
      <div
        className="vscode-code flex-1 min-w-0 overflow-x-auto py-3 pr-4 code-highlight [&_pre]:m-0! [&_pre]:p-0! [&_pre]:pl-4! [&_pre]:bg-transparent! [&_pre]:overflow-visible! [&_pre]:whitespace-pre! [&_code]:whitespace-pre! [&_.line]:block"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
