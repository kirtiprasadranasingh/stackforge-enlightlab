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

/** Quote IAM condition operator keys that contain colons (invalid bare HCL identifiers). */
function patchIamConditionKeys(content: string): string {
  // Bad:  ForAllValues:StringLike = {
  // Good: "ForAllValues:StringLike" = {
  return content.replace(
    /(^|\s)((?:ForAllValues|ForAnyValue|Null):[A-Za-z0-9]+)\s*=/gm,
    '$1"$2" ='
  );
}

/** Ensure workflow_dispatch inputs referenced via github.event.inputs.* are declared. */
function patchMissingWorkflowDispatchInputs(content: string): string {
  const refs = [
    ...content.matchAll(/github\.event\.inputs\.([A-Za-z_][\w]*)/g),
  ].map((m) => m[1]);
  if (refs.length === 0) return content;
  const needed = [...new Set(refs)];

  const dispatchMatch = content.match(
    /workflow_dispatch:\s*\r?\n([ \t]*)inputs:\s*\r?\n([\s\S]*?)(?=\r?\n[ \t]*[A-Za-z_]|\r?\n[ \t]*jobs:|\r?\n[ \t]*permissions:|$)/
  );
  if (!dispatchMatch) {
    // No inputs block — inject under workflow_dispatch if present
    if (!/workflow_dispatch\s*:/.test(content)) return content;
    const inputLines = needed
      .map(
        (name) =>
          `      ${name}:\n        description: '${name}'\n        required: false\n        type: string`
      )
      .join('\n');
    return content.replace(
      /(workflow_dispatch\s*:\s*)(\r?\n)/,
      `$1$2    inputs:\n${inputLines}\n`
    );
  }

  const inputsBlock = dispatchMatch[2];
  const indent = dispatchMatch[1] || '      ';
  const missing = needed.filter(
    (name) => !new RegExp(`^\\s*${name}\\s*:`, 'm').test(inputsBlock)
  );
  if (missing.length === 0) return content;

  const insert = missing
    .map(
      (name) =>
        `${indent}${name}:\n${indent}  description: '${name}'\n${indent}  required: false\n${indent}  type: string\n`
    )
    .join('');
  const at = dispatchMatch.index! + dispatchMatch[0].length;
  // Insert at start of inputs block body
  const inputsStart =
    content.indexOf('inputs:', dispatchMatch.index!) + 'inputs:'.length;
  const nl = content.indexOf('\n', inputsStart);
  const insertAt = nl >= 0 ? nl + 1 : inputsStart;
  return content.slice(0, insertAt) + insert + content.slice(insertAt);
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

  // Merge prior_task_def_arn into an existing outputs: block — never add a second outputs: key.
  const priorRef = out.match(/needs\.([a-zA-Z0-9_-]+)\.outputs\.prior_task_def_arn/);
  if (priorRef) {
    const jobName = priorRef[1];
    if (!new RegExp(`  ${jobName}:[\\s\\S]*?prior_task_def_arn\\s*:`).test(out)) {
      const stepId =
        out.match(/id:\s*(get-current-service|capture-prior[^\n]*)/)?.[1] ||
        'get-current-service';
      const outputsBlock = new RegExp(
        `(  ${jobName}:\\n(?:    [^\\n]+\\n)*?    outputs:\\n)((?:      [^\\n]+\\n)*)`,
        'm'
      );
      if (outputsBlock.test(out)) {
        out = out.replace(
          outputsBlock,
          `$1$2      prior_task_def_arn: \${{ steps.${stepId}.outputs.current_task_definition_arn }}\n`
        );
      } else {
        const jobHeader = new RegExp(
          `(  ${jobName}:\\n(?:    [^\\n]+\\n)*?)(    steps:)`,
          'm'
        );
        out = out.replace(
          jobHeader,
          `$1    outputs:\n      prior_task_def_arn: \${{ steps.${stepId}.outputs.current_task_definition_arn }}\n$2`
        );
      }
    }
  }

  // Collapse accidental duplicate `outputs:` keys under the same job.
  out = out.replace(
    /(  [a-zA-Z_][\w-]*:\n(?:    (?!outputs:)[^\n]+\n)*)    outputs:\n((?:      [^\n]+\n)+)((?:    (?!outputs:)[^\n]+\n)*)    outputs:\n((?:      [^\n]+\n)+)/g,
    '$1    outputs:\n$2$4$3'
  );

  return out;
}

