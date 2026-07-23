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

/** Drop model-invented sibling app trees and wrong-language leftovers. */
function stripCompetingAppTrees(
  byPath: Map<string, GeneratedFile>,
  runtime?: ScaffoldOptions['runtime']
): void {
  const competingPrefixes = [
    'python-app/',
    'python_app/',
    'nodejs-app/',
    'node-app/',
    'go-app/',
    'golang-app/',
    'java-app/',
    'dotnet-app/',
    'webapp/',
    'web-app/',
    'api-app/',
    'fastapi-app/',
    'express-app/',
  ];
  for (const p of [...byPath.keys()]) {
    if (
      competingPrefixes.some(
        (pre) => p === pre.slice(0, -1) || p.startsWith(pre)
      )
    ) {
      byPath.delete(p);
    }
  }

  const hasAppTree = [...byPath.keys()].some((p) => p.startsWith('app/'));
  if (hasAppTree) {
    for (const p of [...byPath.keys()]) {
      if (!(p === 'src' || p.startsWith('src/'))) continue;
      if (
        /\.(py|js|ts|mjs|cjs|go|java|cs)$/i.test(p) ||
        /(^|\/)(Dockerfile|package\.json|package-lock\.json|requirements\.txt|go\.mod|go\.sum)$/i.test(
          p
        )
      ) {
        byPath.delete(p);
      }
    }
    const rootDupes = [
      'server.js',
      'index.js',
      'app.js',
      'main.js',
      'package.json',
      'package-lock.json',
      'main.py',
      'requirements.txt',
      'main.go',
      'go.mod',
      'go.sum',
      'Dockerfile',
    ];
    for (const p of rootDupes) {
      const inApp =
        p === 'Dockerfile'
          ? byPath.has('app/Dockerfile')
          : byPath.has(`app/${p}`) ||
            (p === 'server.js' &&
              (byPath.has('app/main.py') || byPath.has('app/main.go')));
      if (inApp || (p === 'Dockerfile' && byPath.has('app/Dockerfile'))) {
        byPath.delete(p);
      }
    }
  }

  const drop = (paths: string[]) => {
    for (const p of paths) byPath.delete(p);
  };
  if (runtime === 'python') {
    drop([
      'app/server.js',
      'app/index.js',
      'app/package.json',
      'app/package-lock.json',
      'app/main.go',
      'app/go.mod',
      'app/go.sum',
      'server.js',
      'index.js',
      'package.json',
      'package-lock.json',
      'main.go',
      'go.mod',
      'go.sum',
    ]);
  } else if (runtime === 'go') {
    drop([
      'app/server.js',
      'app/index.js',
      'app/package.json',
      'app/package-lock.json',
      'app/main.py',
      'app/requirements.txt',
      'server.js',
      'index.js',
      'package.json',
      'package-lock.json',
      'main.py',
      'requirements.txt',
    ]);
  } else if (runtime === 'node' || runtime === 'java' || runtime === 'dotnet') {
    drop([
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
    ]);
  }
}

const CI_CANONICAL: Record<CIProvider, string> = {
  'github-actions': '.github/workflows/deploy.yml',
  'gitlab-ci': '.gitlab-ci.yml',
  'azure-devops': 'azure-pipelines.yml',
  jenkins: 'Jenkinsfile',
  'aws-codepipeline': 'buildspec.yml',
  'gcp-cloud-build': 'cloudbuild.yaml',
  'oci-devops': 'build_spec.yaml',
};

export function canonicalCiPath(ci: CIProvider): string {
  return CI_CANONICAL[ci];
}

