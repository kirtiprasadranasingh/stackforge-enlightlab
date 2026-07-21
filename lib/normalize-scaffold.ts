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
function patchWorkflowDispatchInputs(content: string): string {
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

/** Drop `with:` blocks that sit under a `run:` step (invalid YAML / actionlint). */
function stripOrphanWithBlocks(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const withMatch = /^([ \t]*)with:\s*$/.exec(line);
    if (withMatch) {
      const ind = withMatch[1];
      let sawUses = false;
      let sawRun = false;
      for (let j = out.length - 1; j >= 0; j--) {
        const prev = out[j];
        if (!prev.trim()) continue;
        const pInd = /^([ \t]*)/.exec(prev)?.[1] ?? '';
        if (/^[ \t]*-\s/.test(prev) && pInd.length < ind.length) break;
        const rest = prev.slice(pInd.length);
        if (pInd === ind && /^uses:\s/.test(rest)) {
          sawUses = true;
          break;
        }
        if (pInd === ind && /^run:\s/.test(rest)) {
          sawRun = true;
          break;
        }
      }
      if (sawRun && !sawUses) {
        i += 1;
        while (i < lines.length) {
          const next = lines[i];
          if (!next.trim()) {
            i += 1;
            continue;
          }
          const nInd = /^([ \t]*)/.exec(next)?.[1] ?? '';
          if (nInd.length <= ind.length) break;
          i += 1;
        }
        continue;
      }
    }
    out.push(line);
    i += 1;
  }
  return out.join('\n');
}

/**
 * Promote orphaned job-level `if: failure()` + second `steps:` (common after deploy)
 * into a real `scaffold_rollback` job so YAML/actionlint can parse.
 */
