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

/**
 * Deterministically repair recurring Terraform mistakes that hard-block
 * `terraform validate`, so we don't depend on the model getting them right.
 * Each rule is scoped tightly to avoid touching otherwise-valid config.
 */
function patchTerraform(content: string): string {
  let out = content;

  // 1. depends_on cannot contain indexed/expression references. Strip
  //    [each.key] / [each.value] / [count.index] used inside a depends_on list.
  //    The array matcher tolerates one level of nested [...] index brackets.
  out = out.replace(
    /depends_on\s*=\s*\[(?:[^[\]]|\[[^\]]*\])*\]/g,
    (block) =>
      block.replace(/\[\s*(?:each\.key|each\.value|count\.index)\s*\]/g, '')
  );

  // 2. google_secret_manager_secret: the google provider v5 line removed the
  //    boolean `automatic = true` in favor of an `auto {}` block.
  out = out.replace(
    /replication\s*\{\s*automatic\s*=\s*true\s*\}/g,
    'replication {\n    auto {}\n  }'
  );

  // 3. google_cloud_run_service (v1) exposes status[0].url, not .uri (.uri is a
  //    v2-only attribute). Rewrite v1 references; the pattern never matches
  //    google_cloud_run_v2_service.
  out = out.replace(
    /(google_cloud_run_service\.[A-Za-z0-9_]+(?:\[[^\]]*\])?)\.uri\b/g,
    '$1.status[0].url'
  );

  // 4. GKE Workload Identity: the google provider v5 renamed the
  //    workload_identity_config argument `identity_namespace` to `workload_pool`.
  //    It is a google-only attribute, so a bare rename is safe.
  out = out.replace(/\bidentity_namespace(\s*=)/g, 'workload_pool$1');

  // 5. GKE Autopilot clusters reject node-count fields. Within any
  //    google_container_cluster block that enables Autopilot, drop
  //    initial_node_count (the common `terraform plan` blocker). The block
  //    matcher stops at the first column-0 `}`, i.e. the resource's own close.
  out = out.replace(
    /resource\s+"google_container_cluster"\s+"[^"]+"\s*\{[\s\S]*?\n\}/g,
    (block) =>
      /enable_autopilot\s*=\s*true/.test(block)
        ? block.replace(/^[ \t]*initial_node_count\s*=.*\r?\n/gm, '')
        : block
  );

  return out;
}

/**
 * If a non-root USER is declared before dependencies are installed, pip/npm
 * cannot write to system locations and the image build fails. Relocate a single
 * premature USER instruction to just before the app runs (CMD/ENTRYPOINT), so
 * installs run as root while the runtime stays non-root.
 */
function patchDockerfileUser(content: string): string {
  const lines = content.split('\n');
  const userIdx = lines.findIndex((l) => /^\s*USER\s+\S+/i.test(l));
  if (userIdx === -1) return content;

  const installIdx = lines.findIndex((l) =>
    /^\s*RUN\b.*\b(pip\s+install|apt-get\s+install|apk\s+add|npm\s+(ci|install)|yarn\s+(add|install)|pnpm\s+(add|install)|gem\s+install|go\s+(build|install)|mvn\b|gradle\b)/i.test(
      l
    )
  );
  // Only intervene in the failure mode: USER declared before an install step.
  if (installIdx === -1 || userIdx > installIdx) return content;

  const userLine = lines[userIdx].trim();
  const remaining = lines.filter((_, i) => i !== userIdx);
  const cmdIdx = remaining.findIndex((l) => /^\s*(CMD|ENTRYPOINT)\b/i.test(l));
  if (cmdIdx === -1) {
    remaining.push(userLine);
  } else {
    remaining.splice(cmdIdx, 0, userLine);
  }
  return remaining.join('\n');
}

export function normalizeScaffoldFile(file: GeneratedFile): GeneratedFile | null {
  let path = canonicalPath(file.path);
  if (!validateFilePath(path)) return null;

  let content = file.content;
  if (path === 'Dockerfile') {
    content = patchDockerfileForRoot(content);
    content = patchDockerfileUser(content);
  }
  if (path === 'azure-pipelines.yml') {
    content = patchPipelineForRoot(content);
  }
  if (path.endsWith('.tf')) {
    content = patchTerraform(content);
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
