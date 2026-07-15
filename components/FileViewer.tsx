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

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children: TreeNode[];
}

function buildFileTree(files: { path: string }[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const file of files) {
    const parts = file.path.split('/');
    let currentLevel = root;
    let currentPath = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLast = i === parts.length - 1;
      let node = currentLevel.find((n) => n.name === part);
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: isLast ? 'file' : 'folder',
          children: [],
        };
        currentLevel.push(node);
      }
      currentLevel = node.children;
    }
  }
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(root);
  return root;
}

function getFileIcon(path: string) {
  const ext = path.split('.').pop()?.toLowerCase();
  const name = path.split('/').pop()?.toLowerCase();
  
  if (name === 'dockerfile') return <span className="w-4 h-4 flex items-center justify-center text-[10px] select-none shrink-0 font-bold border border-blue-500/20 bg-blue-500/5 rounded">🐳</span>;
  if (ext === 'json') return <span className="w-4 h-4 flex items-center justify-center text-[10px] text-amber-500 select-none shrink-0 font-bold border border-amber-500/20 bg-amber-500/5 rounded">{"{}"}</span>;
  if (ext === 'tf' || ext === 'tfvars') return <span className="w-4 h-4 flex items-center justify-center text-[8px] text-purple-500 select-none shrink-0 font-extrabold border border-purple-500/20 bg-purple-500/5 rounded">TF</span>;
  if (ext === 'js' || ext === 'jsx' || ext === 'ts' || ext === 'tsx') return <span className="w-4 h-4 flex items-center justify-center text-[8px] text-amber-600 select-none shrink-0 font-bold border border-amber-500/20 bg-amber-500/5 rounded">JS</span>;
  if (ext === 'yml' || ext === 'yaml') return <span className="w-4 h-4 flex items-center justify-center text-[8px] text-indigo-500 select-none shrink-0 font-extrabold border border-indigo-500/20 bg-indigo-500/5 rounded">YML</span>;
  if (ext === 'md') return <span className="w-4 h-4 flex items-center justify-center text-[8px] text-blue-500 select-none shrink-0 font-extrabold border border-blue-500/20 bg-blue-500/5 rounded">MD</span>;
  
  return (
    <span className="w-4 h-4 flex items-center justify-center text-[10px] select-none shrink-0 font-bold border border-gray-500/20 bg-gray-500/5 rounded">
      📄
    </span>
  );
}

