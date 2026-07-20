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

/** Fix common invalid workflow_dispatch input shapes that break actionlint/YAML. */
function patchGithubWorkflow(content: string): string {
  // Bad:
  //   gcp_project_id: 'GCP Project ID'
  //     required: true
  // Good:
  //   gcp_project_id:
  //     description: 'GCP Project ID'
  //     required: true
  return content.replace(
    /^([ \t]*)([A-Za-z_][\w]*)\s*:\s*(['"])([^'"]*)\3\s*\r?\n(\1[ \t]+)required:\s*(true|false)/gm,
    (
      _full,
      ind: string,
      key: string,
      quote: string,
      desc: string,
      _reqInd: string,
      reqVal: string
    ) =>
      `${ind}${key}:\n${ind}  description: ${quote}${desc}${quote}\n${ind}  required: ${reqVal}`
  );
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

  // 8. Cloud SQL maintenance_window only accepts day / hour / update_track.
  //    Models invent update_period and day_of_week (invalid).
  out = out.replace(/maintenance_window\s*\{[\s\S]*?\}/g, (block) =>
    block
      .replace(/^[ \t]*update_period\s*=.*\r?\n/gm, '')
      .replace(/\bday_of_week(\s*=)/g, 'day$1')
  );

  // 9. kubernetes_service_account: correct attribute name (provider schema).
  out = out.replace(
    /\bautomount_token(\s*=)/g,
    'automount_service_account_token$1'
  );

  return out;
}

type TfResourceBlock = {
  type: string;
  name: string;
  start: number;
  end: number;
};

/** Parse top-level `resource "type" "name" { ... }` blocks (brace-balanced). */
function findTerraformResourceBlocks(content: string): TfResourceBlock[] {
  const blocks: TfResourceBlock[] = [];
  const re = /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < content.length && depth > 0) {
      const ch = content[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      i += 1;
    }
    // Swallow a single trailing newline so removals don't leave blank gaps messy
    if (content[i] === '\r') i += 1;
    if (content[i] === '\n') i += 1;
    blocks.push({
      type: match[1],
      name: match[2],
      start: match.index,
      end: i,
    });
  }
  return blocks;
}

/**
 * Prefer a single owner file when the model emits the same resource twice
 * (common GCP bug: cloud_sql.tf + database.tf / network.tf).
 * Higher score wins and keeps the block; losers are stripped.
 */
function terraformResourceOwnerScore(path: string, type: string): number {
  const base = path.split('/').pop() || path;
  const isSql =
    type === 'google_sql_database_instance' ||
    type === 'google_sql_database' ||
    type === 'google_sql_user';
  const isPrivateNet =
    type === 'google_compute_global_address' ||
    type === 'google_service_networking_connection';

  if (isSql) {
    if (base === 'database.tf') return 100;
    if (base === 'sql.tf' || base === 'db.tf') return 90;
    if (base === 'cloud_sql.tf') return 40;
    return 20;
  }
  if (isPrivateNet) {
    if (base === 'network.tf' || base === 'networking.tf' || base === 'vpc.tf') {
      return 100;
    }
    if (base === 'cloud_sql.tf') return 40;
    return 20;
  }
  if (base === 'main.tf') return 30;
  if (base === 'cloud_sql.tf') return 25;
  return 20;
}

/**
 * Drop duplicate Terraform resource declarations across files so
 * `terraform init` / `validate` can succeed after generation.
 */
function dedupeTerraformResources(files: GeneratedFile[]): GeneratedFile[] {
  const tfFiles = files.filter((f) => f.path.endsWith('.tf'));
  if (tfFiles.length < 2) return files;

  type Occ = {
    path: string;
    type: string;
    name: string;
    score: number;
    order: number;
  };
  const occurrences: Occ[] = [];
  let order = 0;
  for (const file of tfFiles) {
    for (const block of findTerraformResourceBlocks(file.content)) {
      occurrences.push({
        path: file.path,
        type: block.type,
        name: block.name,
        score: terraformResourceOwnerScore(file.path, block.type),
        order: order++,
      });
    }
  }

  const winners = new Map<string, Occ>();
  for (const occ of occurrences) {
    const key = `${occ.type}::${occ.name}`;
    const prev = winners.get(key);
    if (
      !prev ||
      occ.score > prev.score ||
      (occ.score === prev.score && occ.order < prev.order)
    ) {
      winners.set(key, occ);
    }
  }

  const hasDupes = occurrences.some((occ) => {
    const key = `${occ.type}::${occ.name}`;
    const win = winners.get(key);
    return !win || win.path !== occ.path || win.order !== occ.order;
  });
  if (!hasDupes) return files;

  return files.map((file) => {
    if (!file.path.endsWith('.tf')) return file;

    const blocks = findTerraformResourceBlocks(file.content);
    const remove: TfResourceBlock[] = [];
    const seenInFile = new Set<string>();
    for (const block of blocks) {
      const key = `${block.type}::${block.name}`;
      const win = winners.get(key);
      const firstInFile = !seenInFile.has(key);
      seenInFile.add(key);
      const keep = win?.path === file.path && firstInFile;
      if (!keep) remove.push(block);
    }

    if (remove.length === 0) return file;
    let content = file.content;
    for (const block of [...remove].sort((a, b) => b.start - a.start)) {
      content = content.slice(0, block.start) + content.slice(block.end);
    }
    content = content.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
    return { ...file, content };
  });
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

/** Minimal lockfile so validators/Docker COPY package*.json succeed when the model omits it. */
function buildMinimalPackageLock(packageJsonContent: string): string {
  let name = 'app';
  let version = '1.0.0';
  let dependencies: Record<string, string> = {};
  try {
    const parsed = JSON.parse(packageJsonContent) as {
      name?: string;
      version?: string;
      dependencies?: Record<string, string>;
    };
    if (parsed.name) name = parsed.name;
    if (parsed.version) version = parsed.version;
    if (parsed.dependencies) dependencies = parsed.dependencies;
  } catch {
    // keep defaults
  }
  return `${JSON.stringify(
    {
      name,
      version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name,
          version,
          dependencies,
        },
      },
    },
    null,
    2
  )}\n`;
}

/**
 * If package.json exists without a lockfile, add a minimal package-lock.json
 * and prefer `npm install` over `npm ci` in nearby Dockerfiles.
 */
function ensureNodeLockfiles(
  byPath: Map<string, GeneratedFile>
): void {
  const pkgPaths = ['app/package.json', 'package.json'].filter((p) =>
    byPath.has(p)
  );
  for (const pkgPath of pkgPaths) {
    const dir = pkgPath.includes('/')
      ? pkgPath.slice(0, pkgPath.lastIndexOf('/'))
      : '';
    const lockPath = dir ? `${dir}/package-lock.json` : 'package-lock.json';
    const yarnPath = dir ? `${dir}/yarn.lock` : 'yarn.lock';
    if (byPath.has(lockPath) || byPath.has(yarnPath)) continue;

    const pkg = byPath.get(pkgPath)!;
    byPath.set(lockPath, {
      path: lockPath,
      language: 'json',
      content: buildMinimalPackageLock(pkg.content),
      description: 'Minimal lockfile (auto-added for build consistency)',
    });

    for (const dockerPath of [
      dir ? `${dir}/Dockerfile` : 'Dockerfile',
      'Dockerfile',
      'app/Dockerfile',
    ]) {
      const docker = byPath.get(dockerPath);
      if (!docker) continue;
      if (!/\bnpm\s+ci\b/.test(docker.content)) continue;
      byPath.set(dockerPath, {
        ...docker,
        content: docker.content.replace(/\bnpm\s+ci\b/g, 'npm install'),
      });
    }
  }
}

export function normalizeScaffoldFile(
  file: Pick<GeneratedFile, 'path' | 'content'> & Partial<GeneratedFile>
): GeneratedFile | null {
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
    if (path.startsWith('.github/workflows/')) {
      content = patchGithubWorkflow(content);
    }
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
export function normalizeScaffoldFiles(
  files: Array<Pick<GeneratedFile, 'path' | 'content'> & Partial<GeneratedFile>>
): GeneratedFile[] {
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
      let content = patchPipelineDockerContext(file.content, layout);
      if (path.startsWith('.github/workflows/')) {
        content = patchGithubWorkflow(content);
      }
      byPath.set(path, { ...file, content });
    }
  }

  ensureNodeLockfiles(byPath);

  return dedupeTerraformResources(Array.from(byPath.values()));
}
