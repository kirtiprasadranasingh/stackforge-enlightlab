import type { GeneratedFile } from '@/types';
import { getLanguageFromPath, validateFilePath, validateFileSize } from '@/lib/utils';

/**
 * Incremental parser for StackForge streaming markers.
 */

const FILE_START =
  /<<<FILE\s+path="([^"]+)"\s+language="([^"]*)"(?:\s+description="([^"]*)")?\s*>>>/g;
const END_FILE = '<<<END_FILE>>>';
const DELETE_RE = /<<<DELETE\s+path="([^"]+)"\s*>>>/g;
const MARKER_RE = /<<<[A-Z_]+(?:\s+[^>]*)?>>>/g;

/**
 * Return a section only after a following marker proves that it is complete.
 * At end-of-stream, EOF is also a valid boundary. This prevents partial JSON
 * such as `["Which cloud` from being emitted while model text is streaming.
 */
function completedSection(
  buffer: string,
  marker: string,
  finalize: boolean
): string | undefined {
  const start = buffer.indexOf(marker);
  if (start === -1) return undefined;

  const contentStart = start + marker.length;
  MARKER_RE.lastIndex = contentStart;
  const nextMarker = MARKER_RE.exec(buffer);
  if (!nextMarker && !finalize) return undefined;

  return buffer.slice(contentStart, nextMarker?.index ?? buffer.length).trim();
}

export interface ParseState {
  buffer: string;
  emittedPaths: Set<string>;
}

export interface ParseResult {
  status?: string;
  files: GeneratedFile[];
  deletedPaths: string[];
  summary?: string;
  warnings?: string[];
  questions?: string[];
  plan?: string;
  doneMarkers: boolean;
}

export function createParseState(): ParseState {
  return { buffer: '', emittedPaths: new Set() };
}

