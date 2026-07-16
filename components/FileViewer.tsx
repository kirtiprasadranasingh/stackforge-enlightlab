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

function fileTypeLabel(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const name = path.split('/').pop()?.toLowerCase();
  if (name === 'dockerfile') return 'Docker';
  if (ext === 'ts') return 'TS';
  if (ext === 'tsx') return 'TSX';
  if (ext === 'js') return 'JS';
  if (ext === 'tf' || ext === 'hcl') return 'HCL';
  if (ext === 'yml' || ext === 'yaml') return 'YAML';
  if (ext === 'md') return 'MD';
  if (ext === 'json') return 'JSON';
  return (ext || 'file').toUpperCase();
}

function FileGlyph({ path, dimmed }: { path: string; dimmed?: boolean }) {
  const ext = path.split('.').pop()?.toLowerCase();
  const name = path.split('/').pop()?.toLowerCase();
  let color = 'bg-[#519aba]';
  if (name === 'dockerfile') color = 'bg-[#0db7ed]';
  else if (ext === 'tf' || ext === 'hcl') color = 'bg-[#844fbb]';
  else if (ext === 'yml' || ext === 'yaml') color = 'bg-[#cb171e]';
  else if (ext === 'md') color = 'bg-[#519aba]';
  else if (ext === 'json') color = 'bg-[#cbcb41]';
  else if (ext === 'ts' || ext === 'tsx' || ext === 'js') color = 'bg-[#519aba]';

  return (
    <span
      className={`w-4 h-4 rounded-[2px] shrink-0 ${color} ${dimmed ? 'opacity-70' : ''}`}
      aria-hidden
    />
  );
}

