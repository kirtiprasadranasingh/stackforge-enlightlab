'use client';

import { useState, useCallback, useMemo } from 'react';
import JSZip from 'jszip';
import { CodeBlock } from '@/components/CodeBlock';
import { copyToClipboard } from '@/lib/clipboard';

interface FileViewerProps {
  files: { path: string; language: string; content: string; description?: string }[];
  isGenerating?: boolean;
  promptText?: string;
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

function getFileIcon(path: string) {
  const ext = path.split('.').pop()?.toLowerCase();
  const name = path.split('/').pop()?.toLowerCase();
  
  if (name === 'dockerfile') {
    return (
      <span className="w-4 h-4 flex items-center justify-center text-[10px] select-none shrink-0 font-bold border border-blue-500/20 bg-blue-500/5 rounded">
        🐳
      </span>
    );
  }
  
  if (ext === 'json') {
    return (
      <span className="w-4 h-4 flex items-center justify-center text-[10px] text-amber-500 select-none shrink-0 font-bold border border-amber-500/20 bg-amber-500/5 rounded">
        {"{}"}
      </span>
    );
  }
  
  if (ext === 'tf' || ext === 'tfvars') {
    return (
      <span className="w-4 h-4 flex items-center justify-center text-[8px] text-purple-500 select-none shrink-0 font-extrabold border border-purple-500/20 bg-purple-500/5 rounded">
        TF
      </span>
    );
  }
  
  if (ext === 'js' || ext === 'jsx' || ext === 'ts' || ext === 'tsx') {
    return (
      <span className="w-4 h-4 flex items-center justify-center text-[8px] text-amber-650 select-none shrink-0 font-bold border border-amber-500/20 bg-amber-500/5 rounded">
        JS
      </span>
    );
  }
  
  if (ext === 'yml' || ext === 'yaml') {
    return (
      <span className="w-4 h-4 flex items-center justify-center text-[8px] text-indigo-500 select-none shrink-0 font-extrabold border border-indigo-500/20 bg-indigo-500/5 rounded">
        YML
      </span>
    );
  }
  
  if (ext === 'md') {
    return (
      <span className="w-4 h-4 flex items-center justify-center text-[8px] text-blue-500 select-none shrink-0 font-extrabold border border-blue-500/20 bg-blue-500/5 rounded">
        MD
      </span>
    );
  }
  
  return (
    <span className="w-4 h-4 flex items-center justify-center text-[10px] select-none shrink-0 font-bold border border-gray-500/20 bg-gray-500/5 rounded">
      📄
    </span>
  );
}

export function FileViewer({ files, isGenerating, promptText }: FileViewerProps) {
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

  const copyAll = useCallback(async () => {
    const blob = files
      .map((f) => `===== ${f.path} =====\n${f.content}`)
      .join('\n\n');
    await copyToClipboard(blob);
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
    
    // Generate dynamic filename from promptText
    let filename = 'stackforge-scaffold';
    if (promptText) {
      const sanitized = promptText
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      if (sanitized) {
        filename = `stackforge-${sanitized.slice(0, 50)}`;
      }
    }
    
    a.download = `${filename}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [files, promptText]);

  if (files.length === 0) return null;

  return (
    <div className="card overflow-hidden w-full border border-gray-200 shadow-lg rounded-[20px]">
      <div className="px-4 py-3 border-b border-gray-150 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-gray-50/50 to-white">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-900 tracking-tight">Workspace Blueprint</span>
          <span className="text-xs text-gray-400 font-semibold bg-gray-100 px-2 py-0.5 rounded-full select-none">
            {files.length} files
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={copyAll}
            className="text-xs font-semibold px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 rounded-lg shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            {copied === 'all' ? 'Copied' : 'Copy all'}
          </button>
          <button
            onClick={downloadAll}
            className="text-xs font-semibold px-3.5 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-sm rounded-lg transition-all active:scale-95 cursor-pointer"
            disabled={isGenerating}
          >
            Download ZIP
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row w-full min-h-[460px] max-h-[70vh]">
        {/* File tree — fixed width sidebar */}
        <aside className="w-full md:w-60 md:shrink-0 border-b md:border-b-0 md:border-r border-gray-200 bg-gray-50/80 max-h-[200px] md:max-h-none overflow-y-auto p-2 space-y-1 select-none">
          {dirs.map((dir) => {
            const entries = files.filter((f) => {
              const d = f.path.includes('/')
                ? f.path.slice(0, f.path.lastIndexOf('/'))
                : '';
              return d === dir;
            });
            return (
              <div key={dir || '__root'} className="py-0.5">
                {dir && (
                  <div className="px-2.5 pt-1.5 pb-1 text-[10px] uppercase tracking-wide text-gray-400 font-extrabold flex items-center gap-1.5 select-none">
                    <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                    </svg>
                    {dir}
                  </div>
                )}
                <div className="space-y-0.5 pl-1">
                  {entries.map((file) => {
                    const name = file.path.split('/').pop() || file.path;
                    const active = file.path === selected?.path;
                    return (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => setSelectedPath(file.path)}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-mono rounded-lg truncate transition-all cursor-pointer ${
                          active
                            ? 'bg-white text-blue-600 font-bold border border-gray-200 shadow-sm'
                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 border border-transparent'
                        }`}
                        title={file.path}
                      >
                        {getFileIcon(file.path)}
                        <span className="truncate">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </aside>

        {/* Content — Editor Workspace */}
        <div className="bg-gray-950 text-gray-100 flex-1 min-w-0 flex flex-col overflow-hidden relative">
          {/* Scrollable IDE-style Tab Bar */}
          <div className="flex bg-gray-900 border-b border-gray-800/80 overflow-x-auto shrink-0 select-none no-scrollbar">
            {files.map((f) => {
              const name = f.path.split('/').pop() || f.path;
              const active = f.path === selected?.path;
              return (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => setSelectedPath(f.path)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-[11px] font-mono border-r border-gray-800 transition-all shrink-0 cursor-pointer select-none ${
                    active 
                      ? 'bg-gray-955 text-white font-bold border-t-2 border-t-blue-500' 
                      : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'
                  }`}
                >
                  {getFileIcon(f.path)}
                  <span>{name}</span>
                </button>
              );
            })}
          </div>

          {/* Code Viewer Panel */}
          <div className="flex-1 overflow-auto min-w-0 code-highlight relative">
            {selected && (
              <CodeBlock code={selected.content} language={selected.language} />
            )}
          </div>

          {/* Copy Button Floating Action */}
          <button
            onClick={() => selected && void copyToClipboard(selected.content)}
            className="absolute bottom-4 right-4 bg-gray-800/80 hover:bg-gray-700/90 text-white text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-700 shadow-md backdrop-blur transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
            title="Copy file code"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3a2.25 2.25 0 0 0-2.25 2.25v.008c0 .125-.08.235-.2.244A2.251 2.251 0 0 0 4.5 7.05v11.5c0 1.242 1.008 2.25 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25V7.05a2.25 2.25 0 0 0-3.55-1.908c-.12-.09-.2-.2-.2-.325v-.008Z" />
            </svg>
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}
