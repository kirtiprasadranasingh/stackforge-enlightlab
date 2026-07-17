import type { GeneratedFile } from '@/types';
import { PATH_ALIASES } from '@/lib/scaffold-spec';
import { getLanguageFromPath, validateFilePath } from '@/lib/utils';

/** Map alternate model paths → canonical PRD paths */
const CANONICAL_PATH: Record<string, string> = {};
for (const [canonical, alts] of Object.entries(PATH_ALIASES)) {
  for (const alt of alts) {
    CANONICAL_PATH[alt] = canonical;
  }
  CANONICAL_PATH[canonical] = canonical;
}

const RENAME_MAP: Record<string, string> = {
  'terraform/keyvault.tf': 'terraform/key_vault.tf',
  'terraform/key-vault.tf': 'terraform/key_vault.tf',
  'go-backend/Dockerfile': 'Dockerfile',
  'go-backend/main.go': 'main.go',
  'go-backend/go.mod': 'go.mod',
  'go-backend/go.sum': 'go.sum',
  'app/Dockerfile': 'Dockerfile',
  'app/main.go': 'main.go',
  'app/go.mod': 'go.mod',
  'app/go.sum': 'go.sum',
  'readme.md': 'README.md',
};

function canonicalPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').trim();
  return RENAME_MAP[normalized] || CANONICAL_PATH[normalized] || normalized;
}

/** Fix Dockerfile COPY paths when moving go-backend/ → root */
function patchDockerfileForRoot(content: string): string {
  return content
    .replace(/COPY\s+go-backend\//g, 'COPY ')
    .replace(/WORKDIR\s+\/app\/go-backend/g, 'WORKDIR /app');
}

/** Fix pipeline build context when app was nested */
function patchPipelineForRoot(content: string): string {
  return content
    .replace(/go-backend\/Dockerfile/g, 'Dockerfile')
    .replace(/go-backend\//g, '');
}

export function normalizeScaffoldFile(file: GeneratedFile): GeneratedFile | null {
  let path = canonicalPath(file.path);
  if (!validateFilePath(path)) return null;

  let content = file.content;
  if (path === 'Dockerfile') {
    content = patchDockerfileForRoot(content);
  }
  if (path === 'azure-pipelines.yml') {
    content = patchPipelineForRoot(content);
  }

  const language =
    !file.language ||
    file.language === 'plaintext' ||
    file.language === 'text' ||
    file.language === 'plain'
      ? getLanguageFromPath(path)
      : file.language;

  return { ...file, path, language, content };
}

/** Merge duplicates — later canonical path wins */
export function normalizeScaffoldFiles(files: GeneratedFile[]): GeneratedFile[] {
  const byPath = new Map<string, GeneratedFile>();
  for (const raw of files) {
    const normalized = normalizeScaffoldFile(raw);
    if (!normalized) continue;
    byPath.set(normalized.path, normalized);
  }
  return Array.from(byPath.values());
}