export function appendAndParse(
  state: ParseState,
  chunk: string,
  finalize = false
): ParseResult {
  state.buffer += chunk;
  const files: GeneratedFile[] = [];
  const deletedPaths: string[] = [];
  let summary: string | undefined;
  let warnings: string[] | undefined;
  let questions: string[] | undefined;

  const status = completedSection(state.buffer, '<<<STATUS>>>', finalize);

  const rawQuestions = completedSection(
    state.buffer,
    '<<<QUESTIONS>>>',
    finalize
  );
  if (rawQuestions !== undefined) {
    const raw = rawQuestions.trim();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        questions = parsed
          .map((value) =>
            String(value)
              .replace(/^\s*\d+[.)]\s*/, '')
              .trim()
          )
          .filter(Boolean);
      }
    } catch {
      // The section is complete but the model ignored the JSON contract.
      // Accept a plain numbered/bulleted list without leaking JSON syntax.
      questions = raw
        .split('\n')
        .map((line) =>
          line
            .replace(/^\s*[\[,\]]+\s*$/, '')
            .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
            .replace(/^\s*["']|["'],?\s*$/g, '')
            .trim()
        )
        .filter((line) => line.endsWith('?'))
        .filter(Boolean);
    }
  }

  const plan = completedSection(state.buffer, '<<<PLAN>>>', finalize);

  // Deletes
  DELETE_RE.lastIndex = 0;
  let del: RegExpExecArray | null;
  const delRemove: Array<{ start: number; end: number }> = [];
  while ((del = DELETE_RE.exec(state.buffer)) !== null) {
    const path = del[1].trim();
    if (validateFilePath(path)) deletedPaths.push(path);
    delRemove.push({ start: del.index, end: del.index + del[0].length });
  }
  for (let i = delRemove.length - 1; i >= 0; i--) {
    const { start, end } = delRemove[i];
    state.buffer = state.buffer.slice(0, start) + state.buffer.slice(end);
  }

  // Extract complete FILE blocks
  FILE_START.lastIndex = 0;
  let match: RegExpExecArray | null;
  const toRemove: Array<{ start: number; end: number }> = [];

  while ((match = FILE_START.exec(state.buffer)) !== null) {
    const startIdx = match.index;
    const headerEnd = match.index + match[0].length;
    const endIdx = state.buffer.indexOf(END_FILE, headerEnd);
    if (endIdx === -1) break;

    const path = match[1].trim();
    const language = match[2].trim() || getLanguageFromPath(path);
    const description = match[3]?.trim();
    const content = state.buffer.slice(headerEnd, endIdx).replace(/^\r?\n/, '').replace(/\r?\n$/, '');

    if (
      validateFilePath(path) &&
      validateFileSize(content) &&
      !state.emittedPaths.has(path)
    ) {
      state.emittedPaths.add(path);
      files.push({ path, language, content, description });
    }

    toRemove.push({ start: startIdx, end: endIdx + END_FILE.length });
    FILE_START.lastIndex = endIdx + END_FILE.length;
  }

  for (let i = toRemove.length - 1; i >= 0; i--) {
    const { start, end } = toRemove[i];
    state.buffer = state.buffer.slice(0, start) + state.buffer.slice(end);
  }

  // Extract complete Markdown FILE blocks
  const mdRegexA = /#\s+([a-zA-Z0-9_\-\.\/]+)\r?\n```(\w*)\r?\n([\s\S]*?)\r?\n```/g;
  const mdRegexB = /```([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)\r?\n([\s\S]*?)\r?\n```/g;
  const mdRegexC = /```(\w+)\s+([a-zA-Z0-9_\-\.\/]+)\r?\n([\s\S]*?)\r?\n```/g;
  const mdRegexD = /```(\w+):([a-zA-Z0-9_\-\.\/]+)\r?\n([\s\S]*?)\r?\n```/g;

  const mdToRemove: Array<{ start: number; end: number }> = [];

  // Parse Format A (# path\n```language\ncontent\n```)
  let mdMatchA: RegExpExecArray | null;
  mdRegexA.lastIndex = 0;
  while ((mdMatchA = mdRegexA.exec(state.buffer)) !== null) {
    const startIdx = mdMatchA.index;
    const path = mdMatchA[1].trim();
    const language = mdMatchA[2].trim() || getLanguageFromPath(path);
    const content = mdMatchA[3];
    if (validateFilePath(path) && validateFileSize(content) && !state.emittedPaths.has(path)) {
      state.emittedPaths.add(path);
      files.push({ path, language, content });
    }
    mdToRemove.push({ start: startIdx, end: mdMatchA.index + mdMatchA[0].length });
  }

  // Clear format A
  for (let i = mdToRemove.length - 1; i >= 0; i--) {
    const { start, end } = mdToRemove[i];
    state.buffer = state.buffer.slice(0, start) + state.buffer.slice(end);
  }
  mdToRemove.length = 0;

  // Parse Format B (```path.ext\ncontent\n```)
  let mdMatchB: RegExpExecArray | null;
  mdRegexB.lastIndex = 0;
  while ((mdMatchB = mdRegexB.exec(state.buffer)) !== null) {
    const startIdx = mdMatchB.index;
    const path = mdMatchB[1].trim();
    const language = getLanguageFromPath(path);
    const content = mdMatchB[2];
    if (validateFilePath(path) && validateFileSize(content) && !state.emittedPaths.has(path)) {
      state.emittedPaths.add(path);
      files.push({ path, language, content });
    }
    mdToRemove.push({ start: startIdx, end: mdMatchB.index + mdMatchB[0].length });
  }

  // Clear format B
  for (let i = mdToRemove.length - 1; i >= 0; i--) {
    const { start, end } = mdToRemove[i];
    state.buffer = state.buffer.slice(0, start) + state.buffer.slice(end);
  }
  mdToRemove.length = 0;

  // Parse Format C (```language path\ncontent\n```)
  let mdMatchC: RegExpExecArray | null;
  mdRegexC.lastIndex = 0;
  while ((mdMatchC = mdRegexC.exec(state.buffer)) !== null) {
    const startIdx = mdMatchC.index;
    const path = mdMatchC[2].trim();
    const language = mdMatchC[1].trim();
    const content = mdMatchC[3];
    if (validateFilePath(path) && validateFileSize(content) && !state.emittedPaths.has(path)) {
      state.emittedPaths.add(path);
      files.push({ path, language, content });
    }
    mdToRemove.push({ start: startIdx, end: mdMatchC.index + mdMatchC[0].length });
  }

  // Clear format C
  for (let i = mdToRemove.length - 1; i >= 0; i--) {
    const { start, end } = mdToRemove[i];
    state.buffer = state.buffer.slice(0, start) + state.buffer.slice(end);
  }
  mdToRemove.length = 0;

  // Parse Format D (```language:path\ncontent\n```)
  let mdMatchD: RegExpExecArray | null;
  mdRegexD.lastIndex = 0;
  while ((mdMatchD = mdRegexD.exec(state.buffer)) !== null) {
    const startIdx = mdMatchD.index;
    const path = mdMatchD[2].trim();
    const language = mdMatchD[1].trim();
    const content = mdMatchD[3];
    if (validateFilePath(path) && validateFileSize(content) && !state.emittedPaths.has(path)) {
      state.emittedPaths.add(path);
      files.push({ path, language, content });
    }
    mdToRemove.push({ start: startIdx, end: mdMatchD.index + mdMatchD[0].length });
  }

  // Clear format D
  for (let i = mdToRemove.length - 1; i >= 0; i--) {
    const { start, end } = mdToRemove[i];
    state.buffer = state.buffer.slice(0, start) + state.buffer.slice(end);
  }
  mdToRemove.length = 0;

  // Parse Format E (```language\n# path\ncontent\n```)
  const mdRegexE = /```(\w+)\r?\n(?:\/\/#\s*|#\s*|\/\/\s*)([a-zA-Z0-9_\-\.\/]+)\r?\n([\s\S]*?)\r?\n```/g;
  let mdMatchE: RegExpExecArray | null;
  mdRegexE.lastIndex = 0;
  while ((mdMatchE = mdRegexE.exec(state.buffer)) !== null) {
    const startIdx = mdMatchE.index;
    const path = mdMatchE[2].trim();
    const language = mdMatchE[1].trim();
    const content = mdMatchE[3];
    if (validateFilePath(path) && validateFileSize(content) && !state.emittedPaths.has(path)) {
      state.emittedPaths.add(path);
      files.push({ path, language, content });
    }
    mdToRemove.push({ start: startIdx, end: mdMatchE.index + mdMatchE[0].length });
  }

  // Clear format E
  for (let i = mdToRemove.length - 1; i >= 0; i--) {
    const { start, end } = mdToRemove[i];
    state.buffer = state.buffer.slice(0, start) + state.buffer.slice(end);
  }
  mdToRemove.length = 0;

  // Parse Format F (```\n# path\ncontent\n```)
  const mdRegexF = /```\r?\n(?:\/\/#\s*|#\s*|\/\/\s*)([a-zA-Z0-9_\-\.\/]+)\r?\n([\s\S]*?)\r?\n```/g;
  let mdMatchF: RegExpExecArray | null;
  mdRegexF.lastIndex = 0;
  while ((mdMatchF = mdRegexF.exec(state.buffer)) !== null) {
    const startIdx = mdMatchF.index;
    const path = mdMatchF[1].trim();
    const language = getLanguageFromPath(path);
    const content = mdMatchF[2];
    if (validateFilePath(path) && validateFileSize(content) && !state.emittedPaths.has(path)) {
      state.emittedPaths.add(path);
      files.push({ path, language, content });
    }
    mdToRemove.push({ start: startIdx, end: mdMatchF.index + mdMatchF[0].length });
  }

  // Clear format F
  for (let i = mdToRemove.length - 1; i >= 0; i--) {
    const { start, end } = mdToRemove[i];
    state.buffer = state.buffer.slice(0, start) + state.buffer.slice(end);
  }
  mdToRemove.length = 0;

  const completedSummary = completedSection(
    state.buffer,
    '<<<SUMMARY>>>',
    finalize
  );
  if (completedSummary !== undefined) {
    summary = completedSummary;
  } else {
    if (!state.buffer.includes('<<<')) {
      const clean = state.buffer.replace(/```[a-zA-Z]*\r?\n[\s\S]*?\r?\n```/g, '').trim();
      if (clean) {
        summary = clean;
      }
    }
  }

  const completedWarnings = completedSection(
    state.buffer,
    '<<<WARNINGS>>>',
    finalize
  );
  if (completedWarnings !== undefined) {
    const raw = completedWarnings.trim();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        warnings = parsed.map(String);
      }
    } catch {
      warnings = raw
        .split('\n')
        .map((l) => l.replace(/^[-*]\s*/, '').replace(/^"|"$/g, '').trim())
        .filter(Boolean);
    }
  }

  const doneMarkers =
    state.buffer.includes('<<<SUMMARY>>>') && state.buffer.includes('<<<WARNINGS>>>');

  return { status, files, deletedPaths, summary, warnings, questions, plan, doneMarkers };
}

