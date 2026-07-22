#!/usr/bin/env node
/**
 * Options matrix QA — dynamic interview → locked scaffold wiring.
 * Run: npm run qa:options-matrix
 *
 * Does not call Gemini. For each case: infer presets, detect profile,
 * merge locked base + applyScaffoldOptions, assert CI / runtime / DB / region.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const runner = `
import { detectScaffoldProfile } from '../lib/scaffold-spec.ts';
import { mergeLockedBaseFiles } from '../lib/scaffold-base-files.ts';
import { inferPresetsFromPrompt } from '../lib/infer-presets.ts';
import { parseScaffoldOptions } from '../lib/scaffold-options.ts';
import type { Presets } from '../types/index.ts';

type Expect = {
  profile: string;
  cloud: Presets['cloud'];
  orch: string;
  ciFile: string; // path that must exist
  absentCi?: string[];
  region: string;
  envs: string[];
  runtimeFile: string; // e.g. main.go or app/main.py
  absentRuntime?: string[];
  tfvarsIncludes?: string[];
  tfvarsExcludes?: string[];
  readmeIncludes?: string[];
};

const CASES: Array<{ name: string; prompt: string; presets: Presets; expect: Expect }> = [
  {
    name: 'Cloud Run override + Jenkins + Redis HA + Go + public',
    prompt: \`A .NET API on Azure AKS with Jenkins and Redis.
Google Cloud. Hosting platform (client override): Google Cloud Run.
us-central1. Development, staging, and production. Public with secure HTTPS.
How should Redis/Valkey be configured: High availability. Go\`,
    presets: { cloud: 'azure', orchestrator: 'aks', ci: 'jenkins' },
    expect: {
      profile: 'gcp-fastapi-cloudrun',
      cloud: 'gcp',
      orch: 'cloud-run',
      ciFile: 'Jenkinsfile',
      absentCi: ['.gitlab-ci.yml', '.github/workflows/deploy.yml'],
      region: 'us-central1',
      envs: ['development', 'staging', 'production'],
      runtimeFile: 'main.go',
      absentRuntime: ['main.py', 'requirements.txt'],
      tfvarsIncludes: [
        'allow_public_access = true',
        'enable_redis = true',
        'enable_database = false',
        'redis_ha = true',
      ],
    },
  },
  {
    name: 'GKE + Cloud Build + Python + MongoDB note + one env + private',
    prompt: \`Build me a cloud app. Google Cloud. Google Kubernetes Engine (GKE).
europe-west1. Google Cloud Build. One environment. Private and internal only.
Data service (client override): MongoDB. Python\`,
    presets: { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' },
    expect: {
      profile: 'gcp-gke-helm',
      cloud: 'gcp',
      orch: 'gke',
      ciFile: 'cloudbuild.yaml',
      absentCi: ['.github/workflows/deploy.yml'],
      region: 'europe-west1',
      envs: ['staging'],
      runtimeFile: 'app/main.py',
      absentRuntime: ['app/server.js'],
      tfvarsIncludes: ['enable_database = true', 'db_engine = "postgres"'],
      readmeIncludes: ['MongoDB'],
    },
  },
  {
    name: 'ECS + MySQL + private + small + GHA',
    prompt: \`Express app on AWS ECS Fargate. us-east-1. Development, staging, and production.
Private and internal only. MySQL. Small — 2 app copies\`,
    presets: { cloud: 'aws', orchestrator: 'ecs', ci: 'github-actions' },
    expect: {
      profile: 'aws-ecs-express',
      cloud: 'aws',
      orch: 'ecs',
      ciFile: '.github/workflows/deploy.yml',
      region: 'us-east-1',
      envs: ['development', 'staging', 'production'],
      runtimeFile: 'app/server.js',
      tfvarsIncludes: [
        'desired_count = 2',
        'alb_internal = true',
        'db_engine = "mysql"',
        'enable_database = true',
      ],
    },
  },
  {
    name: 'ECS + Redis cache + private + high + GHA',
    prompt: \`An Express app on AWS ECS Fargate behind an Application Load Balancer with ECR, CloudWatch logging, and a GitHub Actions workflow.
us-east-1. Development, staging, and production. Private and internal only.
Redis cache. High traffic — automatic scaling. Node.js\`,
    presets: { cloud: 'aws', orchestrator: 'ecs', ci: 'github-actions' },
    expect: {
      profile: 'aws-ecs-express',
      cloud: 'aws',
      orch: 'ecs',
      ciFile: '.github/workflows/deploy.yml',
      region: 'us-east-1',
      envs: ['development', 'staging', 'production'],
      runtimeFile: 'app/server.js',
      tfvarsIncludes: [
        'desired_count = 4',
        'alb_internal = true',
        'enable_redis = true',
        'enable_database = false',
      ],
      tfvarsExcludes: ['enable_database = true', 'db_engine'],
    },
  },
  {
    name: 'Confirmed choices block (interviewAnswers) → Redis + high',
    prompt: \`An Express app on AWS ECS Fargate

Confirmed choices:
1. Where should we host it
   → us-east-1
2. Which environments do you need
   → Development, staging, and production
3. Who should be able to access the API
   → Private and internal only
4. Does the service need stored data or a cache
   → Redis cache
5. How much traffic should we plan for
   → High traffic — automatic scaling\`,
    presets: { cloud: 'aws', orchestrator: 'ecs', ci: 'github-actions' },
    expect: {
      profile: 'aws-ecs-express',
      cloud: 'aws',
      orch: 'ecs',
      ciFile: '.github/workflows/deploy.yml',
      region: 'us-east-1',
      envs: ['development', 'staging', 'production'],
      runtimeFile: 'app/server.js',
      tfvarsIncludes: [
        'desired_count = 4',
        'alb_internal = true',
        'enable_redis = true',
        'enable_database = false',
      ],
    },
  },
  {
    name: 'EKS + GitLab CI + Postgres + public + medium',
    prompt: \`Node API on Amazon EKS. eu-west-1. Development, staging, and production.
Public with secure HTTPS. PostgreSQL. Medium — 3 to 5 app copies.
CI/CD system (client override): GitLab CI\`,
    presets: { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' },
    expect: {
      profile: 'aws-eks-helm',
      cloud: 'aws',
      orch: 'eks',
      ciFile: '.gitlab-ci.yml',
      absentCi: ['.github/workflows/deploy.yml'],
      region: 'eu-west-1',
      envs: ['development', 'staging', 'production'],
      runtimeFile: 'app/server.js',
      tfvarsIncludes: [
        'node_desired_size = 3',
        'enable_database = true',
        'db_engine = "postgres"',
      ],
    },
  },
  {
    name: 'ACA + Azure DevOps + no DB + small + private',
    prompt: \`Go API on Azure Container Apps. westeurope. One environment.
Private and internal only. No data service. Small — 2 app copies. Go\`,
    presets: { cloud: 'azure', orchestrator: 'container-apps', ci: 'azure-devops' },
    expect: {
      profile: 'azure-go-container-apps',
      cloud: 'azure',
      orch: 'container-apps',
      ciFile: 'azure-pipelines.yml',
      region: 'westeurope',
      envs: ['staging'],
      runtimeFile: 'main.go',
      tfvarsIncludes: [
        'enable_database = false',
        'ingress_external = false',
        'min_replicas = 2',
        'max_replicas = 4',
      ],
    },
  },
  {
    name: 'ECS → OKE override + MySQL + high scale',
    prompt: \`Java Spring Boot on Amazon ECS. Oracle Cloud Infrastructure.
Hosting platform (client override): Oracle Kubernetes Engine (OKE).
eu-frankfurt-1. Development, staging, and production. Public without a custom domain.
Standard private database. MySQL. High traffic — automatic scaling\`,
    presets: { cloud: 'aws', orchestrator: 'ecs', ci: 'github-actions' },
    expect: {
      profile: 'oracle-oke-helm',
      cloud: 'oracle',
      orch: 'oke',
      ciFile: '.github/workflows/deploy.yml',
      region: 'eu-frankfurt-1',
      envs: ['development', 'staging', 'production'],
      runtimeFile: 'app/server.js',
      tfvarsIncludes: ['node_pool_size = 4', 'enable_database = true', 'db_engine = "mysql"'],
    },
  },
  {
    name: 'OKE → AKS override + one env + postgres note path',
    prompt: \`Node.js on Oracle OKE. Microsoft Azure.
Hosting platform (client override): Azure Kubernetes Service (AKS).
centralindia. One environment. Public without a custom domain.
Standard private database. High traffic — automatic scaling. Node.js\`,
    presets: { cloud: 'oracle', orchestrator: 'oke', ci: 'github-actions' },
    expect: {
      profile: 'azure-aks-helm',
      cloud: 'azure',
      orch: 'aks',
      ciFile: '.github/workflows/deploy.yml',
      region: 'centralindia',
      envs: ['staging'],
      runtimeFile: 'app/server.js',
      tfvarsIncludes: ['node_count = 4', 'enable_database = true'],
      tfvarsExcludes: ['ingress_external'],
    },
  },
  {
    name: 'Azure ACA Go + private + postgres backups',
    prompt: \`Go backend on Azure Container Apps with PostgreSQL and Azure DevOps.
westeurope. Development and staging. Private and internal only.
Private database with 7-day automatic backups. Small — 2 app copies\`,
    presets: { cloud: 'azure', orchestrator: 'container-apps', ci: 'azure-devops' },
    expect: {
      profile: 'azure-go-container-apps',
      cloud: 'azure',
      orch: 'container-apps',
      ciFile: 'azure-pipelines.yml',
      region: 'westeurope',
      envs: ['development', 'staging'],
      runtimeFile: 'main.go',
      tfvarsIncludes: [
        'ingress_external = false',
        'backup_retention_days = 7',
        'min_replicas = 2',
        'enable_database = true',
      ],
    },
  },
  {
    name: 'EKS Redis request → honest README note',
    prompt: \`Node.js REST API on AWS EKS with Redis cache and GitHub Actions. us-west-2. One environment. Public with secure HTTPS. Redis. Node.js\`,
    presets: { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' },
    expect: {
      profile: 'aws-eks-helm',
      cloud: 'aws',
      orch: 'eks',
      ciFile: '.github/workflows/deploy.yml',
      region: 'us-west-2',
      envs: ['staging'],
      runtimeFile: 'app/server.js',
      tfvarsIncludes: ['enable_database = false'],
      tfvarsExcludes: ['enable_redis = true'],
      readmeIncludes: ['Redis'],
    },
  },
];

let fail = 0;
for (const c of CASES) {
  const presets = inferPresetsFromPrompt(c.prompt, c.presets);
  const profile = detectScaffoldProfile(c.prompt, presets);
  const options = parseScaffoldOptions(c.prompt, presets);
  const issues: string[] = [];

  if (presets.cloud !== c.expect.cloud) issues.push(\`cloud=\${presets.cloud}\`);
  if (presets.orchestrator !== c.expect.orch) issues.push(\`orch=\${presets.orchestrator}\`);
  if (profile?.id !== c.expect.profile) issues.push(\`profile=\${profile?.id}\`);
  if (options.region !== c.expect.region) issues.push(\`region=\${options.region}\`);
  if (options.environments.join(',') !== c.expect.envs.join(',')) {
    issues.push(\`envs=\${options.environments.join(',')}\`);
  }

  const merged = mergeLockedBaseFiles([], profile!, {
    fillMissing: true,
    forceStubs: true,
    presets,
    scaffoldOptions: options,
  });
  const paths = new Set(merged.files.map((f) => f.path));
  const blob = Object.fromEntries(merged.files.map((f) => [f.path, f.content]));

  if (!paths.has(c.expect.ciFile)) issues.push(\`missing CI \${c.expect.ciFile}\`);
  for (const p of c.expect.absentCi || []) {
    if (paths.has(p)) issues.push(\`unexpected CI \${p}\`);
  }
  if (!paths.has(c.expect.runtimeFile)) issues.push(\`missing runtime \${c.expect.runtimeFile}\`);
  for (const p of c.expect.absentRuntime || []) {
    if (paths.has(p)) issues.push(\`unexpected runtime \${p}\`);
  }

  const envFile = \`environments/\${c.expect.envs[0]}.tfvars\`;
  const tfv = blob[envFile] || '';
  if (!tfv) issues.push(\`missing \${envFile}\`);
  for (const needle of c.expect.tfvarsIncludes || []) {
    if (!tfv.includes(needle)) issues.push(\`tfvars missing \${needle}\`);
  }
  for (const needle of c.expect.tfvarsExcludes || []) {
    if (tfv.includes(needle)) issues.push(\`tfvars has \${needle}\`);
  }
  // Extra env files
  for (const p of paths) {
    if (!p.startsWith('environments/') || !p.endsWith('.tfvars')) continue;
    const env = p.replace('environments/', '').replace('.tfvars', '');
    if (!c.expect.envs.includes(env)) issues.push(\`extra env \${p}\`);
  }

  const readme = blob['README.md'] || '';
  for (const needle of c.expect.readmeIncludes || []) {
    if (!readme.includes(needle)) issues.push(\`README missing \${needle}\`);
  }

  if (issues.length) {
    fail++;
    console.error(\`FAIL  \${c.name}\`);
    for (const i of issues) console.error(\`  - \${i}\`);
  } else {
    console.log(\`PASS  \${c.name}\`);
  }
}

if (fail) {
  console.error(\`\\nOptions matrix FAILED (\${fail})\`);
  process.exit(1);
}
console.log('\\nOptions matrix PASSED — dynamic CI/runtime/DB/region wiring OK.');
`;

const tmp = path.join(root, 'scripts', '_qa-options-matrix-runner.mts');
fs.writeFileSync(tmp, runner, 'utf8');
const r = spawnSync('npx', ['--yes', 'tsx', tmp], {
  cwd: root,
  encoding: 'utf8',
  shell: true,
});
try {
  fs.unlinkSync(tmp);
} catch {
  /* ignore */
}
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
process.exit(r.status ?? 1);
