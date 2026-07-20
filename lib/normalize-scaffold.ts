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
  // Do NOT map app/Dockerfile → Dockerfile: EKS/Node layouts keep the app/ tree.
  // Only flatten go-backend/ (handled above). If the model emits a lone
  // app/Dockerfile with no app sources, normalizeScaffoldFiles may promote it.
  'readme.md': 'README.md',
};

function canonicalPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').trim();
  if (RENAME_MAP[normalized]) return RENAME_MAP[normalized];
  // Keep app/* paths in place so Node/EKS scaffolds are not flattened to root.
  // PATH_ALIASES still treats Dockerfile ↔ app/Dockerfile as satisfying slots.
  if (normalized.startsWith('app/')) return normalized;
  return CANONICAL_PATH[normalized] || normalized;
}

/** Fix Dockerfile COPY paths when sources moved from a nested folder to root */
function patchDockerfileForRoot(content: string, stripAppPrefix: boolean): string {
  let out = content
    .replace(/COPY\s+go-backend\//g, 'COPY ')
    .replace(/WORKDIR\s+\/app\/go-backend/g, 'WORKDIR /app');
  if (stripAppPrefix) {
    out = out.replace(/COPY\s+app\//g, 'COPY ');
  }
  return out;
}

/** Fix pipeline build context when Dockerfile lives at repo root */
function patchPipelineForRoot(content: string): string {
  return content
    .replace(/go-backend\/Dockerfile/g, 'Dockerfile')
    .replace(/go-backend\//g, '');
}

/** Align CI docker build paths with where Dockerfile actually lives */
function patchPipelineDockerContext(
  content: string,
  layout: 'root' | 'app'
): string {
  let out = patchPipelineForRoot(content);
  if (layout === 'app') {
    // Prefer building from app/ when that is where the Dockerfile + sources live
    out = out.replace(
      /docker\s+build(\s+[^\n]*?)\s+\.(?:\s|$)/gi,
      'docker build$1 ./app '
    );
    out = out.replace(
      /docker\s+build(?![^\n]*-f\s+)/gi,
      (m) => m // leave alone if no -f; context rewrite above handles `.`
    );
    // If CI still points at root Dockerfile but we only have app/Dockerfile
    out = out.replace(/-f\s+Dockerfile\b/g, '-f app/Dockerfile');
    out = out.replace(
      /context:\s*['"]?\.(?:\/)?['"]?/gi,
      "context: 'app'"
    );
  } else {
    out = out
      .replace(
        /docker\s+build(\s+[^\n]*?)(?:\s+-f\s+app\/Dockerfile)?\s+(?:\.\/)?app\b/gi,
        'docker build$1 .'
      )
      .replace(/-f\s+app\/Dockerfile/g, '-f Dockerfile')
      .replace(/context:\s*['"]?app['"]?/gi, "context: '.'");
  }
  return out;
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

  // 6. Cloud SQL MySQL-only flag accidentally set on PostgreSQL instances.
  out = out.replace(
    /resource\s+"google_sql_database_instance"\s+"[^"]+"\s*\{[\s\S]*?\n\}/g,
    (block) =>
      /database_version\s*=\s*"POSTGRES/i.test(block)
        ? block.replace(/^[ \t]*binary_log_enabled\s*=.*\r?\n/gm, '')
        : block
  );

  // 7. VPC Access connector: prefer subnet OR ip_cidr_range, not both.
  out = out.replace(
    /resource\s+"google_vpc_access_connector"\s+"[^"]+"\s*\{[\s\S]*?\n\}/g,
    (block) => {
      if (!/\bsubnet\s*\{/.test(block) || !/\bip_cidr_range\s*=/.test(block)) {
        return block;
      }
      return block.replace(/^[ \t]*ip_cidr_range\s*=.*\r?\n/gm, '');
    }
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
  if (path === 'Dockerfile' || /(^|\/)Dockerfile$/.test(path)) {
    // Per-file pass: only strip go-backend; app/ COPY handled after we know layout
    content = patchDockerfileForRoot(content, false);
    if (path !== 'Dockerfile') {
      // Nested Dockerfile: build context is usually that folder — drop COPY app/
      content = content.replace(/COPY\s+app\//g, 'COPY ');
    }
    content = patchDockerfileUser(content);
  }
  if (
    path === 'azure-pipelines.yml' ||
    path === '.gitlab-ci.yml' ||
    path.startsWith('.github/workflows/')
  ) {
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

  const hasRootDocker = byPath.has('Dockerfile');
  const appDocker = byPath.get('app/Dockerfile');
  const appSources = [...byPath.keys()].filter(
    (p) => p.startsWith('app/') && p !== 'app/Dockerfile'
  );

  // Promote lone app/Dockerfile → Dockerfile only when there are no other app/*
  // sources (Go-at-root style). Keep app/Dockerfile for Node/EKS layouts.
  if (!hasRootDocker && appDocker && appSources.length === 0) {
    byPath.delete('app/Dockerfile');
    byPath.set('Dockerfile', {
      ...appDocker,
      path: 'Dockerfile',
      content: patchDockerfileUser(
        patchDockerfileForRoot(appDocker.content, true)
      ),
    });
  }

  // Root Dockerfile with no app/ tree: strip erroneous COPY app/
  const rootDocker = byPath.get('Dockerfile');
  if (rootDocker && appSources.length === 0 && !byPath.has('app/Dockerfile')) {
    byPath.set('Dockerfile', {
      ...rootDocker,
      content: patchDockerfileForRoot(rootDocker.content, true),
    });
  }

  const layout: 'root' | 'app' =
    byPath.has('app/Dockerfile') && !byPath.has('Dockerfile') ? 'app' : 'root';

  for (const [path, file] of [...byPath.entries()]) {
    if (
      path === 'azure-pipelines.yml' ||
      path === '.gitlab-ci.yml' ||
      path.startsWith('.github/workflows/')
    ) {
      byPath.set(path, {
        ...file,
        content: patchPipelineDockerContext(file.content, layout),
      });
    }
  }

  return Array.from(byPath.values());
}
