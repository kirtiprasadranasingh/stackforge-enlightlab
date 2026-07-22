/**
 * Apply interview / prompt options onto locked profile files
 * (region, DB, envs, scale, access, CI).
 */
import type { GeneratedFile, Presets, CIProvider } from '@/types';
import { getLanguageFromPath } from '@/lib/utils';
import {
  type ScaffoldOptions,
  scaleToReplicas,
  regionVarName,
} from '@/lib/scaffold-options';

function set(files: Map<string, GeneratedFile>, path: string, content: string) {
  files.set(path, {
    path,
    language: getLanguageFromPath(path),
    content,
    description: 'Option-customized locked template',
  });
}

function patchDefault(
  content: string,
  varName: string,
  value: string | number | boolean
): string {
  const lit =
    typeof value === 'string'
      ? `"${value}"`
      : typeof value === 'boolean'
        ? value
          ? 'true'
          : 'false'
        : String(value);
  const re = new RegExp(
    `(variable\\s+"${varName}"\\s*\\{[\\s\\S]*?default\\s*=\\s*)[^\\n]+`,
    'm'
  );
  if (re.test(content)) {
    return content.replace(re, `$1${lit}`);
  }
  return content;
}

function ciSkeleton(ci: CIProvider, presets: Presets): { path: string; content: string } {
  const regionHint =
    presets.cloud === 'aws'
      ? 'AWS_REGION'
      : presets.cloud === 'gcp'
        ? 'GCP_REGION'
        : presets.cloud === 'azure'
          ? 'AZURE_LOCATION'
          : 'OCI_REGION';

  switch (ci) {
    case 'gitlab-ci':
      return {
        path: '.gitlab-ci.yml',
        content: `stages: [test, build, deploy]
variables:
  IMAGE_TAG: $CI_COMMIT_SHORT_SHA
test:
  stage: test
  script: ["echo health-stub-ok"]
build:
  stage: build
  script:
    - echo "Build and push image for ${presets.cloud}/${presets.orchestrator}"
deploy:
  stage: deploy
  script:
    - echo "Deploy using ${regionHint} credentials"
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
`,
      };
    case 'azure-devops':
      return {
        path: 'azure-pipelines.yml',
        content: `trigger:
  - main
pool:
  vmImage: ubuntu-latest
stages:
  - stage: Build
    jobs:
      - job: build
        steps:
          - script: echo "Build image for ${presets.cloud}"
  - stage: Deploy
    dependsOn: Build
    jobs:
      - job: deploy
        steps:
          - script: echo "Deploy to ${presets.orchestrator}"
`,
      };
    case 'jenkins':
      return {
        path: 'Jenkinsfile',
        content: `pipeline {
  agent any
  stages {
    stage('Test') { steps { sh 'echo ok' } }
    stage('Build') { steps { sh 'echo build' } }
    stage('Deploy') { steps { sh 'echo deploy ${presets.orchestrator}' } }
  }
}
`,
      };
    case 'aws-codepipeline':
      return {
        path: 'buildspec.yml',
        content: `version: 0.2
phases:
  build:
    commands:
      - echo Build for ECS/EKS
  post_build:
    commands:
      - echo Deploy
artifacts:
  files:
    - '**/*'
`,
      };
    case 'gcp-cloud-build':
      return {
        path: 'cloudbuild.yaml',
        content: `steps:
  - name: gcr.io/cloud-builders/docker
    args: ['build', '-t', 'app:$SHORT_SHA', '.']
  - name: gcr.io/cloud-builders/docker
    args: ['push', 'app:$SHORT_SHA']
images:
  - app:$SHORT_SHA
`,
      };
    case 'oci-devops':
      return {
        path: 'build_spec.yaml',
        content: `version: 0.1
component: build
timeoutInSeconds: 600
steps:
  - type: Command
    name: Build
    command: echo "OCI DevOps build for OKE"
`,
      };
    default:
      return {
        path: '.github/workflows/deploy.yml',
        content: `name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - name: Deploy note
        run: |
          echo "Configure cloud credentials for ${presets.cloud}/${presets.orchestrator}"
          echo "image_uri=registry.example.com/app:sha" >> "$GITHUB_OUTPUT"
`,
      };
  }
}

/**
 * Customize locked base files using parsed scaffold options + presets.ci.
 */