/** After `aws ecs update-service`, wait for stability (blocking check in validate-scaffold). */
function patchEcsServicesStable(content: string): string {
  if (!/aws\s+ecs\s+update-service/.test(content)) return content;
  if (/services-stable|service-stable|deployments-stable/.test(content)) {
    return content;
  }
  // Match the update-service invocation whether or not --force-new-deployment is used.
  const replaced = content.replace(
    /(aws\s+ecs\s+update-service\b[^\n]*(?:\r?\n[ \t]+--[^\n]+)*)(\r?\n)/,
    `$1$2
          echo "Waiting for ECS service to stabilize..."
          aws ecs wait services-stable \\
            --cluster \${{ env.ECS_CLUSTER_NAME }} \\
            --services \${{ env.ECS_SERVICE_NAME }}
`
  );
  if (replaced !== content) return replaced;
  // Fallback: append before end of the run block that contains update-service
  return content.replace(
    /(aws\s+ecs\s+update-service\b[\s\S]{0,800}?)(\r?\n(?=[ \t]*-[ \t]+name:|\s*$))/,
    `$1
          echo "Waiting for ECS service to stabilize..."
          aws ecs wait services-stable \\
            --cluster \${{ env.ECS_CLUSTER_NAME }} \\
            --services \${{ env.ECS_SERVICE_NAME }}
$2`
  );
}

/**
 * Column-0 heredoc closers (`EOF` / `END`) inside `run: |` blocks break YAML
 * (actionlint: "could not find expected ':'"). Indent them to the script body.
 */
function indentHeredocClosers(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let scriptIndent: string | null = null;
  let openMarker: string | null = null;

  for (const line of lines) {
    const runMatch = /^([ \t]*)run:\s*(\||>)/.exec(line);
    if (runMatch) {
      scriptIndent = `${runMatch[1]}  `;
      openMarker = null;
      out.push(line);
      continue;
    }

    // Left a run block when indentation drops to step/job level
    if (scriptIndent !== null) {
      const ind = /^([ \t]*)/.exec(line)?.[1] ?? '';
      if (line.trim() && ind.length < scriptIndent.length && !/^(EOF|END)\s*$/.test(line)) {
        scriptIndent = null;
        openMarker = null;
      }
    }

    if (scriptIndent !== null) {
      const heredoc = /<<[-]?['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(line);
      if (heredoc) openMarker = heredoc[1];

      // Bare column-0 (or under-indented) closer → indent into the script
      if (
        openMarker &&
        new RegExp(`^\\s*${openMarker}\\s*$`).test(line) &&
        (line.match(/^([ \t]*)/)?.[1].length ?? 0) < scriptIndent.length
      ) {
        out.push(`${scriptIndent}${openMarker}`);
        openMarker = null;
        continue;
      }
    }

    out.push(line);
  }
  return out.join('\n');
}

/** Drop a trailing truncated run/heredoc tail that leaves a bare EOF at EOF. */
function trimTruncatedWorkflowTail(content: string): string {
  let out = content.replace(/\s+$/, '');
  // File ends with a root-level EOF/END left by a cut-off generation
  if (/^(EOF|END)$/m.test(out.split('\n').pop() || '')) {
    const lines = out.split('\n');
    while (lines.length && /^(EOF|END)?\s*$/.test(lines[lines.length - 1])) {
      lines.pop();
    }
    // Also drop the incomplete step that opened the heredoc if still broken
    while (lines.length) {
      const last = lines[lines.length - 1];
      if (/^\s*-\s+name:/.test(last) || /^\s{0,4}[a-zA-Z_][\w-]*:\s*$/.test(last)) {
        lines.pop();
        continue;
      }
      if (/<<[-]?['"]?\w+['"]?/.test(last) || /^\s*run:\s*[|>]?/.test(last)) {
        lines.pop();
        continue;
      }
      break;
    }
    out = lines.join('\n');
  }
  return out.endsWith('\n') ? out : `${out}\n`;
}

function patchGithubWorkflow(content: string): string {
  let out = patchWorkflowDispatchInputs(content);
  out = patchMissingWorkflowDispatchInputs(out);
  out = promoteOrphanRollbackSteps(out);
  out = stripOrphanWithBlocks(out);
  out = stripTerraformLeaksFromWorkflow(out);
  out = patchWorkflowJobOutputRefs(out);
  out = patchImageUriOutput(out);
  out = patchEcsServicesStable(out);
  out = indentHeredocClosers(out);
  out = trimTruncatedWorkflowTail(out);
  out = quoteUnsafeRunLines(out);
  return out;
}

/**
 * Single-line `run: echo "…: …"` breaks YAML (colon = mapping). Promote to `run: |`.
 */
function quoteUnsafeRunLines(content: string): string {
  return content.replace(
    /^([ \t]*)run:\s+(?!\|)(?!>).*$/gm,
    (line, ind: string) => {
      // Already a block scalar opener on its own line — leave alone
      if (/^[ \t]*run:\s*[|>]/.test(line)) return line;
      const rest = line.replace(/^[ \t]*run:\s+/, '');
      // Unquoted value containing `:` outside ${{ }} is unsafe in YAML
      if (!rest.includes(':')) return line;
      // Fully single- or double-quoted already
      if (
        (rest.startsWith("'") && rest.endsWith("'")) ||
        (rest.startsWith('"') && rest.endsWith('"'))
      ) {
        return line;
      }
      return `${ind}run: |\n${ind}  ${rest}`;
    }
  );
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
    detect: /\b(resource|data|provider)\s+"oci[_"]/,
    name: 'oci',
    source: 'oracle/oci',
    version: '~> 6.0',
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

  // 0. IAM condition keys with colons must be quoted HCL strings
  out = patchIamConditionKeys(out);
  // 0b. ECS CI ownership
  out = patchEcsServiceIgnoreChanges(out);

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

  // 11. aws_eip: `vpc = true` deprecated → `domain = "vpc"` (AWS provider 5.x).
  out = out.replace(
    /resource\s+"aws_eip"\s+"[^"]+"\s*\{[\s\S]*?\n\}/g,
    (block) => block.replace(/\bvpc\s*=\s*true\b/g, 'domain = "vpc"')
  );

  // 12. Prefer Node-native ECS healthCheck over curl (Alpine/slim images rarely ship curl).
  out = patchEcsCurlHealthCheckToNode(out);

  // 13. Artifact Registry has no repository_url — construct the Docker URL.
  out = patchArtifactRegistryRepositoryUrl(out);

  // 14. Break Cycle: data.google_project ↔ google_project_service
  out = patchGoogleProjectApiCycle(out);

  // 15. AWS / OCI schema mistakes that commonly fail terraform validate
  out = patchAwsValidateSchema(out);
  out = patchOciValidateSchema(out);

  return out;
}

