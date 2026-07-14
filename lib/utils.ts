/**
 * Utility functions for StackForge
 */

/**
 * Sanitize user input to prevent prompt injection
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/```system/gi, '```text')
    .replace(/```SYSTEM/gi, '```TEXT')
    .replace(/<system>/gi, '<text>')
    .replace(/<\/system>/gi, '</text>')
    .trim();
}

/**
 * Validate file path for security
 */
export function validateFilePath(path: string): boolean {
  // No path traversal, no absolute paths, no backslashes
  const normalized = path.replace(/\\/g, '/');
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (path.includes('..') || path.includes('~')) return false;
  if (normalized.length > 512) return false;
  // Only allow alphanumeric, slashes, dots, hyphens, underscores
  return /^[a-zA-Z0-9/_.\-]+$/.test(normalized);
}

/**
 * Validate file size (max 120KB per file — output cap)
 */
export function validateFileSize(content: string): boolean {
  const maxSize = 120 * 1024;
  return content.length <= maxSize;
}

/**
 * Validate total output size (max 1.5MB — cost/abuse cap)
 */
export function validateOutputSize(files: { content: string }[]): boolean {
  const maxTotal = 1.5 * 1024 * 1024;
  const total = files.reduce((sum, f) => sum + f.content.length, 0);
  return total <= maxTotal;
}

/**
 * Get language from file extension
 */
export function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    tf: 'hcl',
    'tfvars': 'hcl',
    yaml: 'yaml',
    yml: 'yaml',
    json: 'json',
    md: 'markdown',
    sh: 'bash',
    py: 'python',
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    toml: 'toml',
    dockerfile: 'dockerfile',
    go: 'go',
  };
  return map[ext || ''] || 'plaintext';
}

/**
 * Delay for streaming simulation
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
