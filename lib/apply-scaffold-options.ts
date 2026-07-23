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
    c = patchDefault(c, 'alb_internal', options.access === 'private');
    const publicAccess =
      options.access === 'public_https' || options.access === 'public_basic';
    c = patchDefault(c, 'allow_public_access', publicAccess);
    if (options.databaseMode === 'ha_backup') {
      c = patchDefault(c, 'backup_retention_count', 7);
      c = patchDefault(c, 'backup_retention_days', 7);
    }
    c = patchDefault(c, 'ingress_external', publicAccess);
    c = patchDefault(c, 'min_replicas', replicas.minReplicas);
    c = patchDefault(c, 'max_replicas', replicas.maxReplicas);
    c = patchDefault(c, 'min_instance_count', replicas.minReplicas);
    c = patchDefault(c, 'max_instance_count', replicas.maxReplicas);
    c = patchDefault(c, 'redis_ha', multiAz);
    c = patchDefault(c, 'node_pool_size', replicas.desiredCount);
    byPath.set(p, { ...f, content: c });
  }

  // Drop model-invented terraform/*.tfvars (canonical path is environments/)
  for (const p of [...byPath.keys()]) {
    if (/^terraform\/[^/]+\.tfvars$/.test(p)) byPath.delete(p);
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
    const enableDb =
      options.database !== 'none' && options.database !== 'redis';
    const enableRedis = options.database === 'redis';
    const multiAz =
      options.databaseMode === 'ha' || options.databaseMode === 'ha_backup';
    const publicAccess =
      options.access === 'public_https' || options.access === 'public_basic';

    if (presets.cloud === 'gcp') {
      lines.push(`enable_database = ${enableDb}`);
      if (enableDb) {
        lines.push(
          `db_engine = "${options.database === 'mysql' ? 'mysql' : 'postgres'}"`
        );
      }
      if (presets.orchestrator === 'cloud-run') {
        lines.push(`enable_redis = ${enableRedis}`);
        if (enableRedis) lines.push(`redis_ha = ${multiAz}`);
        lines.push(`allow_public_access = ${publicAccess}`);
        lines.push(`min_instance_count = ${replicas.minReplicas}`);
        lines.push(`max_instance_count = ${replicas.maxReplicas}`);
      }
      if (presets.orchestrator === 'gke') {
        lines.push(`# node pool sizing reflected in Helm replicaCount / HPA`);
      }
      if (options.databaseMode === 'ha_backup' && enableDb) {
        lines.push('backup_retention_count = 7');
      }
      lines.push(`# project_id = "YOUR_GCP_PROJECT"`);
    }

    if (presets.cloud === 'aws') {
      if (presets.orchestrator === 'ecs') {
        lines.push(`desired_count = ${replicas.desiredCount}`);
        lines.push(`alb_internal = ${!publicAccess}`);
      } else {
        lines.push(`node_desired_size = ${replicas.desiredCount}`);
        lines.push(`node_min_size = ${replicas.minReplicas}`);
        lines.push(`node_max_size = ${replicas.maxReplicas}`);
      }
      lines.push(`enable_database = ${enableDb}`);
      if (enableDb) {
        lines.push(
          `db_engine = "${options.database === 'mysql' ? 'mysql' : 'postgres'}"`
        );
      }
      if (presets.orchestrator === 'ecs') {
        lines.push(`enable_redis = ${enableRedis}`);
      }
      lines.push(`db_multi_az = ${multiAz}`);
    }

    if (presets.cloud === 'azure') {
      lines.push(`enable_database = ${enableDb}`);
      if (presets.orchestrator === 'container-apps') {
        lines.push(`ingress_external = ${publicAccess}`);
        lines.push(`min_replicas = ${replicas.minReplicas}`);
        lines.push(`max_replicas = ${replicas.maxReplicas}`);
      } else {
        lines.push(`node_count = ${replicas.desiredCount}`);
      }
      if (options.databaseMode === 'ha_backup' && enableDb) {
        lines.push('backup_retention_days = 7');
      }
    }

    if (presets.cloud === 'oracle') {
      lines.push(`# compartment_ocid = "ocid1.compartment..."`);
      lines.push(`# tenancy_ocid = "ocid1.tenancy..."`);
      lines.push(`enable_database = ${enableDb && options.database === 'mysql'}`);
      if (options.database === 'mysql') {
        lines.push('db_engine = "mysql"');
      }
      lines.push(`node_pool_size = ${replicas.desiredCount}`);
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
      // Target ingress.enabled only — a bare `enabled: true` often hits autoscaling.
      v = v.replace(
        /(ingress:\s*\n(?:[ \t]+[^\n]*\n)*?[ \t]+enabled:\s*)true/m,
        '$1false'
      );
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
    for (const p of ciPaths) {
      if (p !== '.github/workflows/deploy.yml') byPath.delete(p);
    }
    // Drop model-invented alternate CI trees
    for (const p of [...byPath.keys()]) {
      if (p.startsWith('aws-codepipeline/')) byPath.delete(p);
    }
    const wf = byPath.get('.github/workflows/deploy.yml')!;
    let w = wf.content;
    // Align region fallback with interview answer (e.g. eu-west-1)
    w = w.replace(
      /AWS_REGION:\s*\$\{\{\s*vars\.AWS_REGION\s*\|\|\s*'[^']+'\s*\}\}/g,
      `AWS_REGION: \${{ vars.AWS_REGION || '${options.region}' }}`
    );
    w = w.replace(
      /aws-region:\s*\$\{\{\s*env\.AWS_REGION\s*\}\}/g,
      'aws-region: ${{ env.AWS_REGION }}'
    );
    byPath.set('.github/workflows/deploy.yml', { ...wf, content: w });
  } else {
    for (const p of ciPaths) byPath.delete(p);
    // Remove all GHA workflows + nested CodePipeline copies the model invents
    for (const p of [...byPath.keys()]) {
      if (p.startsWith('.github/workflows/')) byPath.delete(p);
      if (p.startsWith('aws-codepipeline/')) byPath.delete(p);
    }
    // GKE + Cloud Build: build app/ context and push to Artifact Registry placeholder
    if (presets.ci === 'gcp-cloud-build' && presets.orchestrator === 'gke') {
      set(
        byPath,
        'cloudbuild.yaml',
        `steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - -t
      - \${_REGION}-docker.pkg.dev/$PROJECT_ID/\${_REPO}/app:$SHORT_SHA
      - ./app
  - name: gcr.io/cloud-builders/docker
    args:
      - push
      - \${_REGION}-docker.pkg.dev/$PROJECT_ID/\${_REPO}/app:$SHORT_SHA
  - name: gcr.io/cloud-builders/kubectl
    args:
      - set
      - image
      - deployment/app
      - app=\${_REGION}-docker.pkg.dev/$PROJECT_ID/\${_REPO}/app:$SHORT_SHA
    env:
      - CLOUDSDK_COMPUTE_REGION=\${_REGION}
substitutions:
  _REGION: ${options.region}
  _REPO: stackforge
images:
  - \${_REGION}-docker.pkg.dev/$PROJECT_ID/\${_REPO}/app:$SHORT_SHA
`
      );
    } else {
      set(byPath, chosen.path, chosen.content);
    }
  }

  // Model sometimes invents a second app tree alongside locked app/
  for (const p of [...byPath.keys()]) {
    if (p === 'application' || p.startsWith('application/')) byPath.delete(p);
    if (p === 'container_app' || p.startsWith('container_app/')) byPath.delete(p);
  }

  // Runtime stubs — swap when interview picks a language
  const useAppLayout =
    [...byPath.keys()].some(
      (p) => p.startsWith('charts/') || p.startsWith('app/')
    ) ||
    ['ecs', 'eks', 'gke', 'aks', 'oke'].includes(presets.orchestrator);

  if (options.runtime === 'python') {
    const pyMain = `from fastapi import FastAPI

app = FastAPI(title="Health stub", version="0.1.0")

@app.get("/")
async def root():
    return {"status": "ok"}

@app.get("/health")
async def health():
    return {"status": "ok"}
`;
    const pyReq = `fastapi==0.115.6\nuvicorn[standard]==0.34.0\n`;
    const pyDocker = `# hadolint ignore=DL3008
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=8080
EXPOSE 8080
USER nobody
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
`;
    // Prefer app/ layout for ECS / Helm / K8s (CI builds app/Dockerfile)
    if (useAppLayout) {
      set(byPath, 'app/main.py', pyMain);
      set(byPath, 'app/requirements.txt', pyReq);
      set(byPath, 'app/Dockerfile', pyDocker);
      for (const p of [
        'app/server.js',
        'app/package.json',
        'app/package-lock.json',
        'main.go',
        'go.mod',
        'go.sum',
        'Dockerfile',
        'main.py',
        'requirements.txt',
      ]) {
        byPath.delete(p);
      }
      const valuesPathPy = [...byPath.keys()].find((p) =>
        /charts\/.+\/values\.ya?ml$/.test(p)
      );
      if (valuesPathPy) {
        let v = byPath.get(valuesPathPy)!.content;
        v = v.replace(/targetPort:\s*\d+/, 'targetPort: 8080');
        v = v.replace(/containerPort:\s*\d+/, 'containerPort: 8080');
        byPath.set(valuesPathPy, { ...byPath.get(valuesPathPy)!, content: v });
      }
    } else {
      set(byPath, 'main.py', pyMain);
      set(byPath, 'requirements.txt', pyReq);
      set(byPath, 'Dockerfile', pyDocker);
      for (const p of [
        'app/server.js',
        'app/package.json',
        'app/package-lock.json',
        'app/Dockerfile',
        'app/main.py',
        'app/requirements.txt',
        'app/main.go',
        'app/go.mod',
        'app/go.sum',
        'main.go',
        'go.mod',
        'go.sum',
      ]) {
        byPath.delete(p);
      }
    }
  }

  if (options.runtime === 'go') {
    const goMain = `package main

import (
	"encoding/json"
	"net/http"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	_ = http.ListenAndServe(":"+port, nil)
}
`;
    const goMod = `module stackforge-health

go 1.22
`;
    const goDocker = `# hadolint ignore=DL3008
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 go build -o /out/app .

FROM gcr.io/distroless/static-debian12
WORKDIR /
COPY --from=build /out/app /app
ENV PORT=8080
EXPOSE 8080
USER nonroot:nonroot
CMD ["/app"]
`;
    if (useAppLayout) {
      set(byPath, 'app/main.go', goMain);
      set(byPath, 'app/go.mod', goMod);
      set(byPath, 'app/go.sum', '\n');
      set(byPath, 'app/Dockerfile', goDocker);
      for (const p of [
        'app/server.js',
        'app/package.json',
        'app/package-lock.json',
        'app/main.py',
        'app/requirements.txt',
        'main.py',
        'requirements.txt',
        'Dockerfile',
        'main.go',
        'go.mod',
        'go.sum',
      ]) {
        byPath.delete(p);
      }
    } else {
      set(byPath, 'main.go', goMain);
      set(byPath, 'go.mod', goMod);
      set(byPath, 'go.sum', '\n');
      set(byPath, 'Dockerfile', goDocker);
      for (const p of [
        'main.py',
        'requirements.txt',
        'app/main.py',
        'app/requirements.txt',
        'app/main.go',
        'app/go.mod',
        'app/go.sum',
        'app/Dockerfile',
        'app/server.js',
        'app/package.json',
        'app/package-lock.json',
      ]) {
        byPath.delete(p);
      }
    }
  }

  // Node runtime — re-seed Express stub when interview picks Node (e.g. after Cloud Run Python default)
  if (options.runtime === 'node') {
    const serverJs = `const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
app.get('/', (_req, res) => res.status(200).json({ status: 'ok' }));
app.listen(port, () => console.log('listening on', port));
`;
    const pkg = `{
  "name": "stackforge-health-stub",
  "version": "1.0.0",
  "private": true,
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": { "express": "4.18.2" }
}
`;
    const docker = `# hadolint ignore=DL3018
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
    if (useAppLayout) {
      set(byPath, 'app/server.js', serverJs);
      set(byPath, 'app/package.json', pkg);
      set(byPath, 'app/package-lock.json', '{\n  "name": "stackforge-health-stub",\n  "lockfileVersion": 3,\n  "requires": true,\n  "packages": {}\n}\n');
      set(byPath, 'app/Dockerfile', docker);
      for (const p of [
        'app/main.py',
        'app/requirements.txt',
        'app/main.go',
        'app/go.mod',
        'app/go.sum',
        'main.py',
        'requirements.txt',
        'main.go',
        'go.mod',
        'go.sum',
        'Dockerfile',
      ]) {
        byPath.delete(p);
      }
    } else if (presets.orchestrator === 'cloud-run' || presets.orchestrator === 'container-apps') {
      // Root Node layout for serverless/container app profiles
      set(byPath, 'server.js', serverJs);
      set(byPath, 'package.json', pkg);
      set(byPath, 'Dockerfile', docker.replace('PORT=3000', 'PORT=8080').replace('EXPOSE 3000', 'EXPOSE 8080').replace('|| 3000', '|| 8080'));
      set(byPath, 'server.js', serverJs.replace('|| 3000', '|| 8080'));
      for (const p of [
        'main.py',
        'requirements.txt',
        'main.go',
        'go.mod',
        'go.sum',
        'app/main.py',
        'app/requirements.txt',
        'app/main.go',
        'app/go.mod',
        'app/server.js',
      ]) {
        byPath.delete(p);
      }
    }
  }

  // Capability honesty — document unsupported DB/runtime for this cloud profile
  const notes: string[] = [];
  notes.push(
    `Applied from interview: region=${options.region}; envs=${options.environments.join(', ')}; access=${options.access}; database=${options.database}; scale=${options.scale}; runtime=${options.runtime}; ci=${presets.ci}.`
  );
  const redisSupported =
    (presets.cloud === 'aws' && presets.orchestrator === 'ecs') ||
    (presets.cloud === 'gcp' && presets.orchestrator === 'cloud-run');
  if (options.database === 'redis' && !redisSupported) {
    notes.push(
      `Redis/Valkey was selected, but this locked ${presets.cloud}/${presets.orchestrator} template does not yet provision a managed cache. Relational DB is disabled (\`enable_database = false\`). Add Memorystore / ElastiCache / Azure Cache before production.`
    );
  }
  if (options.database === 'mysql' && presets.cloud === 'azure') {
    notes.push(
      'MySQL was selected — this Azure locked template provisions PostgreSQL Flexible Server as a validate-safe stand-in. Swap engine before production if MySQL is required.'
    );
  }
  if (
    options.database === 'postgres' &&
    presets.cloud === 'oracle'
  ) {
    notes.push(
      'PostgreSQL was selected — this OKE locked template currently provisions MySQL HeatWave when a database is enabled. Confirm engine before production or extend terraform/database.tf.'
    );
  }
  if (options.runtime === 'java' || options.runtime === 'dotnet') {
    notes.push(
      `${options.runtime === 'java' ? 'Java' : '.NET'} was selected as the **language** only — Spring Boot / ASP.NET were not confirmed. This scaffold keeps a minimal \`/health\` stub in a supported runtime (Node/Python/Go) so image build and probes pass. Replace the stub with your real ${options.runtime} service before production.`
    );
  }
  if (options.database === 'mongodb') {
    notes.push(
      'MongoDB was selected — StackForge does **not** scaffold full MongoDB/DocumentDB/Atlas infrastructure. This scaffold uses a **PostgreSQL** managed database as a validate-safe relational stand-in. Replace with DocumentDB, Atlas, or your own MongoDB after review; do not treat terraform as production MongoDB.'
    );
  }
  // Strip any model-invented MongoDB / DocumentDB / Atlas Terraform files
  for (const p of [...byPath.keys()]) {
    if (
      /mongodb|documentdb|mongodbatlas|mongo[_-]?db/i.test(p) &&
      (p.endsWith('.tf') || p.endsWith('.tfvars') || p.includes('/mongo'))
    ) {
      byPath.delete(p);
    }
  }
  for (const [p, f] of [...byPath.entries()]) {
    if (!p.endsWith('.tf')) continue;
    if (
      !/aws_docdb_|mongodbatlas_|azurerm_cosmosdb_mongo|google_firestore|resource\s+"[^"]*mongo/i.test(
        f.content
      )
    ) {
      continue;
    }
    // Drop DocumentDB / Atlas resource blocks from shared files (keep postgres RDS)
    let c = f.content;
    c = c.replace(
      /resource\s+"(aws_docdb_[^"]+|mongodbatlas_[^"]+|azurerm_cosmosdb_mongo[^"]*)"\s+"[^"]+"\s*\{[\s\S]*?\n\}\n*/g,
      ''
    );
    if (c !== f.content) byPath.set(p, { ...f, content: c });
  }
  if (notes.length) {
    const readme = byPath.get('README.md');
    if (readme) {
      byPath.set('README.md', {
        ...readme,
        content:
          readme.content +
          `\n\n## Scaffold options notes\n\n${notes.map((n) => `- ${n}`).join('\n')}\n`,
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