/**
 * Fallback: parse final ```json ... ``` blob if model ignored markers.
 */
export function parseJsonFallback(text: string): {
  files: GeneratedFile[];
  summary?: string;
  warnings?: string[];
} {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*"files"\s*:\s*\[[\s\S]*\}\s*)$/);
  if (!jsonMatch) return { files: [] };

  try {
    const parsed = JSON.parse(jsonMatch[1].trim());
    const files: GeneratedFile[] = [];
    if (Array.isArray(parsed.files)) {
      for (const file of parsed.files) {
        if (
          file?.path &&
          file?.content &&
          validateFilePath(file.path) &&
          validateFileSize(file.content)
        ) {
          files.push({
            path: file.path,
            language: file.language || getLanguageFromPath(file.path),
            content: file.content,
            description: file.description,
          });
        }
      }
    }
    return {
      files,
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : undefined,
    };
  } catch {
    return { files: [] };
  }
}

/**
 * Fallback: parse markdown fenced code blocks when headers are slightly malformed or have intervening text.
 */
export function parseMarkdownFallback(text: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const emittedPaths = new Set<string>();

  const blockRegex = /```(\w*)\r?\n([\s\S]*?)\r?\n```/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(text)) !== null) {
    const language = match[1].trim();
    const content = match[2];
    const blockIndex = match.index;

    // Scan backwards from blockIndex up to 300 characters to locate a filename
    const searchArea = text.slice(Math.max(0, blockIndex - 300), blockIndex);
    const lines = searchArea.split('\n').map((l) => l.trim()).reverse();
    let foundPath: string | null = null;

    for (const line of lines) {
      const cleanLine = line
        .replace(/^#+\s*/, '')
        .replace(/^\*\*|\*\*$/, '')
        .replace(/^`|`$/, '')
        .replace(/:$/, '')
        .trim();

      if (validateFilePath(cleanLine)) {
        if (cleanLine.includes('.') || cleanLine.toLowerCase() === 'dockerfile') {
          foundPath = cleanLine;
          break;
        }
      }
    }

    if (foundPath && !emittedPaths.has(foundPath)) {
      emittedPaths.add(foundPath);
      files.push({
        path: foundPath,
        language: language || getLanguageFromPath(foundPath),
        content,
      });
    }
  }

  return files;
}