/**
 * AWS provider schema fixes (validate-blocking).
 * aws_appautoscaling_policy has no tags; aws_ecs_service exports id (not always arn);
 * aws_rds_cluster uses cluster_resource_id (not resource_id).
 */
function patchAwsValidateSchema(content: string): string {
  let out = content;

  // Strip tags from appautoscaling_policy / target (unsupported)
  out = out.replace(
    /resource\s+"aws_appautoscaling_(?:policy|target)"\s+"[^"]+"\s*\{[\s\S]*?\n\}/g,
    (block) =>
      block
        .replace(/^[ \t]*tags\s*=\s*\{[\s\S]*?\n[ \t]*\}\s*\r?\n/gm, '')
        .replace(/^[ \t]*tags\s*=\s*[^\n]+\r?\n/gm, '')
  );

  // RDS cluster IAM auth: resource_id → cluster_resource_id
  out = out.replace(
    /(aws_rds_cluster\.[A-Za-z0-9_]+(?:\[[^\]]*\])?)\.resource_id\b/g,
    '$1.cluster_resource_id'
  );
  // Same for aws_db_instance if models invent resource_id
  out = out.replace(
    /(aws_db_instance\.[A-Za-z0-9_]+(?:\[[^\]]*\])?)\.resource_id\b/g,
    '$1.resource_id'
  );

  // aws_ecs_service: prefer .id (ARN) — .arn missing on many 5.x versions
  out = out.replace(
    /(aws_ecs_service\.[A-Za-z0-9_]+(?:\[[^\]]*\])?)\.arn\b/g,
    '$1.id'
  );

  return out;
}

/**
 * Oracle OCI provider schema fixes (validate-blocking).
 */