function promoteOrphanRollbackSteps(content: string): string {
  return content.replace(
    /\n([ \t]{4})(?:#.*\r?\n\1)*(?:#.*[Rr]ollback.*\r?\n\1)?if:\s*(failure\(\)[^\n]*)\r?\n\1steps:\r?\n/g,
    (_m, _ind: string, cond: string) =>
      `\n  scaffold_rollback:\n    if: ${cond}\n    runs-on: ubuntu-latest\n    steps:\n`
  );
}

/** Ensure any step that writes image_uri= to GITHUB_OUTPUT has id: set-image-uri. */
function ensureStepIdForImageUriWriter(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (/^\s*-\s+name:/.test(lines[i])) {
      const stepLines: string[] = [lines[i]];
      let j = i + 1;
      let writesImageUri = false;
      let hasId = false;
      while (j < lines.length) {
        const l = lines[j];
        if (j > i + 1 && /^\s*-\s+name:/.test(l)) break;
        if (/^\s*id:\s/.test(l)) hasId = true;
        if (
          /echo\s+["']?image_uri=/.test(l) ||
          (/image_uri=/.test(l) && />>\s*\$GITHUB_OUTPUT/.test(l))
        ) {
          writesImageUri = true;
        }
        stepLines.push(l);
        j++;
      }
      if (writesImageUri && !hasId) {
        const indent = (lines[i].match(/^(\s*)/)?.[1] ?? '') + '  ';
        out.push(lines[i]);
        out.push(`${indent}id: set-image-uri`);
        for (let k = 1; k < stepLines.length; k++) out.push(stepLines[k]);
      } else {
        out.push(...stepLines);
      }
      i = j;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join('\n');
}

/** Ensure image_uri job outputs are produced by a real GITHUB_OUTPUT step. */
function patchImageUriOutput(content: string): string {
  let out = ensureStepIdForImageUriWriter(content);

  const hasWriter =
    /^\s*id:\s*set-image-uri\s*$/m.test(out) &&
    (/echo\s+["']?image_uri=/.test(out) || /image_uri=\$\{\{/.test(out));

  if (!hasWriter && /outputs\.image_uri|image_uri:\s*\$\{\{/.test(out) && /id:\s*login-ecr/.test(out)) {
    const insert = [
      '      - name: Set image URI output',
      '        id: set-image-uri',
      '        run: |',
      '          IMAGE_URI="${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_REPOSITORY_NAME || env.ECR_REPOSITORY }}:${{ github.sha }}"',
      '          echo "image_uri=$IMAGE_URI" >> $GITHUB_OUTPUT',
      '',
    ].join('\n');

    const marker = /id:\s*(build-and-push|build_and_push|login-ecr)\s*\r?\n/;
    const m = marker.exec(out);
    if (m) {
      const start = m.index + m[0].length;
      const lines = out.slice(start).split('\n');
      let consumed = 0;
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        if (li > 0 && /^\s{0,6}-\s/.test(line) && line.trim()) break;
        consumed += line.length + 1;
      }
      const at = start + consumed;
      out = out.slice(0, at) + insert + out.slice(at);
    }
  }

  if (/^\s*id:\s*set-image-uri\s*$/m.test(out)) {
    out = out.replace(
      /image_uri:\s*\$\{\{\s*steps\.(?:build-and-push|build_and_push)\.outputs\.image_uri\s*\}\}/g,
      'image_uri: ${{ steps.set-image-uri.outputs.image_uri }}'
    );
    if (/echo\s+["']?image_uri=/.test(out)) {
      out = out.replace(
        /image_uri:\s*\$\{\{\s*steps\.(?!set-image-uri)[A-Za-z0-9_-]+\.outputs\.image_uri\s*\}\}/g,
        'image_uri: ${{ steps.set-image-uri.outputs.image_uri }}'
      );
    }
  }

  return out;
}

/** Terraform ${var.xxx} must not appear in GitHub Actions — map to env or github context. */
function stripTerraformLeaksFromWorkflow(content: string): string {
  const varToEnv = (name: string) =>
    name
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/-/g, '_')
      .toUpperCase();

  return content
    .replace(/\$\{var\.([a-zA-Z0-9_-]+)\}/g, (_, name) => `\${{ env.${varToEnv(name)} }}`)
    .replace(/\$\{terraform\.[^}]+\}/g, '${{ env.TF_OUTPUT_PLACEHOLDER }}');
}

/** Fix actionlint errors from outputs referenced but never declared on the job. */
function patchWorkflowJobOutputRefs(content: string): string {
  let out = content;

  out = out.replace(
    /needs\.setup_env\.outputs\.project_name(?:\s*\|\|\s*['"][^'"]*['"])?/g,
    'github.event.repository.name'
  );

  const priorRef = out.match(/needs\.([a-zA-Z0-9_-]+)\.outputs\.prior_task_def_arn/);
  if (priorRef) {
    const jobName = priorRef[1];
    const jobHeader = new RegExp(
      `(  ${jobName}:\\n(?:    [^\\n]+\\n)*?)(    steps:)`,
      'm'
    );
    if (!new RegExp(`  ${jobName}:[\\s\\S]*?prior_task_def_arn:`).test(out)) {
      const stepId =
        out.match(/id:\s*(get-current-service|capture-prior[^\n]*)/)?.[1] ||
        'get-current-service';
      out = out.replace(
        jobHeader,
        `$1    outputs:\n      prior_task_def_arn: \${{ steps.${stepId}.outputs.current_task_definition_arn }}\n$2`
      );
    }
  }

  return out;
}

/** After `aws ecs update-service`, wait for stability (blocking check in validate-scaffold). */
function patchEcsServicesStable(content: string): string {
  if (!/aws\s+ecs\s+update-service/.test(content)) return content;
  if (/services-stable|service-stable|deployments-stable/.test(content)) {
    return content;
  }
  return content.replace(
    /(aws\s+ecs\s+update-service\b[\s\S]*?--force-new-deployment[^\n]*)(\r?\n)/,
    `$1$2
          echo "Waiting for ECS service to stabilize..."
          aws ecs wait services-stable \\
            --cluster \${{ env.ECS_CLUSTER_NAME }} \\
            --services \${{ env.ECS_SERVICE_NAME }}
`
  );
}

function patchGithubWorkflow(content: string): string {
  let out = patchWorkflowDispatchInputs(content);
  out = promoteOrphanRollbackSteps(out);
  out = stripOrphanWithBlocks(out);
  out = stripTerraformLeaksFromWorkflow(out);
  out = patchWorkflowJobOutputRefs(out);
  out = patchImageUriOutput(out);
  out = patchEcsServicesStable(out);
  return out;
}

/** Standard Helm helper defines for a chart name prefix (e.g. app, nodeapp). */
function standardHelmHelpers(prefix: string): string {
  return `{{/*
Expand the name of the chart.
*/}}
{{- define "${prefix}.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "${prefix}.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as part of the label.
*/}}
{{- define "${prefix}.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "${prefix}.labels" -}}
helm.sh/chart: {{ include "${prefix}.chart" . }}
{{ include "${prefix}.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "${prefix}.selectorLabels" -}}
app.kubernetes.io/name: {{ include "${prefix}.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "${prefix}.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "${prefix}.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
`;
}

/**
 * Ensure every include "PREFIX.*" used in chart templates has matching define
 * blocks in _helpers.tpl (fixes "no template app.fullname associated with gotpl").
 */
function ensureHelmHelpers(
  byPath: Map<string, GeneratedFile>
): void {
  const chartDirs = new Set<string>();
  for (const p of byPath.keys()) {
    const m = /^charts\/([^/]+)\//.exec(p);
    if (m) chartDirs.add(m[1]);
  }

  for (const chart of chartDirs) {
    const prefix = `charts/${chart}/templates/`;
    const templateFiles = [...byPath.entries()].filter(
      ([p]) => p.startsWith(prefix) && (p.endsWith('.yaml') || p.endsWith('.yml') || p.endsWith('.tpl'))
    );
    if (templateFiles.length === 0) continue;

    const includes = new Set<string>();
    for (const [, file] of templateFiles) {
      const re = /include\s+"([A-Za-z0-9_-]+)\.[^"]+"/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(file.content)) !== null) {
        includes.add(match[1]);
      }
    }

    const chartYaml = byPath.get(`charts/${chart}/Chart.yaml`);
    const chartName =
      chartYaml?.content.match(/^\s*name:\s*["']?([A-Za-z0-9_-]+)/m)?.[1] ??
      chart;

    if (includes.size === 0) {
      // Templates may hardcode names; still ensure helpers for Chart.yaml name
      includes.add(chartName);
      includes.add('app');
    }

    const helpersPath = `charts/${chart}/templates/_helpers.tpl`;
    let helpers = byPath.get(helpersPath)?.content ?? '';

    for (const name of includes) {
      if (new RegExp(`define\\s+"${name}\\.fullname"`).test(helpers)) continue;
      helpers = `${helpers.trimEnd()}\n\n${standardHelmHelpers(name)}`.trimStart();
    }

    // Prefer defining helpers for chart name even if unused (lint nicety)
    if (!new RegExp(`define\\s+"${chartName}\\.fullname"`).test(helpers)) {
      helpers = `${helpers.trimEnd()}\n\n${standardHelmHelpers(chartName)}`.trimStart();
    }

    byPath.set(helpersPath, {
      path: helpersPath,
      language: 'plaintext',
      content: helpers.endsWith('\n') ? helpers : `${helpers}\n`,
      description: byPath.get(helpersPath)?.description,
    });
  }
}

const PROVIDER_PINS: Array<{
  detect: RegExp;
  name: string;
  source: string;
  version: string;
}> = [
  {
    detect: /\b(resource|data|provider)\s+"aws[_"]/,
    name: 'aws',
    source: 'hashicorp/aws',
    version: '~> 5.84',
  },
  {
    detect: /\b(resource|data|provider)\s+"google[_"]/,
    name: 'google',
    source: 'hashicorp/google',
    version: '~> 5.0',
  },
  {
    detect: /\b(resource|data|provider)\s+"azurerm[_"]/,
    name: 'azurerm',
    source: 'hashicorp/azurerm',
    version: '~> 4.0',
  },
  {
    detect: /\b(resource|data|provider)\s+"kubernetes[_"]/,
    name: 'kubernetes',
    source: 'hashicorp/kubernetes',
    version: '~> 2.23',
  },
  {
    detect: /\b(resource|data|provider)\s+"helm[_"]/,
    name: 'helm',
    source: 'hashicorp/helm',
    version: '~> 2.17',
  },
  {
    detect: /\b(resource|data|provider)\s+"local[_"]/,
    name: 'local',
    source: 'hashicorp/local',
    version: '~> 2.5',
  },
  {
    detect: /\b(resource|data|provider)\s+"tls[_"]/,
    name: 'tls',
    source: 'hashicorp/tls',
    version: '~> 4.0',
  },
  {
    detect: /\b(resource|data|provider)\s+"random[_"]/,
    name: 'random',
    source: 'hashicorp/random',
    version: '~> 3.6',
  },
];

