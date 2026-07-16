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
  const isWorkflow = path.includes('.github/workflows');
  const opacityClass = dimmed ? 'opacity-60' : 'opacity-100';

  if (name === 'dockerfile' || name === '.dockerignore') {
    return (
      <svg className={`w-4 h-4 shrink-0 text-[#0db7ed] ${opacityClass}`} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M13.983 11.078h2.119c.102 0 .186-.084.186-.186V8.774c0-.102-.084-.186-.186-.186h-2.119c-.102 0-.186.084-.186.186v2.118c0 .102.084.186.186.186zm-2.95.078h2.118c.102 0 .186-.084.186-.186V8.852c0-.102-.084-.186-.186-.186h-2.118c-.102 0-.186.084-.186.186v2.118c0 .102.084.186.186.186zm0-2.951h2.118c.102 0 .186-.084.186-.186V5.901c0-.102-.084-.186-.186-.186h-2.118c-.102 0-.186.084-.186.186v2.118c0 .102.084.186.186.186zm-2.95 2.951h2.119c.102 0 .186-.084.186-.186V8.852c0-.102-.084-.186-.186-.186H8.083c-.102 0-.186.084-.186.186v2.118c0 .102.084.186.186.186zm0-2.951h2.119c.102 0 .186-.084.186-.186V5.901c0-.102-.084-.186-.186-.186H8.083c-.102 0-.186.084-.186.186v2.118c0 .102.084.186.186.186zm-2.95 2.951h2.118c.102 0 .186-.084.186-.186V8.852c0-.102-.084-.186-.186-.186H5.133c-.102 0-.186.084-.186.186v2.118c0 .102.084.186.186.186zm0-2.951h2.118c.102 0 .186-.084.186-.186V5.901c0-.102-.084-.186-.186-.186H5.133c-.102 0-.186.084-.186.186v2.118c0 .102.084.186.186.186zm-2.95 2.951h2.119c.102 0 .186-.084.186-.186V8.852c0-.102-.084-.186-.186-.186H2.183c-.102 0-.186.084-.186.186v2.118c0 .102.084.186.186.186zM2.183 5.05h2.119c.102 0 .186-.084.186-.186V2.746c0-.102-.084-.186-.186-.186H2.183c-.102 0-.186.084-.186.186v2.118c0 .102.084.186.186.186zM23.99 11.57c-.086-.053-.923-.53-2.63-.53-.941 0-1.804.152-2.518.356-.376-.906-1.127-1.637-2.122-2.072v-.001c-.139-.06-.296-.06-.436 0-1.011.442-1.762 1.177-2.129 2.086-1.077-.421-2.484-.668-3.921-.668-.117 0-.233.003-.35.008V11.2c0 .102.084.186.186.186h1.861c1.378 0 2.766.19 3.992.548.874.254 1.547.886 1.83 1.764.282.879.08 1.834-.543 2.534-.637.717-1.574 1.128-2.551 1.128-1.53 0-2.842-.992-3.238-2.449-.028-.1-.122-.169-.226-.169H7.95c-.105 0-.199.069-.227.169-.396 1.458-1.708 2.45-3.238 2.45-.977 0-1.913-.411-2.551-1.128-.623-.7-.825-1.655-.543-2.534.283-.878.956-1.51 1.83-1.764 1.226-.358 2.614-.548 3.992-.548h.186c.102 0 .186-.084.186-.186V9.011c0-.102-.084-.186-.186-.186h-.558c-.971 0-1.919.117-2.819.336-.08.02-.162-.02-.196-.095-.561-1.23-1.79-1.996-3.149-1.996-.118 0-.236.006-.353.018-.088.009-.165-.049-.181-.137-.202-1.104-.84-2.002-1.777-2.502-.084-.045-.117-.15-.077-.234.39-.824 1.17-1.353 2.059-1.353.111 0 .221.008.331.024.088.013.167-.043.185-.13 1.018-4.996 5.864-8.156 10.828-7.058C17.382-3.197 22.062 1.34 23.36 6.9c.148.634.218 1.285.207 1.936-.002.088.064.161.152.169 1.121.107 2.046.797 2.464 1.832.034.084-.002.18-.083.213-.679.28-1.22.776-1.516 1.411-.038.083.003.178.088.212z" />
      </svg>
    );
  }

  if (ext === 'tf' || ext === 'hcl' || ext === 'tfvars') {
    return (
      <svg className={`w-4 h-4 shrink-0 text-[#844fbb] ${opacityClass}`} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M1.35 0h8.1v8.1h-8.1zm13.2 0h8.1v8.1h-8.1zM8.1 8.1h8.1v8.1H8.1zm-6.75 8.1h8.1v8.1h-8.1z" />
      </svg>
    );
  }

  if (isWorkflow) {
    return (
      <svg className={`w-4 h-4 shrink-0 text-[#24292e] dark:text-[#f0f6fc] ${opacityClass}`} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
      </svg>
    );
  }

  if (ext === 'yml' || ext === 'yaml') {
    return (
      <svg className={`w-4 h-4 shrink-0 text-[#cb171e] ${opacityClass}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }

  if (ext === 'json') {
    return (
      <svg className={`w-4 h-4 shrink-0 text-[#cbcb41] ${opacityClass}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    );
  }

  if (ext === 'md') {
    return (
      <svg className={`w-4 h-4 shrink-0 text-[#519aba] ${opacityClass}`} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22.27 19H1.73A1.74 1.74 0 0 1 0 17.27V6.73A1.74 1.74 0 0 1 1.73 5h20.54A1.73 1.73 0 0 1 24 6.73v10.54A1.73 1.73 0 0 1 22.27 19zM2 8.5v7h2v-4l1.5 2 1.5-2v4h2v-7h-2l-1.5 2-1.5-2H2zm13 0v3h-2v1h2v3h2v-3h2v-1h-2v-3h-2z" />
      </svg>
    );
  }

  if (ext === 'tsx' || ext === 'ts' || ext === 'js' || ext === 'jsx') {
    return (
      <svg className={`w-4 h-4 shrink-0 text-[#61dafb] ${opacityClass}`} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 8.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zM24 12c0 2.518-2.617 4.793-6.9 6.07a33.3 33.3 0 0 1-5.1.58c-.14.004-.28.006-.42.006a33.3 33.3 0 0 1-5.1-.58C2.2 16.793 0 14.518 0 12c0-2.518 2.617-4.793 6.9-6.07a33.3 33.3 0 0 1 5.1-.58c.14-.004.28-.006.42-.006a33.3 33.3 0 0 1 5.1.58c4.283 1.277 6.9 3.552 6.9 6.07zm-1.536 0c0-1.802-2.273-3.791-6.195-5.013A31.815 31.815 0 0 0 12 6.5c-1.468 0-2.903.076-4.269.219C3.81 7.94 1.536 9.93 1.536 12s2.273 3.791 6.195 5.013c1.366.143 2.801.219 4.269.219 1.468 0 2.903-.076 4.269-.219 3.922-1.222 6.195-3.211 6.195-5.013z" />
      </svg>
    );
  }

  if (ext === 'py') {
    return (
      <svg className={`w-4 h-4 shrink-0 text-[#3776ab] ${opacityClass}`} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.25.18c.9 0 2 .75 2 2v2H12v1.2H20a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1.5v-2a2.5 2.5 0 0 0-2.5-2.5H7.5A2.5 2.5 0 0 0 5 11.3v5.2H3.75a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2H8.5V4.6c0-.9.75-2 2-2zm-4.5 13a2.5 2.5 0 0 0-2.5 2.5v5.2c0 .9.75 2 2 2h4.5c.9 0 2-.75 2-2v-2H7.5V17.6h8a2 2 0 0 0 2-2v-6H14.25v2.2a2.5 2.5 0 0 0-2.5 2.5zm1.5-9.5c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1zm-4 13.5c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1z" />
      </svg>
    );
  }

  if (ext === 'go') {
    return (
      <svg className={`w-4 h-4 shrink-0 text-[#00a2d6] ${opacityClass}`} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M1.35 14.85c0-4.05 3.15-7.2 7.2-7.2s7.2 3.15 7.2 7.2-3.15 7.2-7.2 7.2-7.2-3.15-7.2-7.2zm9.9 0c0-1.8-.9-3.15-2.7-3.15s-2.7 1.35-2.7 3.15.9 3.15 2.7 3.15 2.7-1.35 2.7-3.15zM21.15 13.5c-.45-.45-.9-.45-1.35 0L17.1 16.2v-7.2h-1.8v11.7h1.8v-3.6l3.15 3.6c.45.45.9.45 1.35 0s.45-.9 0-1.35l-2.7-3.15 2.7-3.15c.45-.45.45-.9 0-1.35z" />
      </svg>
    );
  }

  return (
    <span className={`w-4 h-4 rounded-[2px] shrink-0 bg-slate-400 ${opacityClass}`} aria-hidden="true" />
  );
}

function RenderTreeNode({
  node,
  selectedPath,
  onSelect,
  searchQuery,
  isDark,
}: {
  node: TreeNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  searchQuery: string;
  isDark: boolean;
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
          className={`w-full flex items-center gap-1 py-[3px] pr-2 pl-1 text-[13px] rounded-sm text-left cursor-pointer ${
            isDark
              ? 'text-[#cccccc] hover:bg-[#2a2d2e]'
              : 'text-[#333333] hover:bg-[#e8e8e8]'
          }`}
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
                isDark={isDark}
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
          : isDark
            ? 'text-[#cccccc] hover:bg-[#2a2d2e]'
            : 'text-[#333333] hover:bg-[#e8e8e8]'
      }`}
    >
      <FileGlyph path={node.path} dimmed={!active} />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

function Breadcrumb({ path, isDark }: { path: string; isDark: boolean }) {
  const parts = path.split('/');
  return (
    <div className={`flex items-center gap-1 text-[12px] min-w-0 overflow-hidden ${
      isDark ? 'text-[#cccccc]' : 'text-[#333333]'
    }`}>
      {parts.map((part, idx) => {
        const isLast = idx === parts.length - 1;
        return (
          <span key={`${part}-${idx}`} className="flex items-center gap-1 min-w-0">
            {idx > 0 && <span className={`shrink-0 ${isDark ? 'text-[#858585]' : 'text-[#888888]'}`}>›</span>}
            <span
              className={`truncate ${isLast ? (isDark ? 'text-white' : 'text-black font-bold') : (isDark ? 'text-[#cccccc]' : 'text-[#555555]')}`}
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
                  isDark={isDark}
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
            </div>
          </div>

          {/* Breadcrumb */}
          {selected && (
            <div
              className={`px-3 py-1.5 border-b shrink-0 ${
                isDark ? 'bg-[#1e1e1e] border-[#252526]' : 'bg-white border-[#d4d4d4]'
              }`}
            >
              <Breadcrumb path={selected.path} isDark={isDark} />
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