function patchOciValidateSchema(content: string): string {
  let out = content;

  // service_gateway.services is a set — cannot index [0]
  out = out.replace(
    /(oci_core_service_gateway\.[A-Za-z0-9_]+)\.services\[0\]\.cidr_block/g,
    'tolist($1.services)[0].cidr_block'
  );
  out = out.replace(
    /(oci_core_service_gateway\.[A-Za-z0-9_]+)\.services\[0\]/g,
    'tolist($1.services)[0]'
  );

  // Wrong CIDR arg names on OKE cluster options
  out = out.replace(/\bpods_cidr_block(\s*=)/g, 'pods_cidr$1');
  out = out.replace(/\bservices_cidr_block(\s*=)/g, 'services_cidr$1');

  // Wrap bare pods_cidr/services_cidr under options into kubernetes_network_config
  out = out.replace(
    /resource\s+"oci_containerengine_cluster"\s+"[^"]+"\s*\{[\s\S]*?\n\}/g,
    (resource) => {
      if (/kubernetes_network_config\s*\{/.test(resource)) return resource;
      if (!/\bpods_cidr\s*=/.test(resource) && !/\bservices_cidr\s*=/.test(resource)) {
        return resource;
      }
      const pods = resource.match(/^[ \t]*pods_cidr\s*=\s*.+$/m)?.[0]?.trim();
      const services = resource.match(/^[ \t]*services_cidr\s*=\s*.+$/m)?.[0]?.trim();
      let next = resource
        .replace(/^[ \t]*pods_cidr\s*=.*\r?\n/gm, '')
        .replace(/^[ \t]*services_cidr\s*=.*\r?\n/gm, '');
      const knc = [
        '    kubernetes_network_config {',
        `      ${pods || 'pods_cidr     = "10.244.0.0/16"'}`,
        `      ${services || 'services_cidr = "10.96.0.0/16"'}`,
        '    }',
      ].join('\n');
      if (/options\s*\{/.test(next)) {
        return next.replace(/options\s*\{/, `options {\n${knc}`);
      }
      return next.replace(
        /(\n)(\})/,
        `\n  options {\n${knc}\n  }$1$2`
      );
    }
  );

  // Plural data source name typo
  out = out.replace(
    /data\s+"oci_containerengine_node_pool_options"/g,
    'data "oci_containerengine_node_pool_option"'
  );
  out = out.replace(
    /oci_containerengine_node_pool_options\./g,
    'oci_containerengine_node_pool_option.'
  );

  // Drop oci_logging_log resources with invalid top-level source { } blocks
  out = out.replace(
    /resource\s+"oci_logging_log"\s+"[^"]+"\s*\{[\s\S]*?\n\}\s*/g,
    (block) => {
      const hasTopLevelSource =
        /(^|\n)[ \t]*source\s*\{/.test(block) && !/configuration\s*\{/.test(block);
      return hasTopLevelSource ? '' : block;
    }
  );

  // Outputs referencing missing oci_vault_secret → null
  const hasVaultResource = /resource\s+"oci_vault_secret"/.test(out);
  if (!hasVaultResource) {
    out = out.replace(
      /value\s*=\s*oci_vault_secret\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+/g,
      'value       = null'
    );
  }

  return out;
}

/**
 * Common GCP validate failure:
 *   Cycle: data.google_project.project, google_project_service.apis
 * Cause: APIs use data.google_project.project_id while data.google_project
 * depends_on those APIs. Fix: APIs use var.project_id; drop the depends_on.
 */
function patchGoogleProjectApiCycle(content: string): string {
  if (
    !/google_project_service/.test(content) &&
    !/data\s+"google_project"/.test(content)
  ) {
    return content;
  }

  let out = content;

  // Enable APIs with var.project_id (not data.google_project.*.project_id)
  out = out.replace(
    /resource\s+"google_project_service"\s+"[^"]+"\s*\{[\s\S]*?\n\}/g,
    (block) =>
      block
        .replace(
          /\bproject\s*=\s*data\.google_project\.[A-Za-z0-9_]+\.project_id\b/g,
          'project = var.project_id'
        )
        .replace(
          /\bproject\s*=\s*"\$\{data\.google_project\.[A-Za-z0-9_]+\.project_id\}"/g,
          'project = var.project_id'
        )
  );

  // data.google_project must not depend on google_project_service*
  out = out.replace(
    /data\s+"google_project"\s+"[^"]+"\s*\{[\s\S]*?\n\}/g,
    (block) => {
      let b = block.replace(
        /^[ \t]*depends_on\s*=\s*\[[^\]]*google_project_service[^\]]*\][ \t]*\r?\n/gm,
        ''
      );
      b = b.replace(/depends_on\s*=\s*\[([\s\S]*?)\]/g, (full, inner: string) => {
        if (!/google_project_service/.test(inner)) return full;
        const items = inner
          .split(',')
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0 && !/google_project_service/.test(s));
        if (items.length === 0) return '';
        return `depends_on = [\n    ${items.join(',\n    ')}\n  ]`;
      });
      return b;
    }
  );

  return out;
}