/**
 * Pin required_providers so init does not pull latest aws v6 / helm v3 (slow + breaking).
 */
function ensureRequiredProviders(
  byPath: Map<string, GeneratedFile>
): void {
  const tfEntries = [...byPath.entries()].filter(([p]) => p.endsWith('.tf'));
  if (tfEntries.length === 0) return;

  const all = tfEntries.map(([, f]) => f.content).join('\n');
  const needed = PROVIDER_PINS.filter((p) => p.detect.test(all));
  if (needed.length === 0) return;

  const declared = new Set<string>();
  for (const [, f] of tfEntries) {
    const re = /^\s*([A-Za-z0-9_-]+)\s*=\s*\{\s*[\s\S]*?source\s*=/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.content)) !== null) {
      // Only count inside required_providers-ish contexts — heuristic: name matches known providers
      if (PROVIDER_PINS.some((p) => p.name === m![1])) declared.add(m[1]);
    }
  }

  const missing = needed.filter((p) => !declared.has(p.name));
  if (missing.length === 0) return;

  const block = missing
    .map(
      (p) =>
        `    ${p.name} = {\n      source  = "${p.source}"\n      version = "${p.version}"\n    }`
    )
    .join('\n');

  const versionsPath =
    [...byPath.keys()].find((p) => p === 'terraform/versions.tf') ||
    [...byPath.keys()].find((p) => p.endsWith('/versions.tf')) ||
    'terraform/versions.tf';

  const existing = byPath.get(versionsPath);
  if (!existing) {
    byPath.set(versionsPath, {
      path: versionsPath,
      language: 'hcl',
      content: `terraform {\n  required_version = ">= 1.5.0"\n  required_providers {\n${block}\n  }\n}\n`,
    });
    return;
  }

  let content = existing.content;
  if (/required_providers\s*\{/.test(content)) {
    content = content.replace(
      /required_providers\s*\{/,
      `required_providers {\n${block}`
    );
  } else if (/terraform\s*\{/.test(content)) {
    content = content.replace(
      /terraform\s*\{/,
      `terraform {\n  required_providers {\n${block}\n  }`
    );
  } else {
    content = `terraform {\n  required_providers {\n${block}\n  }\n}\n\n${content}`;
  }

  byPath.set(versionsPath, { ...existing, content });
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

  // 10. ECS tasks must not ingress-reference Redis SG (causes validate cycle with redis→ecs).
  out = patchSecurityGroupCycles(out);

  return out;
}

/** Hadolint: COPY must have source and destination (e.g. `COPY . .` not bare `COPY .`). */
function patchDockerfileCopy(content: string): string {
  let out = content;
  out = out.replace(/^(\s*)COPY\s*$/gm, '$1COPY package*.json ./');
  // COPY [--flags...] <single-src>  → add destination
  out = out.replace(
    /^(\s*)COPY((?:\s+--[^\s=]+(?:=[^\s]+)?)*)\s+(\S+)\s*$/gm,
    (_m, ind: string, flags: string, src: string) => {
      if (src === '.') return `${ind}COPY${flags} . .`;
      return `${ind}COPY${flags} ${src} .`;
    }
  );
  return out;
}

/**
 * Break aws_security_group cycles (ecs_tasks ↔ redis/mongodb/rds) that block terraform validate.
 * ECS task SGs receive from ALB only — data-store SGs accept from ECS, never the reverse.
 */
function patchSecurityGroupCycles(content: string): string {
  let out = content;
  for (const block of findTerraformResourceBlocks(out)) {
    if (block.type !== 'aws_security_group') continue;
    const body = out.slice(block.start, block.end);
    const isEcsLike =
      /ecs|task|fargate/i.test(block.name) && !/alb|lb|balancer|load/i.test(block.name);
    if (!isEcsLike) continue;
    // Remove ingress that references any SG except ALB/LB
    const cleaned = body.replace(
      /\r?\n[ \t]*ingress\s*\{[^{}]*security_groups\s*=\s*\[[^\]]*aws_security_group\.(?![a-zA-Z0-9_]*(?:alb|lb|balancer|load))[^\]]*\][^{}]*\}/gi,
      ''
    );
    if (cleaned !== body) {
      out = out.slice(0, block.start) + cleaned + out.slice(block.end);
    }
  }
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
    content = patchDockerfileCopy(content);
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
  ensureHelmHelpers(byPath);
  ensureRequiredProviders(byPath);
  ensureEcsScaffoldCompleteness(byPath);

  return dedupeTerraformResources(Array.from(byPath.values()));
}

/** ECS Fargate: curl in TF healthCheck needs curl in image; accept app/Dockerfile layout. */
function ensureEcsScaffoldCompleteness(byPath: Map<string, GeneratedFile>): void {
  const tfBlob = [...byPath.entries()]
    .filter(([p]) => p.endsWith('.tf'))
    .map(([, f]) => f.content)
    .join('\n');
  if (!/aws_ecs_service|aws_ecs_task_definition/.test(tfBlob)) return;

  const usesCurlHealth = /healthCheck[\s\S]*?curl|curl\s+-f/i.test(tfBlob);

  const dockerPaths = ['Dockerfile', 'app/Dockerfile'].filter((p) => byPath.has(p));
  for (const dp of dockerPaths) {
    const file = byPath.get(dp)!;
    let content = patchDockerfileCopy(file.content);
    if (
      usesCurlHealth &&
      !/apk add[^;\n]*curl|apt-get install[^;\n]*curl|yum install[^;\n]*curl|microdnf install[^;\n]*curl/i.test(
        content
      )
    ) {
      if (/FROM\s+[^\n]*alpine/i.test(content)) {
        content = content.replace(
          /(RUN\s+apk add[^\n]*)/i,
          '$1 curl'
        );
        if (!/apk add[^;\n]*curl/i.test(content)) {
          content = content.replace(
            /(FROM\s+[^\n]+\n)/i,
            '$1RUN apk add --no-cache curl\n'
          );
        }
      } else if (/FROM\s+[^\n]*(debian|ubuntu)/i.test(content)) {
        content = content.replace(
          /(FROM\s+[^\n]+\n)/i,
          '$1RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*\n'
        );
      }
    }
    byPath.set(dp, { ...file, content });
  }

  if (!byPath.has('README.md')) {
    byPath.set('README.md', {
      path: 'README.md',
      language: 'markdown',
      content:
        '# AWS ECS Fargate Scaffold\n\nReviewable starting scaffold for Terraform + GitHub Actions + Express health stub. Not drop-in production — validate and customize before provisioning.\n',
    });
  }
}