export function applyScaffoldOptions(
  files: GeneratedFile[],
  presets: Presets,
  options: ScaffoldOptions
): GeneratedFile[] {
  const byPath = new Map(
    files.map((f) => [f.path.replace(/\\/g, '/'), { ...f, path: f.path.replace(/\\/g, '/') }])
  );
  const regionKey = regionVarName(presets.cloud);
  const replicas = scaleToReplicas(options.scale);

  // Patch terraform variables defaults
  for (const [p, f] of [...byPath.entries()]) {
    if (!p.endsWith('variables.tf')) continue;
    let c = f.content;
    c = patchDefault(c, regionKey, options.region);
    c = patchDefault(c, 'aws_region', options.region);
    c = patchDefault(c, 'region', options.region);
    c = patchDefault(c, 'location', options.region);
    c = patchDefault(c, 'desired_count', replicas.desiredCount);
    c = patchDefault(c, 'node_desired_size', replicas.desiredCount);
    c = patchDefault(c, 'node_min_size', replicas.minReplicas);
    c = patchDefault(c, 'node_max_size', replicas.maxReplicas);
    c = patchDefault(c, 'node_count', replicas.desiredCount);

    const enableDb = options.database !== 'none' && options.database !== 'redis';
    const enableRedis = options.database === 'redis';
    c = patchDefault(c, 'enable_database', enableDb);
    c = patchDefault(c, 'enable_redis', enableRedis);
    if (options.database === 'mysql') c = patchDefault(c, 'db_engine', 'mysql');
    if (options.database === 'postgres' || options.database === 'mongodb') {
      c = patchDefault(c, 'db_engine', 'postgres');
    }
    const multiAz =
      options.databaseMode === 'ha' || options.databaseMode === 'ha_backup';
    c = patchDefault(c, 'db_multi_az', multiAz);
    c = patchDefault(c, 'db_ha', multiAz);
    byPath.set(p, { ...f, content: c });
  }

  // Environment tfvars
  for (const p of [...byPath.keys()]) {
    if (p.startsWith('environments/') && p.endsWith('.tfvars')) byPath.delete(p);
  }
  for (const env of options.environments) {
    const lines = [
      `${regionKey} = "${options.region}"`,
      `environment  = "${env}"`,
      `project_name = "stackforge"`,
    ];
    if (presets.cloud === 'gcp') {
      lines.unshift(`# set project_id in CI / tfvars`);
      lines.push(`# project_id = "YOUR_GCP_PROJECT"`);
    }
    if (presets.cloud === 'oracle') {
      lines.push(`# compartment_ocid = "ocid1.compartment..."`);
      lines.push(`# tenancy_ocid = "ocid1.tenancy..."`);
    }
    set(byPath, `environments/${env}.tfvars`, `${lines.join('\n')}\n`);
  }

  // Helm values: scale + access
  const valuesPath = [...byPath.keys()].find((p) => /charts\/.+\/values\.ya?ml$/.test(p));
  if (valuesPath) {
    let v = byPath.get(valuesPath)!.content;
    v = v.replace(/replicaCount:\s*\d+/, `replicaCount: ${replicas.replicaCount}`);
    v = v.replace(/minReplicas:\s*\d+/, `minReplicas: ${replicas.minReplicas}`);
    v = v.replace(/maxReplicas:\s*\d+/, `maxReplicas: ${replicas.maxReplicas}`);
    if (options.access === 'private') {
      v = v.replace(/enabled:\s*true/, 'enabled: false');
      v = v.replace(/className:\s*alb/, 'className: nginx');
    } else {
      v = v.replace(
        /(ingress:\s*\n(?:[ \t]+[^\n]*\n)*?[ \t]+enabled:\s*)false/m,
        '$1true'
      );
    }
    byPath.set(valuesPath, { ...byPath.get(valuesPath)!, content: v });
  }

  // CI swap — remove other CI skeletons, write selected one (keep existing GHA if already good for github)
  const ciPaths = [
    '.github/workflows/deploy.yml',
    '.gitlab-ci.yml',
    'azure-pipelines.yml',
    'Jenkinsfile',
    'buildspec.yml',
    'cloudbuild.yaml',
    'build_spec.yaml',
  ];
  const chosen = ciSkeleton(presets.ci, presets);
  // Keep richer locked GHA if present and user chose github-actions
  if (presets.ci === 'github-actions' && byPath.has('.github/workflows/deploy.yml')) {
    // still remove competing CI files
    for (const p of ciPaths) {
      if (p !== '.github/workflows/deploy.yml') byPath.delete(p);
    }
  } else {
    for (const p of ciPaths) byPath.delete(p);
    set(byPath, chosen.path, chosen.content);
  }

  // MongoDB note in README when selected (uses Postgres-compatible managed DB)
  if (options.database === 'mongodb') {
    const readme = byPath.get('README.md');
    if (readme) {
      byPath.set('README.md', {
        ...readme,
        content:
          readme.content +
          `\n\n## Database note\nMongoDB was selected — this scaffold provisions a managed relational DB as a validate-safe starting point. Swap to DocumentDB / Atlas before production.\n`,
      });
    }
  }

  if (options.database === 'none') {
    // Ensure enable flags are false even if variable block missing defaults patch
    for (const [p, f] of [...byPath.entries()]) {
      if (!p.endsWith('.tf')) continue;
      let c = f.content;
      c = c.replace(
        /default\s*=\s*true(\s*\n\s*description\s*=\s*"[^"]*database)/gi,
        'default     = false$1'
      );
      byPath.set(p, { ...f, content: c });
    }
  }

  return Array.from(byPath.values());
}