function RenderTreeNode({
  node,
  level,
  selectedPath,
  onSelect,
  searchQuery,
}: {
  node: TreeNode;
  level: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  searchQuery: string;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const isFolderOpen = isOpen || searchQuery.trim() !== '';

  const active = node.path === selectedPath;

  if (node.type === 'folder') {
    return (
      <div className="select-none">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center gap-1.5 py-1 px-1.5 text-xs font-semibold text-gray-600 hover:bg-slate-100/60 rounded-md text-left select-none cursor-pointer transition-all duration-150"
        >
          <svg
            className={`w-3 h-3 text-gray-450 transition-transform shrink-0 ${isFolderOpen ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="3"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
          <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
          </svg>
          <span className="truncate text-gray-700">{node.name}</span>
        </button>
        {isFolderOpen && (
          <div className="space-y-0.5 mt-0.5 ml-[11px] pl-3.5 border-l border-slate-200/80">
            {node.children.map((child) => (
              <RenderTreeNode
                key={child.path}
                node={child}
                level={level + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                searchQuery={searchQuery}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      className={`w-full flex items-center gap-2 py-1.5 px-1.5 text-xs font-mono rounded-md truncate transition-all cursor-pointer border border-transparent ${
        active
          ? 'bg-indigo-50/75 text-indigo-700 font-bold border-l-indigo-500'
          : 'text-gray-650 hover:bg-slate-150 hover:text-gray-900'
      }`}
    >
      <span className="w-3 shrink-0" />
      {getFileIcon(node.path)}
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export function FileViewer({ files, isGenerating, promptText }: FileViewerProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editorTheme, setEditorTheme] = useState<'dark' | 'light'>('dark');
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  const fileTree = useMemo(() => {
    return buildFileTree(filteredFiles);
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
      const sanitized = promptText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      if (sanitized) filename = `stackforge-${sanitized.slice(0, 50)}`;
    }
    a.download = `${filename}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [files, promptText]);

  if (files.length === 0) return null;

  return (
    <>
      {isFullscreen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[80]" onClick={() => setIsFullscreen(false)} />
      )}
      <div className={`flex flex-col md:flex-row w-full flex-1 min-h-0 border border-gray-200 shadow-sm rounded-xl overflow-hidden bg-white select-none transition-all duration-300 ${isFullscreen ? 'fixed inset-10 z-[90] shadow-2xl border border-indigo-300' : ''}`}>
      <aside className="w-full md:w-60 md:shrink-0 border-b md:border-b-0 md:border-r border-gray-200 bg-[#f8fafc] flex flex-col justify-between max-h-[260px] md:max-h-none overflow-hidden select-none">
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="p-3 border-b border-gray-200/80 bg-[#f8fafc]">
            <div className="relative">
              <input
                type="text"
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white border border-gray-200 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-700 focus:outline-none transition-all placeholder-gray-400 shadow-sm"
              />
              <svg className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1 bg-[#f8fafc] min-h-0">
            <div className="px-2 pb-2 text-[10px] font-bold text-gray-400 select-none tracking-wider flex items-center gap-1.5 uppercase">
              <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
              ROOT
            </div>
            <div className="space-y-0.5">
              {fileTree.map((node) => (
                <RenderTreeNode
                  key={node.path}
                  node={node}
                  level={0}
                  selectedPath={activePath}
                  onSelect={setSelectedPath}
                  searchQuery={searchQuery}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="p-3 border-t border-gray-200/80 bg-[#f8fafc] shrink-0">
          <button
            onClick={downloadAll}
            className="w-full text-xs font-bold py-2 bg-white hover:bg-slate-50 text-gray-600 border border-gray-200 rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
          >
            📥 Download Workspace
          </button>
        </div>
      </aside>
      <div className={`flex-1 min-w-0 flex flex-col overflow-hidden relative transition-colors duration-200 ${editorTheme === 'dark' ? 'bg-slate-950 text-gray-100' : 'bg-slate-50 text-gray-800'}`}>
        <div className={`flex items-center justify-between shrink-0 select-none border-b transition-colors duration-200 ${editorTheme === 'dark' ? 'bg-gray-900 border-gray-800/80' : 'bg-slate-100 border-gray-200'}`}>
          <div className="flex overflow-x-auto no-scrollbar flex-1">
            {files.map((f) => {
              const name = f.path.split('/').pop() || f.path;
              const active = f.path === selected?.path;
              return (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => setSelectedPath(f.path)}
                  className={`flex items-center gap-2.5 px-4 py-3 text-[11px] font-mono border-r transition-all shrink-0 cursor-pointer select-none ${editorTheme === 'dark' ? 'border-gray-850' : 'border-gray-200'} ${
                    active 
                      ? (editorTheme === 'dark' ? 'bg-slate-950 text-white font-bold border-t-2 border-t-indigo-500' : 'bg-white text-indigo-700 font-bold border-t-2 border-t-indigo-500') 
                      : (editorTheme === 'dark' ? 'text-gray-400 hover:bg-slate-900 hover:text-gray-200' : 'text-gray-500 hover:bg-slate-200 hover:text-gray-850')
                  }`}
                >
                  {getFileIcon(f.path)}
                  <span>{name}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 px-4 text-gray-400 shrink-0">
            <button
              type="button"
              onClick={() => setEditorTheme(editorTheme === 'dark' ? 'light' : 'dark')}
              className={`hover:text-white cursor-pointer transition-colors p-1 rounded text-xs`}
              title="Toggle theme"
            >
              {editorTheme === 'dark' ? '☀️ Light' : '🌙 Dark'}
            </button>
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className={`hover:text-white cursor-pointer transition-colors text-xs p-1 rounded`}
              title={isFullscreen ? "Collapse panel" : "Expand panel"}
            >
              {isFullscreen ? '⛶ Collapse' : '⛶ Fullscreen'}
            </button>
          </div>
        </div>
        <div className={`flex-1 overflow-auto min-w-0 code-highlight relative transition-colors duration-200 ${editorTheme === 'dark' ? 'bg-slate-950' : 'bg-white'}`}>
          {selected && (
            <CodeBlock code={selected.content} language={selected.language} />
          )}
        </div>
        <div className={`h-7 border-t text-[10px] px-3.5 flex items-center justify-between shrink-0 select-none font-mono transition-colors duration-200 ${editorTheme === 'dark' ? 'border-gray-800 bg-gray-900 text-gray-400' : 'border-gray-200 bg-slate-100 text-gray-500'}`}>
          <div className="flex items-center gap-3.5">
            <span>Ln 1, Col 1</span>
            <span>Spaces: 2</span>
            <span>UTF-8</span>
            <span>LF</span>
            <span className="capitalize">{selected?.language || 'plain'}</span>
          </div>
          <div className="flex items-center gap-3.5">
            <span className="flex items-center gap-1.5 text-green-500 font-sans">
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
              className="hover:text-white transition-colors cursor-pointer text-xs"
              title="Copy current file content"
            >
              📋
            </button>
          </div>
        </div>
      </div>
    </div>
  </>
  );
}
