'use client';

import { useState, useCallback, useMemo } from 'react';
import JSZip from 'jszip';
import { CodeBlock } from '@/components/CodeBlock';

interface FileViewerProps {
  files: { path: string; language: string; content: string; description?: string }[];
  isGenerating?: boolean;
}

function buildTree(paths: string[]): Map<string, string[]> {
  const root = new Map<string, string[]>();
  for (const path of paths) {
    const parts = path.split('/');
    if (parts.length === 1) {
      const list = root.get('') || [];
      list.push(path);
      root.set('', list);
    } else {
      const dir = parts.slice(0, -1).join('/');
      const list = root.get(dir) || [];
      list.push(path);
      root.set(dir, list);
    }
  }
  return root;
}

export function FileViewer({ files, isGenerating }: FileViewerProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [copied, setCopied] = useState<'file' | 'all' | null>(null);

  const activePath = selectedPath && files.some((f) => f.path === selectedPath)
    ? selectedPath
    : (files[0]?.path || null);

  const selected = useMemo(
    () => files.find((f) => f.path === activePath) || files[0],
    [files, activePath]
  );

  const dirs = useMemo(() => {
    const tree = buildTree(files.map((f) => f.path));
    return Array.from(tree.keys()).sort((a, b) => a.localeCompare(b));
  }, [files]);

  const copyFile = useCallback(async (content: string) => {
    await navigator.clipboard.writeText(content);
    setCopied('file');
    setTimeout(() => setCopied(null), 1500);
  }, []);

  const copyAll = useCallback(async () => {
    const blob = files
      .map((f) => `===== ${f.path} =====\n${f.content}`)
      .join('\n\n');
    await navigator.clipboard.writeText(blob);
    setCopied('all');
    setTimeout(() => setCopied(null), 1500);
  }, [files]);

  const downloadAll = useCallback(async () => {
    const zip = new JSZip();
    files.forEach((file) => {
      zip.file(file.path, file.content);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stackforge-scaffold.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [files]);

  if (files.length === 0) return null;

  return (
    <div className="card overflow-hidden w-full">
      <div className="px-4 py-3 border-b border-[var(--border-color)] flex flex-wrap items-center justify-between gap-2 bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--navy-heading)]">Project files</span>
          <span className="text-xs text-[var(--muted-text)]">
            ({files.length}{isGenerating ? '…' : ''})
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => selected && copyFile(selected.content)}
            className="btn-ghost text-xs px-3 py-1.5"
            disabled={!selected}
          >
            {copied === 'file' ? 'Copied' : 'Copy file'}
          </button>
          <button onClick={copyAll} className="btn-ghost text-xs px-3 py-1.5">
            {copied === 'all' ? 'Copied' : 'Copy all'}
          </button>
          <button onClick={downloadAll} className="btn-primary text-xs px-3 py-1.5" disabled={isGenerating}>
            Download ZIP
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row w-full min-h-[420px] max-h-[70vh]">
        {/* File tree — fixed width sidebar */}
        <aside className="w-full md:w-64 md:shrink-0 border-b md:border-b-0 md:border-r border-[var(--border-color)] bg-white max-h-[200px] md:max-h-none overflow-y-auto">
          {dirs.map((dir) => {
            const entries = files.filter((f) => {
              const d = f.path.includes('/')
                ? f.path.slice(0, f.path.lastIndexOf('/'))
                : '';
              return d === dir;
            });
            return (
              <div key={dir || '__root'} className="py-1">
                {dir && (
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-[var(--muted-text)] font-semibold">
                    {dir}/
                  </div>
                )}
                {entries.map((file) => {
                  const name = file.path.split('/').pop() || file.path;
                  const active = file.path === selected?.path;
                  return (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setSelectedPath(file.path)}
                      className={`w-full text-left px-3 py-1.5 text-xs font-mono truncate transition-colors ${
                        active
                          ? 'bg-indigo-50 text-[var(--primary-blue)]'
                          : 'text-[var(--body-text)] hover:bg-gray-50'
                      }`}
                      title={file.path}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </aside>

        {/* Content — takes remaining width */}
        <div className="bg-gray-900 text-gray-100 flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="px-4 py-2 bg-gray-800 flex items-center justify-between gap-2 shrink-0">
            <div className="min-w-0 overflow-hidden">
              <span className="text-xs font-mono text-gray-300 block truncate">
                {selected?.path}
              </span>
              {selected?.description && (
                <span className="text-[10px] text-gray-500 block truncate">
                  {selected.description}
                </span>
              )}
            </div>
            <button
              onClick={() => selected && copyFile(selected.content)}
              className="text-xs text-gray-400 hover:text-white transition-colors shrink-0"
            >
              Copy
            </button>
          </div>
          <div className="flex-1 overflow-auto min-w-0">
            {selected && (
              <CodeBlock code={selected.content} language={selected.language} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