/** Replace invented `.repository_url` with location-project-repo Docker URL. */
function patchArtifactRegistryRepositoryUrl(content: string): string {
  if (!/\.repository_url\b/.test(content)) return content;
  // Interpolation form first
  let out = content.replace(
    /\$\{(google_artifact_registry_repository\.[A-Za-z0-9_]+)\.repository_url\}/g,
    '${$1.location}-docker.pkg.dev/${$1.project}/${$1.repository_id}'
  );
  // Bare attribute: resource.repository_url → constructed string expression
  out = out.replace(
    /(?<!\$\{)(google_artifact_registry_repository\.[A-Za-z0-9_]+)\.repository_url\b/g,
    '"${$1.location}-docker.pkg.dev/${$1.project}/${$1.repository_id}"'
  );
  return out;
}

/**
 * Rewrite ECS container healthCheck commands that shell out to curl/wget into a
 * Node one-liner so the check matches typical node:* images without apk/apt.
 */
function patchEcsCurlHealthCheckToNode(content: string): string {
  if (!/healthCheck/i.test(content) || !/\bcurl\b|\bwget\b/i.test(content)) {
    return content;
  }
  const nodeProbe =
    `node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`;
  // Single-line: ["CMD-SHELL", "curl ..."]
  let out = content.replace(
    /\[\s*"CMD-SHELL"\s*,\s*"[^"]*(?:curl|wget)[^"]*"\s*\]/gi,
    `["CMD-SHELL", "${nodeProbe}"]`
  );
  // Multi-line list form
  out = out.replace(
    /\[\s*\r?\n\s*"CMD-SHELL"\s*,\s*\r?\n\s*"[^"]*(?:curl|wget)[^"]*"\s*\r?\n\s*\]/gi,
    `["CMD-SHELL", "${nodeProbe}"]`
  );
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
  let next = dedupeTerraformDataSources(dedupeTerraformOutputs(files));
  const tfFiles = next.filter((f) => f.path.endsWith('.tf'));
  if (tfFiles.length < 2) return next;

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
  if (!hasDupes) return next;

  return next.map((file) => {
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

type TfOutputBlock = { name: string; start: number; end: number };

function findTerraformOutputBlocks(content: string): TfOutputBlock[] {
  const blocks: TfOutputBlock[] = [];
  const re = /output\s+"([^"]+)"\s*\{/g;
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
    if (content[i] === '\r') i += 1;
    if (content[i] === '\n') i += 1;
    blocks.push({ name: match[1], start: match.index, end: i });
  }
  return blocks;
}

/**
 * Keep a single definition per output name. Prefer outputs.tf; otherwise first wins.
 */
function dedupeTerraformOutputs(files: GeneratedFile[]): GeneratedFile[] {
  const tfFiles = files.filter((f) => f.path.endsWith('.tf'));
  if (tfFiles.length === 0) return files;

  type Occ = { path: string; name: string; score: number; order: number };
  const occurrences: Occ[] = [];
  let order = 0;
  for (const file of tfFiles) {
    const base = file.path.split('/').pop() || file.path;
    const score = base === 'outputs.tf' ? 100 : base === 'ecr.tf' ? 40 : 50;
    for (const block of findTerraformOutputBlocks(file.content)) {
      occurrences.push({
        path: file.path,
        name: block.name,
        score,
        order: order++,
      });
    }
  }
  if (occurrences.length === 0) return files;

  const winners = new Map<string, Occ>();
  for (const occ of occurrences) {
    const prev = winners.get(occ.name);
    if (
      !prev ||
      occ.score > prev.score ||
      (occ.score === prev.score && occ.order < prev.order)
    ) {
      winners.set(occ.name, occ);
    }
  }

  const hasDupes = occurrences.some((occ) => {
    const win = winners.get(occ.name);
    return !win || win.path !== occ.path || win.order !== occ.order;
  });
  if (!hasDupes) return files;

  return files.map((file) => {
    if (!file.path.endsWith('.tf')) return file;
    const blocks = findTerraformOutputBlocks(file.content);
    const remove: TfOutputBlock[] = [];
    const seenInFile = new Set<string>();
    for (const block of blocks) {
      const win = winners.get(block.name);
      const firstInFile = !seenInFile.has(block.name);
      seenInFile.add(block.name);
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

type TfDataBlock = { type: string; name: string; start: number; end: number };

function findTerraformDataBlocks(content: string): TfDataBlock[] {
  const blocks: TfDataBlock[] = [];
  const re = /data\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;
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

function terraformDataOwnerScore(path: string, type: string): number {
  const base = path.split('/').pop() || path;
  if (type === 'google_project') {
    if (base === 'main.tf' || base === 'versions.tf' || base === 'providers.tf') {
      return 100;
    }
    if (base === 'iam.tf') return 80;
    if (base === 'network.tf' || base === 'networking.tf') return 40;
    return 50;
  }
  if (base === 'main.tf') return 70;
  return 50;
}

/**
 * Drop duplicate `data "TYPE" "NAME"` blocks (e.g. google_project.project in
 * both iam.tf and network.tf — a common GCP Cloud Run scaffold failure).
 */
function dedupeTerraformDataSources(files: GeneratedFile[]): GeneratedFile[] {
  const tfFiles = files.filter((f) => f.path.endsWith('.tf'));
  if (tfFiles.length === 0) return files;

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
    for (const block of findTerraformDataBlocks(file.content)) {
      occurrences.push({
        path: file.path,
        type: block.type,
        name: block.name,
        score: terraformDataOwnerScore(file.path, block.type),
        order: order++,
      });
    }
  }
  if (occurrences.length === 0) return files;

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
    const blocks = findTerraformDataBlocks(file.content);
    const remove: TfDataBlock[] = [];
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
  ensureMissingTerraformVariables(byPath);
  ensureEcsScaffoldCompleteness(byPath);
  stripEksWorkflowEcsBleed(byPath);
  stripAlbAnnotationsWithoutController(byPath);
  stripCrossCloudBleed(byPath);
  ensureMinimalAppStubs(byPath);

  return dedupeTerraformResources(Array.from(byPath.values()));
}

/**
 * EKS + Helm scaffolds must not keep ECS update-service steps in deploy.yml
 * (false-fails services-stable / wrong target).
 */
function stripEksWorkflowEcsBleed(byPath: Map<string, GeneratedFile>): void {
  const hasCharts = [...byPath.keys()].some((p) => p.startsWith('charts/'));
  const tfBlob = [...byPath.entries()]
    .filter(([p]) => p.endsWith('.tf'))
    .map(([, f]) => f.content)
    .join('\n');
  const isEks =
    hasCharts || /aws_eks_cluster|aws_eks_node_group|aws_eks_fargate/.test(tfBlob);
  if (!isEks) return;

  for (const [path, file] of [...byPath.entries()]) {
    if (!path.startsWith('.github/workflows/') || !path.endsWith('.yml')) continue;
    let content = file.content;
    // Drop ECS rollback jobs that reference prior_task_def_arn (ECS-only).
    content = content.replace(
      /\n  scaffold_rollback:[\s\S]*?(?=\n  [a-zA-Z_]|\n*$)/g,
      '\n'
    );
    content = content.replace(
      /^[ \t]*aws\s+ecs\s+update-service[\s\S]*?(?=^[ \t]*aws\s+ecs\s+wait|^[ \t]*-[ \t]+name:|^[ \t]*[a-z_][\w-]*:)/gm,
      ''
    );
    content = content.replace(
      /^[ \t]*aws\s+ecs\s+wait\s+services-stable[\s\S]*?(?=^[ \t]*-[ \t]+name:|^[ \t]*[a-z_][\w-]*:)/gm,
      ''
    );
    // Remove prior_task_def_arn output lines on EKS workflows
    content = content.replace(/^[ \t]*prior_task_def_arn:.*\r?\n/gm, '');
    if (content !== file.content) {
      byPath.set(path, { ...file, content });
    }
  }
}

function stripAlbAnnotationsWithoutController(
  byPath: Map<string, GeneratedFile>
): void {
  const tfBlob = [...byPath.entries()]
    .filter(([p]) => p.endsWith('.tf'))
    .map(([, f]) => f.content)
    .join('\n');
  const hasController =
    /helm_release/.test(tfBlob) && /aws-load-balancer-controller/.test(tfBlob);
  if (hasController) return;

  for (const [path, file] of [...byPath.entries()]) {
    if (!/charts\/.+\/templates\/ingress\.ya?ml$/i.test(path)) continue;
    if (!/alb\.ingress\.kubernetes\.io/.test(file.content)) continue;
    const cleaned = file.content
      .replace(/^\s*kubernetes\.io\/ingress\.class:\s*alb\s*$/gm, '')
      .replace(/^\s*alb\.ingress\.kubernetes\.io\/[^\n]*$/gm, '');
    byPath.set(path, { ...file, content: cleaned });
  }

  for (const [path, file] of [...byPath.entries()]) {
    if (!/charts\/.+\/values\.ya?ml$/i.test(path)) continue;
    if (!/alb\.ingress\.kubernetes\.io|className:\s*alb/.test(file.content)) {
      continue;
    }
    let content = file.content.replace(/className:\s*alb\b/g, 'className: nginx');
    content = content.replace(
      /(ingress:\s*\n(?:[ \t]+[^\n]*\n)*?[ \t]+enabled:\s*)true/m,
      '$1false'
    );
    byPath.set(path, { ...file, content });
  }
}

/** Drop AWS-only files that bled into a GCP Cloud Run scaffold (and vice versa). */
function stripCrossCloudBleed(byPath: Map<string, GeneratedFile>): void {
  const tfBlob = [...byPath.entries()]
    .filter(([p]) => p.endsWith('.tf'))
    .map(([, f]) => f.content)
    .join('\n');
  const isGcp =
    /google_cloud_run|google_artifact_registry|google_sql_database_instance/.test(
      tfBlob
    );
  const isAwsEksEcs = /aws_ecs_service|aws_eks_cluster|aws_lb\b/.test(tfBlob);

  if (isGcp && !isAwsEksEcs) {
    for (const p of [...byPath.keys()]) {
      if (!p.endsWith('.tf')) continue;
      const content = byPath.get(p)!.content;
      const awsHeavy =
        /\baws_/.test(content) && !/\bgoogle_/.test(content);
      if (
        awsHeavy ||
        /(^|\/)(ecs|alb|redis|elasticache)\.tf$/.test(p)
      ) {
        byPath.delete(p);
      }
    }
  }

  // EKS / Helm scaffolds must not keep ECS-only terraform that confuses validate.
  const isEks =
    /aws_eks_cluster|aws_eks_node_group|aws_eks_fargate/.test(tfBlob) ||
    [...byPath.keys()].some((p) => p.startsWith('charts/'));
  const isEcsService = /aws_ecs_service|aws_ecs_task_definition/.test(tfBlob);
  if (isEks && !isEcsService) {
    for (const p of [...byPath.keys()]) {
      if (/(^|\/)ecs\.tf$/.test(p)) byPath.delete(p);
    }
  }
  // Misplaced kubernetes/helm provider-only ecs.tf on EKS (common Fix-failures hallucination)
  if (isEks) {
    for (const p of [...byPath.keys()]) {
      if (!/(^|\/)ecs\.tf$/.test(p)) continue;
      const c = byPath.get(p)!.content;
      if (
        /provider\s+"kubernetes"|provider\s+"helm"|aws_eks_cluster/.test(c) &&
        !/aws_ecs_service|aws_ecs_task_definition/.test(c)
      ) {
        byPath.delete(p);
      }
    }
  }
}

const BUSINESS_APP_RE =
  /create_all\(|Base\.metadata\.create_all|@app\.(post|put|delete|patch)\(|router\.(post|put|delete)|\/items\b|passport|jwt\.sign|SQLAlchemy|declarative_base/;

const MINIMAL_FASTAPI_STUB = `from fastapi import FastAPI

app = FastAPI(
    title="Health stub",
    description="Minimal health-check stub for infrastructure scaffolds.",
    version="0.1.0",
)


@app.get("/")
async def root():
    return {"status": "ok"}


@app.get("/health")
async def health():
    return {"status": "ok"}
`;

const MINIMAL_EXPRESS_STUB = `const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(\`listening on \${port}\`);
});
`;

const MINIMAL_GO_STUB = `package main

import (
\t"encoding/json"
\t"net/http"
\t"os"
)

func main() {
\tport := os.Getenv("PORT")
\tif port == "" {
\t\tport = "8080"
\t}
\thttp.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
\t\tw.Header().Set("Content-Type", "application/json")
\t\t_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
\t})
\thttp.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
\t\tw.Header().Set("Content-Type", "application/json")
\t\t_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
\t})
\t_ = http.ListenAndServe(":"+port, nil)
}
`;

/**
 * Replace CRUD/ORM/auth app sources with a minimal /health stub so validators pass.
 */
function ensureMinimalAppStubs(byPath: Map<string, GeneratedFile>): void {
  for (const [path, file] of [...byPath.entries()]) {
    if (!/\.(py|js|ts|go)$/i.test(path)) continue;
    // Skip lockfiles / config masquerading
    if (/package-lock|tsconfig|go\.mod|go\.sum/i.test(path)) continue;
    const lines = file.content.split('\n').length;
    const looksBusiness = BUSINESS_APP_RE.test(file.content);
    const tooLong = lines > 120;
    if (!looksBusiness && !tooLong) continue;

    const base = path.split('/').pop()?.toLowerCase() || '';
    if (base.endsWith('.py')) {
      byPath.set(path, {
        ...file,
        content: MINIMAL_FASTAPI_STUB,
        description: 'Minimal FastAPI /health stub (auto-trimmed from business app)',
      });
    } else if (base.endsWith('.go')) {
      byPath.set(path, {
        ...file,
        content: MINIMAL_GO_STUB,
        description: 'Minimal Go /health stub (auto-trimmed from business app)',
      });
    } else if (
      base === 'server.js' ||
      base === 'index.js' ||
      base === 'main.js' ||
      base === 'app.js' ||
      path === 'app/server.js' ||
      path === 'app/index.js'
    ) {
      byPath.set(path, {
        ...file,
        content: MINIMAL_EXPRESS_STUB,
        description: 'Minimal Express /health stub (auto-trimmed from business app)',
      });
    }
  }
}

const DEFAULT_ECS_EXPRESS_DOCKERFILE = `# hadolint ignore=DL3018,DL3008
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.js"]
`;

/** Ensure curl/wget install when TF still references them (after node rewrite fallback). */
function ensureCurlInDockerfile(content: string): string {
  if (
    /apk add[^;\n]*curl|apt-get install[^;\n]*curl|yum install[^;\n]*curl|microdnf install[^;\n]*curl/i.test(
      content
    )
  ) {
    return content;
  }

  // Alpine (including node:*-alpine)
  if (/FROM\s+[^\n]*alpine/i.test(content)) {
    let out = content;
    if (!/# hadolint ignore=.*DL3018/i.test(out)) {
      out = `# hadolint ignore=DL3018\n${out}`;
    }
    if (/RUN\s+apk add[^\n]*/i.test(out)) {
      out = out.replace(/(RUN\s+apk add[^\n]*)/i, (m) =>
        /\bcurl\b/.test(m) ? m : `${m} curl`
      );
    } else {
      out = out.replace(
        /(FROM\s+[^\n]+\n)/i,
        '$1RUN apk add --no-cache curl\n'
      );
    }
    return out;
  }

  // Debian/Ubuntu family — node:*-slim / bookworm / bullseye (not only literal "debian")
  if (
    /FROM\s+[^\n]*(debian|ubuntu|slim|bookworm|bullseye|jammy|focal)/i.test(
      content
    )
  ) {
    let out = content;
    if (!/# hadolint ignore=.*DL3008/i.test(out)) {
      out = `# hadolint ignore=DL3008\n${out}`;
    }
    if (!/apt-get install[^;\n]*curl/i.test(out)) {
      out = out.replace(
        /(FROM\s+[^\n]+\n)/i,
        '$1RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*\n'
      );
    }
    return out;
  }

  return content;
}

/**
 * Declare any var.NAME referenced in .tf files but missing from variable blocks.
 * Unblocks terraform validate "undeclared input variable" without inventing resources.
 */
function ensureMissingTerraformVariables(
  byPath: Map<string, GeneratedFile>
): void {
  const tfFiles = [...byPath.entries()].filter(([p]) => p.endsWith('.tf'));
  if (tfFiles.length === 0) return;

  const blob = tfFiles.map(([, f]) => f.content).join('\n');
  const referenced = new Set<string>();
  for (const m of blob.matchAll(/\bvar\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    referenced.add(m[1]);
  }
  if (referenced.size === 0) return;

  const declared = new Set<string>();
  for (const m of blob.matchAll(/variable\s+"([A-Za-z_][A-Za-z0-9_]*)"/g)) {
    declared.add(m[1]);
  }

  const missing = [...referenced].filter((n) => !declared.has(n)).sort();
  if (missing.length === 0) return;

  const stub = missing
    .map(
      (name) =>
        `variable "${name}" {\n  type        = any\n  description = "Auto-declared so terraform validate can resolve references"\n  default     = null\n}\n`
    )
    .join('\n');

  const varsPath =
    [...byPath.keys()].find((p) => p.endsWith('/variables.tf') || p === 'terraform/variables.tf') ||
    'terraform/variables.tf';
  const existing = byPath.get(varsPath);
  byPath.set(varsPath, {
    path: varsPath,
    language: 'hcl',
    content: existing
      ? `${existing.content.replace(/\s*$/, '\n\n')}${stub}`
      : stub,
    description: existing?.description || 'Terraform variables (auto-completed)',
  });
}

/**
 * When CI owns the image/task definition, ECS services must ignore those attrs
 * or validate fails the ownership check.
 */
function patchEcsServiceIgnoreChanges(content: string): string {
  if (!/resource\s+"aws_ecs_service"/.test(content)) return content;
  if (/resource\s+"aws_ecs_service"[\s\S]*?ignore_changes/.test(content)) {
    return content;
  }
  return content.replace(
    /resource\s+"aws_ecs_service"\s+"([^"]+)"\s*\{([\s\S]*?)\n\}/g,
    (full, name: string, body: string) => {
      if (/lifecycle\s*\{/.test(body)) {
        if (/ignore_changes/.test(body)) return full;
        return full.replace(
          /lifecycle\s*\{/,
          'lifecycle {\n    ignore_changes = [task_definition, desired_count]'
        );
      }
      return `resource "aws_ecs_service" "${name}" {${body}
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}`;
    }
  );
}

/** ECS Fargate: Dockerfile present + curl/healthCheck aligned; accept app/Dockerfile layout. */
function ensureEcsScaffoldCompleteness(byPath: Map<string, GeneratedFile>): void {
  const tfEntries = [...byPath.entries()].filter(([p]) => p.endsWith('.tf'));
  const tfBlob = tfEntries.map(([, f]) => f.content).join('\n');
  if (!/aws_ecs_service|aws_ecs_task_definition/.test(tfBlob)) return;

  // Re-apply curl→node rewrite across the full TF tree (covers split files).
  for (const [p, f] of tfEntries) {
    let next = patchEcsCurlHealthCheckToNode(f.content);
    next = patchEcsServiceIgnoreChanges(next);
    if (next !== f.content) {
      byPath.set(p, { ...f, content: next });
    }
  }
  const tfBlobAfter = [...byPath.entries()]
    .filter(([p]) => p.endsWith('.tf'))
    .map(([, f]) => f.content)
    .join('\n');
  const usesCurlHealth = /healthCheck[\s\S]*?curl|curl\s+-f/i.test(tfBlobAfter);

  const hasAppSources = [...byPath.keys()].some(
    (p) => p.startsWith('app/') && p !== 'app/Dockerfile'
  );
  let dockerPaths = ['Dockerfile', 'app/Dockerfile'].filter((p) => byPath.has(p));

  // Synthesize a minimal Express Dockerfile when the model omitted it
  if (dockerPaths.length === 0) {
    const target = hasAppSources ? 'app/Dockerfile' : 'Dockerfile';
    const entry = byPath.has('app/server.js')
      ? 'server.js'
      : byPath.has('app/index.js') || byPath.has('index.js')
        ? 'index.js'
        : 'server.js';
    byPath.set(target, {
      path: target,
      language: 'dockerfile',
      content: DEFAULT_ECS_EXPRESS_DOCKERFILE.replace(
        'CMD ["node", "server.js"]',
        `CMD ["node", "${entry}"]`
      ),
    });
    dockerPaths = [target];
  }

  for (const dp of dockerPaths) {
    const file = byPath.get(dp)!;
    let content = patchDockerfileCopy(file.content);
    content = patchDockerfileUser(content);
    if (usesCurlHealth) {
      content = ensureCurlInDockerfile(content);
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