/** Keep exactly one CI format matching presets.ci. */
export function enforceSingleCi(
  byPath: Map<string, GeneratedFile>,
  ci: CIProvider
): void {
  const keep = CI_CANONICAL[ci];
  const known = new Set(Object.values(CI_CANONICAL));
  for (const p of [...byPath.keys()]) {
    const norm = p.replace(/\\/g, '/');
    if (norm.startsWith('.github/workflows/')) {
      if (ci !== 'github-actions' || norm !== keep) byPath.delete(p);
      continue;
    }
    if (known.has(norm) && norm !== keep) byPath.delete(p);
    if (norm.startsWith('aws-codepipeline/') || norm.startsWith('.devops/')) {
      byPath.delete(p);
    }
  }
}

/**
 * Rewrite profile requiredPaths so completion does not re-demand GitHub Actions
 * when the interview chose GitLab / CodePipeline / etc.
 */
export function adaptRequiredPathsForCi(
  requiredPaths: readonly string[],
  ci: CIProvider
): string[] {
  const keep = CI_CANONICAL[ci];
  const allCi = new Set(Object.values(CI_CANONICAL));
  const out: string[] = [];
  let injected = false;
  for (const p of requiredPaths) {
    const norm = p.replace(/\\/g, '/');
    if (allCi.has(norm) || norm.startsWith('.github/workflows/')) {
      if (!injected) {
        out.push(keep);
        injected = true;
      }
      continue;
    }
    out.push(norm);
  }
  if (!injected) out.push(keep);
  return out;
}

function ciSkeleton(
  ci: CIProvider,
  presets: Presets,
  region: string
): { path: string; content: string } {
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
  environment {
    AWS_REGION = '${region}'
    IMAGE_TAG = "\${env.GIT_COMMIT.take(7)}"
  }
  stages {
    stage('Test') {
      steps { sh 'echo health-stub-ok' }
    }
    stage('Build') {
      steps {
        sh '''
          set -euo pipefail
          if [ -f app/Dockerfile ]; then docker build -t stackforge:\${IMAGE_TAG} ./app
          elif [ -f Dockerfile ]; then docker build -t stackforge:\${IMAGE_TAG} .
          else echo "No Dockerfile found" && exit 1
          fi
        '''
      }
    }
    stage('Push ECR') {
      steps {
        sh '''
          set -euo pipefail
          echo "Configure AWS credentials + aws ecr get-login-password, then docker push"
          echo "Target: ${presets.cloud}/${presets.orchestrator} in \${AWS_REGION}"
        '''
      }
    }
    stage('Deploy Dev') {
      steps { sh 'echo "Update ECS/K8s service in development (wire AWS CLI / kubectl here)"' }
    }
    stage('Approve Staging') {
      steps { input message: 'Promote to staging?' }
    }
    stage('Deploy Staging') {
      steps { sh 'echo "Deploy staging"' }
    }
    stage('Approve Production') {
      steps { input message: 'Promote to production?' }
    }
    stage('Deploy Production') {
      steps { sh 'echo "Deploy production"' }
    }
  }
  post {
    failure {
      echo 'Deployment failed — roll back via ECS circuit breaker / previous task definition'
    }
  }
}
`,
      };
    case 'aws-codepipeline':
      return {
        path: 'buildspec.yml',
        content: `version: 0.2
env:
  variables:
    AWS_DEFAULT_REGION: ${region}
phases:
  pre_build:
    commands:
      - echo Logging in to Amazon ECR...
      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com
      - REPOSITORY_URI=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$ECR_REPOSITORY
      - IMAGE_TAG=\${CODEBUILD_RESOLVED_SOURCE_VERSION:-latest}
  build:
    commands:
      - echo Build started on $(date)
      - |
        if [ -f app/Dockerfile ]; then
          docker build -t $REPOSITORY_URI:$IMAGE_TAG ./app
        elif [ -f Dockerfile ]; then
          docker build -t $REPOSITORY_URI:$IMAGE_TAG .
        else
          echo "No Dockerfile found" && exit 1
        fi
  post_build:
    commands:
      - echo Pushing image...
      - docker push $REPOSITORY_URI:$IMAGE_TAG
      - printf '[{"name":"app","imageUri":"%s"}]' $REPOSITORY_URI:$IMAGE_TAG > imagedefinitions.json
      - echo "Update ECS service with new task definition image after pipeline deploy stage"
