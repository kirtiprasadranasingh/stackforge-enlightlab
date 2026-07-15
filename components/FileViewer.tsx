'use client';

import { useState, useMemo, useCallback } from 'react';
import JSZip from 'jszip';
import { copyToClipboard } from '@/lib/clipboard';
import { CodeBlock } from './CodeBlock';

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
      <span className="w-4 h-4 flex items-center justify-center text-[8px] text-amber-600 select-none shrink-0 font-bold border border-amber-500/20 bg-amber-500/5 rounded">
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
  const [searchQuery, setSearchQuery] = useState('');

  const activePath = selectedPath && files.some((f) => f.path === selectedPath)
    ? selectedPath
    : (files[0]?.path || null);

  const selected = useMemo(
    () => files.find((f) => f.path === activePath) || files[0],
    [files, activePath]
  );

  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;
    return files.filter(f => f.path.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [files, searchQuery]);

  const dirs = useMemo(() => {
    const tree = buildTree(filteredFiles.map((f) => f.path));
    return Array.from(tree.keys()).sort((a, b) => a.localeCompare(b));
  }, [filteredFiles]);

  const downloadAll = useCallback(async () => {
    const zip = new JSZip();
    files.forEach((file) => {
      zip.file(file.path, file.content);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
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
    <div className="flex flex-col md:flex-row w-full flex-1 min-h-0 border border-gray-200 shadow-sm rounded-xl overflow-hidden bg-white select-none">
      {/* File Tree Explorer (Left Sidebar) */}
      <aside className="w-full md:w-60 md:shrink-0 border-b md:border-b-0 md:border-r border-gray-200 bg-white flex flex-col justify-between max-h-[220px] md:max-h-none overflow-hidden">
        
        {/* Search Bar Header */}
        <div className="p-2.5 border-b border-gray-200 bg-white select-none">
          <div className="relative">
            <input
              type="text"
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-gray-200 focus:border-indigo-500 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-700 focus:outline-none transition-all placeholder-gray-400"
            />
            <svg className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          </div>
        </div>

        {/* Tree Items List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {/* ROOT node */}
          <div className="px-2 pb-1.5 text-[10px] font-extrabold text-gray-400 select-none tracking-wider">
            📁 ROOT
          </div>
          {dirs.map((dir) => {
            const entries = filteredFiles.filter((f) => {
              const d = f.path.includes('/')
                ? f.path.slice(0, f.path.lastIndexOf('/'))
                : '';
              return d === dir;
            });
            return (
              <div key={dir || '__root'} className="py-0.5">
                {dir && (
                  <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wide text-gray-450 font-bold flex items-center gap-1 select-none">
                    <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                    </svg>
                    {dir}
                  </div>
                )}
                <div className={`space-y-0.5 ${dir ? 'pl-2.5' : 'pl-0'}`}>
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
                            ? 'bg-slate-100 text-indigo-600 font-bold border border-slate-200'
                            : 'text-gray-650 hover:bg-slate-50 hover:text-gray-900 border border-transparent'
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
        </div>

        {/* Download Workspace button */}
        <div className="p-2.5 border-t border-gray-200 bg-slate-50/50">
          <button
            onClick={downloadAll}
            className="w-full text-xs font-bold py-2 bg-white hover:bg-slate-100 text-gray-700 border border-gray-200 rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
          >
            📥 Download Workspace
          </button>
        </div>
      </aside>

      {/* Code Editor Container */}
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
                className={`flex items-center gap-2 px-4 py-2.5 text-[11px] font-mono border-r border-gray-850 transition-all shrink-0 cursor-pointer select-none ${
                  active 
                    ? 'bg-[#18181b] text-white font-bold border-t-2 border-t-indigo-500' 
                    : 'text-gray-400 hover:bg-gray-850/60 hover:text-gray-200'
                }`}
              >
                {getFileIcon(f.path)}
                <span>{name}</span>
              </button>
            );
          })}
        </div>

        {/* Code Viewer Scroll Pane */}
        <div className="flex-1 overflow-auto min-w-0 code-highlight relative">
          {selected && (
            <CodeBlock code={selected.content} language={selected.language} />
          )}
        </div>

        {/* Code Editor Status Bar */}
        <div className="h-6 border-t border-gray-800 bg-gray-900 text-gray-400 text-[10px] px-3 flex items-center justify-between shrink-0 select-none font-mono">
          <div className="flex items-center gap-3">
            <span>Ln 1, Col 1</span>
            <span>Spaces: 2</span>
            <span>UTF-8</span>
            <span>LF</span>
            <span className="capitalize">{selected?.language || 'plain'}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-green-500">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span> No errors
            </span>
            <button
              onClick={() => selected && void copyToClipboard(selected.content)}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Format
            </button>
            <button
              onClick={() => selected && void copyToClipboard(selected.content)}
              className="hover:text-white transition-colors cursor-pointer font-sans"
              title="Copy current file content"
            >
              📋
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
