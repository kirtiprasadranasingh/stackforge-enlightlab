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
 * Validate file path for security + reject Terraform attribute refs mistaken as paths
 * (e.g. aws_iam_role.alb_controller_role.arn).
 */
export function validateFilePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').trim();
  if (!normalized || normalized.startsWith('/') || path.startsWith('\\')) return false;
  if (normalized.includes('..') || normalized.includes('~')) return false;
  if (normalized.length > 512) return false;
  if (!/^[a-zA-Z0-9/_.\-]+$/.test(normalized)) return false;

  const base = normalized.split('/').pop() || '';
  const specialNames = new Set([
    'dockerfile',
    'jenkinsfile',
    'makefile',
    'go.mod',
    'go.sum',
    'readme.md',
    'azure-pipelines.yml',
    '.gitignore',
    '.dockerignore',
    'chart.yaml',
    'chart.yml',
    'values.yaml',
    'values.yml',
  ]);
  if (specialNames.has(base.toLowerCase())) return true;

  // Must look like a real source/config file — not a TF resource attribute (.arn, .id, .name)
  const allowedExt =
    /\.(tf|tfvars|hcl|yml|yaml|md|go|json|sh|toml|ts|tsx|js|jsx|py|txt|env|tpl|gotmpl)$/i;
  if (!allowedExt.test(base)) return false;

  // Reject resource.attr patterns like aws_iam_role.foo.arn
  if (/^[a-z0-9_]+\.[a-z0-9_]+\.(arn|id|name|arn_suffix)$/i.test(base)) return false;

  return true;
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
  const name = path.split('/').pop()?.toLowerCase() || '';
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return 'dockerfile';
  if (name === 'go.mod' || name === 'go.sum') return 'go';
  if (name === 'jenkinsfile') return 'groovy';

  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : '';
  const map: Record<string, string> = {
    tf: 'hcl',
    tfvars: 'hcl',
    hcl: 'hcl',
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
    go: 'go',
    dockerfile: 'dockerfile',
  };
  return map[ext || ''] || 'plaintext';
}

/**
 * Delay for streaming simulation
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