artifacts:
  files:
    - imagedefinitions.json
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
timeoutInSeconds: 1200
steps:
  - type: Command
    name: BuildAndPush
    command: |
      set -euo pipefail
      echo "OCI DevOps build — push image then deploy to ${presets.orchestrator} on ${presets.cloud}"
      if [ -f app/Dockerfile ]; then
        docker build -t app:local ./app
      elif [ -f Dockerfile ]; then
        docker build -t app:local .
      else
        echo "No Dockerfile found" && exit 1
      fi
      echo "Configure OCIR push + OKE deploy credentials in the OCI DevOps pipeline UI"
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

  // CI swap — exactly one pipeline format for the chosen provider
  const ciPaths = [
    '.github/workflows/deploy.yml',
    '.gitlab-ci.yml',
    'azure-pipelines.yml',
    'Jenkinsfile',
    'buildspec.yml',
    'cloudbuild.yaml',
    'build_spec.yaml',
  ];
  const chosen = ciSkeleton(presets.ci, presets, options.region);
  const existingGha =
    presets.ci === 'github-actions'
      ? byPath.get('.github/workflows/deploy.yml')
      : undefined;
  for (const p of ciPaths) byPath.delete(p);
  for (const p of [...byPath.keys()]) {
    if (p.startsWith('.github/workflows/')) byPath.delete(p);
    if (p.startsWith('aws-codepipeline/')) byPath.delete(p);
    if (p.startsWith('.devops/')) byPath.delete(p);
  }
  if (presets.ci === 'github-actions' && existingGha) {
    let w = existingGha.content;
    w = w.replace(
      /AWS_REGION:\s*\$\{\{\s*vars\.AWS_REGION\s*\|\|\s*'[^']+'\s*\}\}/g,
      `AWS_REGION: \${{ vars.AWS_REGION || '${options.region}' }}`
    );
    w = w.replace(
      /aws-region:\s*\$\{\{\s*env\.AWS_REGION\s*\}\}/g,
      'aws-region: ${{ env.AWS_REGION }}'
    );
    byPath.set('.github/workflows/deploy.yml', { ...existingGha, content: w });
  } else if (presets.ci === 'gcp-cloud-build' && presets.orchestrator === 'gke') {
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
  // OCI DevOps expects build + per-env deploy specs (plan file manifest).
  if (presets.ci === 'oci-devops') {
    const deployBody = (env: string) => `version: 0.1
component: deploy
timeoutInSeconds: 900
steps:
  - type: Command
    name: HelmUpgrade${env[0].toUpperCase()}${env.slice(1)}
    command: |
      set -euo pipefail
      echo "Deploying to OKE namespace ${env} via helm upgrade --install"
      if [ -d charts/app ]; then
        helm upgrade --install app charts/app \\
          --namespace ${env} --create-namespace \\
          --set image.tag=\${OCI_IMAGE_TAG:-latest} \\
          --wait --timeout 10m
      else
        echo "charts/app missing — add Helm chart before production deploy"
        exit 1
      fi
`;
    set(byPath, 'deploy_dev_spec.yaml', deployBody('development'));
    set(byPath, 'deploy_staging_spec.yaml', deployBody('staging'));
    set(byPath, 'deploy_prod_spec.yaml', deployBody('production'));
  } else {
    for (const p of [
      'deploy_dev_spec.yaml',
      'deploy_staging_spec.yaml',
      'deploy_prod_spec.yaml',
    ]) {
      byPath.delete(p);
    }
  }
  enforceSingleCi(byPath, presets.ci);

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

  // Node runtime — also used as validate-safe stand-in for Java / .NET (language only)
  if (
    options.runtime === 'node' ||
    options.runtime === 'java' ||
    options.runtime === 'dotnet'
  ) {
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

  // After runtime swap: one app tree + one language only (any prompt/option mix)
  stripCompetingAppTrees(byPath, options.runtime);
  enforceSingleCi(byPath, presets.ci);

  // Capability honesty — document unsupported DB/runtime for this cloud profile
  const notes: string[] = [];
  notes.push(
    `Applied from interview: region=${options.region}; envs=${options.environments.join(', ')}; access=${options.access}; database=${options.database}; scale=${options.scale}; runtime=${options.runtime}; ci=${presets.ci}.`
  );
  if (options.access === 'public_https' || options.access === 'public_basic') {
    notes.push(
      `Access is **public** (internet-facing load balancer / ingress). This locked template uses an **HTTP:80** listener by default so \`terraform validate\` stays certificate-free. For production HTTPS, attach an ACM (or cloud-equivalent) certificate and an HTTPS:443 listener — do not treat HTTP:80 as the final product choice.`
    );
  }
  if (options.access === 'private') {
    notes.push(
      'Access is **private** (internal ALB / ingress disabled or private networking). Confirm VPC/VPN/private DNS before exposing the service.'
    );
  }
  if (presets.ci === 'aws-codepipeline') {
    notes.push(
      'CI is **AWS CodePipeline / CodeBuild** (`buildspec.yml` only). Competing formats (GitHub Actions, GitLab CI, etc.) are intentionally omitted — wire Source → CodeBuild → ECS/EKS deploy in the AWS console or extra Terraform.'
    );
  } else if (presets.ci !== 'github-actions') {
    notes.push(
      `CI is **${presets.ci}** only (\`${CI_CANONICAL[presets.ci]}\`). Other pipeline formats are omitted so the scaffold matches the interview choice.`
    );
  }
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
      options.runtime === 'java'
        ? 'Java was selected as the **language** only — Spring Boot / Quarkus were not confirmed. This scaffold keeps a minimal `/health` stub in a supported runtime (Node/Python/Go) so image build and probes pass. Replace the stub with your real Java service before production.'
        : '.NET was selected as the **language** only — ASP.NET Controllers/Services were not confirmed. This scaffold keeps a minimal `/health` stub in a supported runtime (Node/Python/Go) so image build and probes pass. Replace the stub with your real .NET service before production.'
    );
  }
  if (options.database === 'mongodb') {
    notes.push(
      'MongoDB was selected — StackForge does **not** scaffold full MongoDB/DocumentDB/Atlas infrastructure. This scaffold uses a **PostgreSQL** managed database as a validate-safe relational stand-in (`enable_database = true`, engine postgres). Replace with DocumentDB, Atlas, or your own MongoDB after review; do not treat terraform as production MongoDB.'
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
      // Drop prior notes blocks so multi-pass apply does not triple-append
      let base = readme.content
        .replace(/\n*## Scaffold options notes\n[\s\S]*$/i, '')
        .trimEnd();
      // Model often hardcodes "GitHub Actions" in the intro — rewrite to chosen CI.
      if (presets.ci !== 'github-actions') {
        const ciLabel =
          presets.ci === 'jenkins'
            ? 'Jenkins'
            : presets.ci === 'oci-devops'
              ? 'OCI DevOps'
              : presets.ci === 'gitlab-ci'
                ? 'GitLab CI'
                : presets.ci === 'azure-devops'
                  ? 'Azure DevOps'
                  : presets.ci === 'aws-codepipeline'
                    ? 'AWS CodePipeline'
                    : presets.ci === 'gcp-cloud-build'
                      ? 'Google Cloud Build'
                      : presets.ci;
        base = base
          .replace(/Terraform\s*\+\s*GitHub Actions\s*\+/gi, `Terraform + ${ciLabel} +`)
          .replace(/\bGitHub Actions\b/gi, ciLabel);
      }
      byPath.set('README.md', {
        ...readme,
        content:
          base +
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