function RenderTreeNode({
  node,
  selectedPath,
  onSelect,
  searchQuery,
}: {
  node: TreeNode;
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
          className="w-full flex items-center gap-1 py-[3px] pr-2 pl-1 text-[13px] text-[#cccccc] hover:bg-[#2a2d2e] rounded-sm text-left cursor-pointer"
        >
          <svg
            className={`w-3 h-3 text-[#858585] transition-transform shrink-0 ${isFolderOpen ? 'rotate-90' : ''}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M6 4l8 6-8 6V4z" />
          </svg>
          <svg className="w-4 h-4 text-[#dcb67a] shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
          <span className="truncate">{node.name}</span>
        </button>
        {isFolderOpen && (
          <div className="ml-3">
            {node.children.map((child) => (
              <RenderTreeNode
                key={child.path}
                node={child}
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
      className={`w-full flex items-center gap-1.5 py-[3px] pr-2 pl-5 text-[13px] rounded-sm truncate cursor-pointer ${
        active
          ? 'bg-[#37373d] text-white'
          : 'text-[#cccccc] hover:bg-[#2a2d2e]'
      }`}
    >
      <FileGlyph path={node.path} dimmed={!active} />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

function Breadcrumb({ path }: { path: string }) {
  const parts = path.split('/');
  return (
    <div className="flex items-center gap-1 text-[12px] text-[#cccccc] min-w-0 overflow-hidden">
      {parts.map((part, idx) => {
        const isLast = idx === parts.length - 1;
        return (
          <span key={`${part}-${idx}`} className="flex items-center gap-1 min-w-0">
            {idx > 0 && <span className="text-[#858585] shrink-0">›</span>}
            <span
              className={`truncate ${isLast ? 'text-white' : 'text-[#cccccc]'}`}
              title={part}
            >
              {isLast ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[#3794ff] px-1 py-0.5 bg-[#3794ff]/10 rounded">
                    {fileTypeLabel(path)}
                  </span>
                  {part}
                </span>
              ) : (
                part
              )}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function FileViewer({ files, isGenerating, promptText }: FileViewerProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editorTheme, setEditorTheme] = useState<'dark' | 'light'>('dark');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const activePath =
    selectedPath && files.some((f) => f.path === selectedPath)
      ? selectedPath
      : files[0]?.path || null;

  const selected = useMemo(
    () => files.find((f) => f.path === activePath) || files[0],
    [files, activePath]
  );

  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;
    return files.filter((f) =>
      f.path.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [files, searchQuery]);

  const fileTree = useMemo(() => buildFileTree(filteredFiles), [filteredFiles]);

  const lineCount = selected?.content.split('\n').length ?? 0;

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
      if (sanitized) filename = `stackforge-${sanitized.slice(0, 50)}`;
    }
    a.download = `${filename}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [files, promptText]);

  if (files.length === 0) return null;

  const isDark = editorTheme === 'dark';

  return (
    <>
      {isFullscreen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[80]"
          onClick={() => setIsFullscreen(false)}
        />
      )}
      <div
        className={`vscode-shell flex flex-col md:flex-row w-full flex-1 min-h-0 border overflow-hidden select-none transition-all duration-200 ${
          isFullscreen
            ? 'fixed inset-6 z-[90] shadow-2xl border-[#3c3c3c] rounded-lg'
            : 'border-[#3c3c3c] rounded-lg shadow-lg'
        } ${isDark ? 'bg-[#1e1e1e]' : 'bg-[#f3f3f3]'}`}
      >
        {/* Activity bar */}
        <div
          className={`hidden md:flex w-12 shrink-0 flex-col items-center py-3 gap-3 border-r ${
            isDark ? 'bg-[#333333] border-[#252526]' : 'bg-[#ececec] border-[#d4d4d4]'
          } ${isFullscreen ? '' : ''}`}
        >
          <div
            className={`w-8 h-8 rounded flex items-center justify-center ${
              isDark ? 'bg-[#252526] text-[#75beff]' : 'bg-white text-[#007acc]'
            }`}
            title="Explorer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M3 12h18M3 17h18" />
            </svg>
          </div>
        </div>

        {/* Sidebar explorer */}
        <aside
          className={`w-full md:w-56 md:shrink-0 flex flex-col max-h-[220px] md:max-h-none overflow-hidden border-b md:border-b-0 md:border-r ${
            isDark ? 'bg-[#252526] border-[#3c3c3c]' : 'bg-[#f3f3f3] border-[#d4d4d4]'
          }`}
        >
          <div
            className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wider ${
              isDark ? 'text-[#bbbbbb]' : 'text-[#616161]'
            }`}
          >
            Explorer
          </div>
          <div className="px-2 pb-2">
            <input
              type="text"
              placeholder="Search files"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full rounded border px-2 py-1 text-[12px] focus:outline-none focus:ring-1 ${
                isDark
                  ? 'bg-[#3c3c3c] border-[#3c3c3c] text-[#cccccc] placeholder-[#858585] focus:ring-[#007acc]'
                  : 'bg-white border-[#d4d4d4] text-[#333] placeholder-[#999] focus:ring-[#007acc]'
              }`}
            />
          </div>
          <div className="flex-1 overflow-y-auto px-1 pb-2 min-h-0">
            <div
              className={`px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${
                isDark ? 'text-[#bbbbbb]' : 'text-[#616161]'
              }`}
            >
              STACKFORGE
            </div>
            <div className="space-y-0.5">
              {fileTree.map((node) => (
                <RenderTreeNode
                  key={node.path}
                  node={node}
                  selectedPath={activePath}
                  onSelect={setSelectedPath}
                  searchQuery={searchQuery}
                />
              ))}
            </div>
          </div>
        </aside>

        {/* Editor pane */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div
            className={`flex items-center shrink-0 border-b overflow-hidden ${
              isDark ? 'bg-[#2d2d2d] border-[#252526]' : 'bg-[#ececec] border-[#d4d4d4]'
            }`}
          >
            <div className="flex overflow-x-auto no-scrollbar flex-1 min-w-0">
              {files.map((f) => {
                const name = f.path.split('/').pop() || f.path;
                const active = f.path === selected?.path;
                return (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => setSelectedPath(f.path)}
                    className={`flex items-center gap-2 px-3 py-2 text-[12px] border-r shrink-0 cursor-pointer min-w-0 max-w-[180px] ${
                      isDark ? 'border-[#252526]' : 'border-[#d4d4d4]'
                    } ${
                      active
                        ? isDark
                          ? 'bg-[#1e1e1e] text-white'
                          : 'bg-white text-[#333]'
                        : isDark
                          ? 'bg-[#2d2d2d] text-[#969696] hover:bg-[#1e1e1e] hover:text-[#cccccc]'
                          : 'bg-[#ececec] text-[#616161] hover:bg-[#f3f3f3]'
                    }`}
                  >
                    <FileGlyph path={f.path} />
                    <span className="truncate">{name}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1 px-2 shrink-0">
              <button
                type="button"
                onClick={() => setEditorTheme(isDark ? 'light' : 'dark')}
                className={`p-1.5 rounded text-[11px] cursor-pointer ${
                  isDark
                    ? 'text-[#cccccc] hover:bg-[#3c3c3c]'
                    : 'text-[#616161] hover:bg-[#d4d4d4]'
                }`}
                title="Toggle theme"
              >
                {isDark ? 'Light' : 'Dark'}
              </button>
              <button
                type="button"
                onClick={() => setIsFullscreen(!isFullscreen)}
                className={`p-1.5 rounded text-[11px] cursor-pointer ${
                  isDark
                    ? 'text-[#cccccc] hover:bg-[#3c3c3c]'
                    : 'text-[#616161] hover:bg-[#d4d4d4]'
                }`}
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? 'Exit' : 'Full'}
              </button>
            </div>
          </div>

          {/* Breadcrumb */}
          {selected && (
            <div
              className={`px-3 py-1.5 border-b shrink-0 ${
                isDark ? 'bg-[#1e1e1e] border-[#252526]' : 'bg-white border-[#d4d4d4]'
              }`}
            >
              <Breadcrumb path={selected.path} />
            </div>
          )}

          {/* Code area */}
          <div
            className={`flex-1 overflow-auto min-w-0 relative ${
              isDark ? 'bg-[#1e1e1e]' : 'bg-white'
            }`}
          >
            {selected && (
              <CodeBlock
                code={selected.content}
                language={selected.language}
                theme={editorTheme}
              />
            )}
            {isGenerating && (
              <div className="absolute bottom-3 right-3 text-[11px] px-2 py-1 rounded bg-[#007acc] text-white shadow">
                Generating…
              </div>
            )}
          </div>

          {/* Status bar */}
          <div
            className={`h-[22px] text-[12px] px-3 flex items-center justify-between shrink-0 ${
              isDark ? 'bg-[#007acc] text-white' : 'bg-[#007acc] text-white'
            }`}
          >
            <div className="flex items-center gap-3">
              <span>{selected?.path || ''}</span>
              <span>Ln {lineCount}, Col 1</span>
              <span>UTF-8</span>
              <span className="capitalize">{selected?.language || 'plain'}</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void downloadAll()}
                className="hover:underline cursor-pointer"
              >
                ZIP
              </button>
              <button
                type="button"
                onClick={() => selected && void copyToClipboard(selected.content)}
                className="hover:underline cursor-pointer"
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
