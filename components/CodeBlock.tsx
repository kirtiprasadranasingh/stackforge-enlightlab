'use client';

import { useEffect, useState } from 'react';
import { codeToHtml } from 'shiki';

interface CodeBlockProps {
  code: string;
  language: string;
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

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const lang = LANG_MAP[language.toLowerCase()] || 'text';

    codeToHtml(code, {
      lang,
      theme: 'github-dark',
    })
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (!html) {
    return (
      <pre className="p-4 m-0 overflow-x-auto text-sm leading-relaxed whitespace-pre font-mono">
        <code className="block min-w-full">{code}</code>
      </pre>
    );
  }

  return (
    <div
      className="code-highlight w-full min-w-0 overflow-x-auto text-sm leading-relaxed [&_pre]:m-0 [&_pre]:p-4 [&_pre]:bg-transparent! [&_pre]:overflow-x-auto! [&_pre]:whitespace-pre! [&_code]:whitespace-pre!"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
