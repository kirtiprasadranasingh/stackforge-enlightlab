#!/usr/bin/env node
/**
 * Options matrix QA — dynamic interview → locked scaffold wiring.
 * Run: npm run qa:options-matrix
 *
 * Does not call Gemini. For each case: infer presets, detect profile,
 * merge locked base + applyScaffoldOptions, assert CI / runtime / DB / region.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createJiti } from 'jiti';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const runner = `
import { detectScaffoldProfile } from '../lib/scaffold-spec.ts';
import { mergeLockedBaseFiles } from '../lib/scaffold-base-files.ts';
import { inferPresetsFromPrompt } from '../lib/infer-presets.ts';
import { parseScaffoldOptions } from '../lib/scaffold-options.ts';
import { buildClarifyingQuestions } from '../lib/clarifying-questions.ts';
import { requiresPlanApproval } from '../lib/stack-intent.ts';
import { validateScaffoldContract } from '../lib/scaffold-contract.ts';
import { buildArchitectureSpec, createRequirementsManifest, generatedFilePathsForSpec, readRequirementsManifest, validatePlanAgainstSpec } from '../lib/architecture-spec.ts';
import { sanitizePlanAgainstInterview } from '../lib/sanitize-plan.ts';
import { normalizeScaffoldFiles } from '../lib/normalize-scaffold.ts';
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
      envs: ['development'],
      runtimeFile: 'app/main.py',
      absentRuntime: ['app/server.js'],
      tfvarsIncludes: ['enable_database = false'],
      tfvarsExcludes: ['db_engine'],
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
    name: 'Reported case: ECS + Redis + Python + public ALB + GitHub Actions',
    prompt: \`AWS ECS Fargate API. ap-south-1. Development, staging, and production.
Public without a custom domain. Redis cache. Python. GitHub Actions\`,
    presets: { cloud: 'aws', orchestrator: 'ecs', ci: 'github-actions' },
    expect: {
      profile: 'aws-ecs-express',
      cloud: 'aws',
      orch: 'ecs',
      ciFile: '.github/workflows/deploy.yml',
      region: 'ap-south-1',
      envs: ['development', 'staging', 'production'],
      runtimeFile: 'app/main.py',
      absentRuntime: ['app/server.js', 'app/package.json', 'app/package-lock.json'],
      tfvarsIncludes: ['enable_redis = true', 'enable_database = false'],
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
      envs: ['development'],
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
      runtimeFile: 'app/src/main/java/com/example/health/Application.java',
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
      envs: ['development'],
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
      envs: ['development'],
      runtimeFile: 'app/server.js',
      tfvarsIncludes: ['enable_database = false', 'enable_redis = true'],
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
  const intentionallyBlocked =
    options.database === 'redis' && presets.cloud === 'aws' && presets.orchestrator === 'eks';
  if (!intentionallyBlocked) {
    for (const contractIssue of validateScaffoldContract(merged.files, presets, options)) {
      issues.push(\`contract: \${contractIssue}\`);
    }
  }

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

const inheritedRuntime = buildArchitectureSpec({
  prompt: 'Build AWS EKS with Java and Redis',
  interviewAnswers: 'us-east-1. Development, staging, and production. Private and internal only. High traffic — automatic scaling.',
  presets: { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' },
});
if (inheritedRuntime.options.runtime !== 'java') {
  fail++;
  console.error(\`FAIL  prompt runtime survives interview: got \${inheritedRuntime.options.runtime}, want java\`);
} else {
  console.log('PASS  prompt runtime survives interview');
}
if (inheritedRuntime.issues.length) {
  fail++;
  console.error(\`FAIL  AWS EKS Redis capability: \${inheritedRuntime.issues.join('; ')}\`);
} else {
  console.log('PASS  AWS EKS Redis capability');
}

const javaEks = buildArchitectureSpec({
  prompt: 'Build AWS EKS infrastructure with Java. No data service.',
  interviewAnswers: 'us-east-1. Development, staging, and production. Private and internal only. High traffic — automatic scaling.',
  presets: { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' },
});
const javaEksProfile = detectScaffoldProfile(javaEks.source, javaEks.presets)!;
const javaEksFiles = mergeLockedBaseFiles([], javaEksProfile, {
  fillMissing: true,
  forceStubs: true,
  presets: javaEks.presets,
  scaffoldOptions: javaEks.options,
}).files;
const manifest = createRequirementsManifest(javaEks);
const contractFiles = [...javaEksFiles, manifest];
const manifestValue = readRequirementsManifest(contractFiles);
const javaIssues = validateScaffoldContract(contractFiles, javaEks.presets, javaEks.options);
if (manifestValue?.options.runtime !== 'java' || javaIssues.length) {
  fail++;
  console.error(\`FAIL  EKS Java semantic contract: \${javaIssues.join('; ') || 'manifest lost Java'}\`);
} else {
  console.log('PASS  EKS Java semantic contract');
}
const brokenJavaFiles = contractFiles.map((file) =>
  file.path === 'app/Dockerfile'
    ? { ...file, content: 'FROM node:20-alpine\\nEXPOSE 3000\\n' }
    : file
);
if (!validateScaffoldContract(brokenJavaFiles, javaEks.presets, javaEks.options).some((issue) => /Java runtime Dockerfile/.test(issue))) {
  fail++;
  console.error('FAIL  semantic contract rejects a Node Dockerfile for Java');
} else {
  console.log('PASS  semantic contract rejects a Node Dockerfile for Java');
}

const javaRedisEks = buildArchitectureSpec({
  prompt: 'Build production AWS EKS infrastructure with Java and Redis.',
  interviewAnswers: 'us-east-1. Development, staging, and production. Private and internal only. Private database with 7-day automatic backups. High traffic — automatic scaling.',
  presets: { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' },
});
const javaRedisFiles = mergeLockedBaseFiles([], detectScaffoldProfile(javaRedisEks.source, javaRedisEks.presets)!, {
  fillMissing: true,
  forceStubs: true,
  presets: javaRedisEks.presets,
  scaffoldOptions: javaRedisEks.options,
}).files;
const javaRedisIssues = validateScaffoldContract(javaRedisFiles, javaRedisEks.presets, javaRedisEks.options);
if (
  javaRedisEks.options.runtime !== 'java' ||
  javaRedisEks.options.database !== 'redis' ||
  javaRedisEks.options.databaseMode !== 'ha_backup' ||
  javaRedisIssues.length
) {
  fail++;
  console.error(\`FAIL  EKS Java + Redis semantic contract: \${javaRedisIssues.join('; ') || JSON.stringify(javaRedisEks.options)}\`);
} else {
  console.log('PASS  EKS Java + Redis semantic contract');
}

const privateEksTerraform = javaRedisFiles.find((file) => file.path === 'terraform/eks.tf')?.content || '';
if (!/endpoint_public_access\\s*=\\s*false/.test(privateEksTerraform)) {
  fail++;
  console.error('FAIL  private EKS keeps a public control-plane endpoint');
} else {
  console.log('PASS  private EKS disables public control-plane endpoint');
}

const validatedJavaRedisFiles = normalizeScaffoldFiles(
  [...javaRedisFiles, createRequirementsManifest(javaRedisEks)],
  {
    applyLockedProfile: true,
    terraformOnly: true,
    presets: javaRedisEks.presets,
    scaffoldOptions: javaRedisEks.options,
  }
);
const validateRepairIssues = validateScaffoldContract(
  validatedJavaRedisFiles,
  javaRedisEks.presets,
  javaRedisEks.options
);
if (validateRepairIssues.length) {
  fail++;
  console.error(\`FAIL  validation repair preserves Java runtime: \${validateRepairIssues.join('; ')}\`);
} else {
  console.log('PASS  validation repair preserves Java runtime');
}

const staleEksPlan = \`## Confirmed requirements
- AWS EKS in us-east-1 with GitHub Actions, Redis cache, Java, development, staging, and production.
## Assumptions
- The locked AWS ECS template uses Terraform random_password for RDS.
- Health-check runtime was not confirmed in the interview. Node.js is a default scaffold placeholder.
## CI/CD
- GitHub Actions deploys to EKS.
\`;
const cleanedEksPlan = sanitizePlanAgainstInterview(staleEksPlan, javaRedisEks.source, javaRedisEks.presets);
const planIssues = validatePlanAgainstSpec(cleanedEksPlan, javaRedisEks);
if (/AWS ECS template|Node\.js is a default scaffold placeholder/i.test(cleanedEksPlan) || planIssues.length) {
  fail++;
  console.error(\`FAIL  EKS plan cleanup: \${planIssues.join('; ') || cleanedEksPlan}\`);
} else {
  console.log('PASS  EKS plan cleanup removes ECS/Node leakage');
}

const stalePrivateEksPlan = [
  '## Confirmed requirements',
  '- AWS EKS in us-east-1 with GitHub Actions, Redis cache, Java, development, staging, and production.',
  '## Architecture',
  '- An internal AWS Application Load Balancer (ALB) provides private access through the AWS Load Balancer Controller.',
  '- IRSA and pod identity roles are configured for the application.',
  '## File manifest',
  '- terraform/ecr.tf',
  '- terraform/rds.tf',
  '- terraform/alb.tf',
  '- terraform/alb_controller.tf',
].join('\\n');
const cleanedPrivateEksPlan = sanitizePlanAgainstInterview(
  stalePrivateEksPlan,
  javaRedisEks.source,
  javaRedisEks.presets
);
const privateEksPlanIssues = validatePlanAgainstSpec(cleanedPrivateEksPlan, javaRedisEks);
const privateEksUnshippedPromise = cleanedPrivateEksPlan
  .split('\\n')
  .some((line) => /Application Load Balancer|Load Balancer Controller|IRSA|pod identity/i.test(line) && !line.includes('does **not**'));
if (
  privateEksUnshippedPromise ||
  ['terraform/alb.tf', 'terraform/alb_controller.tf'].some((marker) => cleanedPrivateEksPlan.includes(marker)) ||
  !cleanedPrivateEksPlan.includes('ClusterIP') ||
  !cleanedPrivateEksPlan.includes('terraform/main.tf') ||
  !cleanedPrivateEksPlan.includes('terraform/redis.tf') ||
  privateEksPlanIssues.length
) {
  fail++;
  console.error('FAIL  EKS private plan-to-code boundary: ' + (privateEksPlanIssues.join('; ') || cleanedPrivateEksPlan));
} else {
  console.log('PASS  EKS private plan only promises generated delivery');
}

const publicHttpsEks = buildArchitectureSpec({
  prompt: 'Build production AWS EKS infrastructure with Java and Redis.',
  interviewAnswers: 'us-east-1. Production only. Public with secure HTTPS and a custom domain. Private database with 7-day automatic backups. High traffic — automatic scaling.',
  presets: { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' },
});
const stalePublicHttpsEksPlan = [
  '## Confirmed requirements',
  '- AWS EKS in us-east-1 with GitHub Actions, Redis, Java, and production.',
  '## Architecture',
  '- Kubernetes Service LoadBalancer with secure HTTPS handled via a custom domain and AWS Certificate Manager (ACM).',
  '- Route 53 DNS record and ACM certificate will be created by Terraform.',
  '- Cluster Autoscaler will scale EKS nodes.',
  '## File manifest',
  '- java-app/src/main/java/com/stackforge/HealthCheckServer.java',
  '- terraform/vpc.tf',
  '- terraform/elasticache.tf',
].join('\\n');
const cleanedPublicHttpsEksPlan = sanitizePlanAgainstInterview(
  stalePublicHttpsEksPlan,
  publicHttpsEks.source,
  publicHttpsEks.presets
);
const publicHttpsPlanIssues = validatePlanAgainstSpec(cleanedPublicHttpsEksPlan, publicHttpsEks);
const stalePublicHttpsMarkers = [
  'ACM certificate will be created',
  'Route 53 DNS record',
  'Cluster Autoscaler will',
  'java-app/',
  'terraform/vpc.tf',
  'terraform/elasticache.tf',
];
if (
  stalePublicHttpsMarkers.some((marker) => cleanedPublicHttpsEksPlan.includes(marker)) ||
  !cleanedPublicHttpsEksPlan.includes('does **not** create a custom domain') ||
  !cleanedPublicHttpsEksPlan.includes('app/src/main/java/com/example/health/Application.java') ||
  publicHttpsPlanIssues.length
) {
  fail++;
  console.error('FAIL  EKS custom HTTPS plan-to-code boundary: ' + (publicHttpsPlanIssues.join('; ') || cleanedPublicHttpsEksPlan));
} else {
  console.log('PASS  EKS custom HTTPS plan only promises generated delivery');
}

const azureOverride = buildArchitectureSpec({
  prompt: 'Generate AWS EKS stack with Python',
  interviewAnswers: 'Microsoft Azure. Hosting platform (client override): Azure Container Apps. westeurope. Development and staging. Public HTTP on the default load-balancer hostname. MySQL. Medium — 3 to 5 app copies.',
  presets: { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' },
});

const gkeGitlab = buildArchitectureSpec({
  prompt: 'Secure Google Cloud GKE application',
  interviewAnswers: 'GitLab CI. us-central1. Production only. Public HTTP on the default load-balancer hostname. PostgreSQL. Java.',
  presets: { cloud: 'gcp', orchestrator: 'gke', ci: 'github-actions' },
});

const cloudRunDotnet = buildArchitectureSpec({
  prompt: 'Google Cloud Run .NET service',
  interviewAnswers: 'europe-west1. Staging only. Private and internal only. PostgreSQL. .NET.',
  presets: { cloud: 'gcp', orchestrator: 'cloud-run', ci: 'github-actions' },
});
const cloudRunDotnetManifest = generatedFilePathsForSpec(cloudRunDotnet);
if (
  !['Dockerfile', 'Program.cs', 'app.csproj'].every((path) => cloudRunDotnetManifest.includes(path)) ||
  ['app/Dockerfile', 'app/Program.cs', 'app/app.csproj'].some((path) => cloudRunDotnetManifest.includes(path))
) {
  fail++;
  console.error('FAIL  Cloud Run .NET manifest uses an intermediate app/ layout');
} else {
  console.log('PASS  Cloud Run .NET manifest matches final root layout');
}
const gkeGitlabFiles = mergeLockedBaseFiles(
  [],
  detectScaffoldProfile(gkeGitlab.source, gkeGitlab.presets)!,
  { fillMissing: true, forceStubs: true, presets: gkeGitlab.presets, scaffoldOptions: gkeGitlab.options }
).files;
const gkeGitlabManifest = generatedFilePathsForSpec(gkeGitlab);
const gkeValues = gkeGitlabFiles.find((file) => file.path === 'charts/app/values.yaml')?.content || '';
const gkePipeline = gkeGitlabFiles.find((file) => file.path === '.gitlab-ci.yml')?.content || '';
const gkeMain = gkeGitlabFiles.find((file) => file.path === 'terraform/main.tf')?.content || '';
if (
  gkeGitlab.presets.ci !== 'gitlab-ci' ||
  !gkeGitlabManifest.includes('.gitlab-ci.yml') ||
  gkeGitlabManifest.some((path) => path.startsWith('.github/workflows/')) ||
  !gkeValues.includes('className: gce') ||
  !gkePipeline.includes('docker build -t') ||
  !gkePipeline.includes('helm upgrade --install') ||
  !gkeMain.includes('google_artifact_registry_repository')
) {
  fail++;
  console.error('FAIL  GKE GitLab manifest/ingress/pipeline contract');
} else {
  console.log('PASS  GKE GitLab manifest/ingress/pipeline contract');
}

const gkeRedis = buildArchitectureSpec({
  prompt: 'Google Cloud GKE application with Redis',
  interviewAnswers: 'asia-south1. Development only. Private and internal only. Redis cache. High availability. Python.',
  presets: { cloud: 'gcp', orchestrator: 'gke', ci: 'github-actions' },
});
const gkeRedisFiles = mergeLockedBaseFiles(
  [],
  detectScaffoldProfile(gkeRedis.source, gkeRedis.presets)!,
  { fillMissing: true, forceStubs: true, presets: gkeRedis.presets, scaffoldOptions: gkeRedis.options }
).files;
const gkeRedisIssues = validateScaffoldContract(gkeRedisFiles, gkeRedis.presets, gkeRedis.options);
const gkeGithubWorkflow = gkeRedisFiles.find((file) => file.path === '.github/workflows/deploy.yml')?.content || '';
if (
  gkeRedis.issues.length ||
  gkeRedisIssues.length ||
  !gkeRedisFiles.find((file) => file.path === 'terraform/main.tf')?.content.includes('google_redis_instance') ||
  !gkeRedisFiles.find((file) => file.path === 'environments/development.tfvars')?.content.includes('enable_redis = true') ||
  !gkeGithubWorkflow.includes('google-github-actions/auth@v2') ||
  !gkeGithubWorkflow.includes('gcloud auth configure-docker') ||
  ['aws-actions/', 'Amazon ECR', 'ECR_REPOSITORY'].some((marker) => gkeGithubWorkflow.includes(marker))
) {
  fail++;
  console.error('FAIL  GKE Redis Memorystore contract: ' + (gkeRedis.issues.join('; ') || gkeRedisIssues.join('; ')));
} else {
  console.log('PASS  GKE Redis Memorystore contract');
}

const azurePlan = sanitizePlanAgainstInterview(
  '## Confirmed requirements\\n- Azure Container Apps in westeurope with GitHub Actions, Python, MySQL, development and staging.\\n## Assumptions\\n- AWS Secrets Manager will store credentials.',
  azureOverride.source,
  azureOverride.presets
);
const azurePlanIssues = validatePlanAgainstSpec(azurePlan, azureOverride);
if (
  azureOverride.presets.cloud !== 'azure' ||
  azureOverride.presets.orchestrator !== 'container-apps' ||
  /AWS Secrets Manager/i.test(azurePlan) ||
  azurePlanIssues.length
) {
  fail++;
  console.error(\`FAIL  Azure override plan cleanup: \${azurePlanIssues.join('; ') || azurePlan}\`);
} else {
  console.log('PASS  Azure override strips AWS secret leakage');
}

const dotnetTruth = buildArchitectureSpec({
  prompt: 'GCP GKE .NET service',
  interviewAnswers: 'europe-west1. Development and staging. Public HTTP on the default load-balancer hostname. PostgreSQL. Medium — 3 to 5 app copies. Google Cloud Build. → .NET',
  presets: { cloud: 'gcp', orchestrator: 'gke', ci: 'gcp-cloud-build' },
});
const dotnetPlan = sanitizePlanAgainstInterview(
  '## Confirmed requirements\\n- GCP GKE in europe-west1 with Google Cloud Build, .NET, PostgreSQL, development and staging.\\n- Runtime Stub: Node.js\\n## File manifest\\n- app/Program.cs: health endpoint\\n- app/app.csproj: ASP.NET Core project\\n## Assumptions',
  dotnetTruth.source,
  dotnetTruth.presets
);
const dotnetPlanIssues = validatePlanAgainstSpec(dotnetPlan, dotnetTruth);
if (
  !dotnetPlan.includes('ASP.NET Core') ||
  !dotnetPlan.includes('implementation default') ||
  !dotnetPlan.includes('app/Program.cs') ||
  dotnetPlanIssues.length
) {
  fail++;
  console.error(\`FAIL  .NET plan-to-code disclosure: \${dotnetPlanIssues.join('; ') || dotnetPlan}\`);
} else {
  console.log('PASS  .NET plan matches generated ASP.NET Core health stub');
}

const unsupportedCapability = buildArchitectureSpec({
  prompt: 'Azure Container Apps service with Redis',
  interviewAnswers: 'europe-west1. Development and staging. Private and internal only. Redis cache. Medium — 3 to 5 app copies. Python.',
  presets: { cloud: 'azure', orchestrator: 'container-apps', ci: 'github-actions' },
});
if (!unsupportedCapability.issues.some((issue) => issue.includes('Redis/Valkey is not yet implemented'))) {
  fail++;
  console.error(\`FAIL  unsupported capability must block before approval: \${unsupportedCapability.issues.join('; ')}\`);
} else {
  console.log('PASS  unsupported provider capability blocks before approval');
}

const crossCloudPresets = inferPresetsFromPrompt(
  'Build a Google Cloud Run stack using Azure Key Vault and AWS Secrets Manager',
  { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' }
);
if (crossCloudPresets.cloud !== 'gcp' || crossCloudPresets.orchestrator !== 'cloud-run') {
  fail++;
  console.error(\`FAIL  Cloud Run must win over conflicting service names: \${JSON.stringify(crossCloudPresets)}\`);
} else {
  console.log('PASS  host-first cloud detection ignores conflicting service names');
}

const dotnetQuestions = buildClarifyingQuestions(
  'Provision AWS EKS cluster with .NET, RDS MySQL, and GitLab CI',
  { cloud: 'aws', orchestrator: 'eks', ci: 'gitlab-ci' }
);
if (dotnetQuestions.some((question) => question.includes('Which language should'))) {
  fail++;
  console.error('FAIL  .NET prompt asked for runtime again');
} else {
  console.log('PASS  .NET prompt does not ask a duplicate runtime question');
}

const environmentQuestions = buildClarifyingQuestions(
  'Build an AWS EKS API',
  { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' }
);
const environmentQuestion = environmentQuestions.find((question) => question.includes('Which environments')) || '';
if (!/Development only.*Staging only.*Production only/.test(environmentQuestion)) {
  fail++;
  console.error(\`FAIL  single-environment choices are incomplete: \${environmentQuestion}\`);
} else {
  console.log('PASS  client can choose the specific single environment');
}

const correctedDatabase = parseScaffoldOptions(
  'GCP Cloud Run with MongoDB. Client correction: PostgreSQL',
  { cloud: 'gcp', orchestrator: 'cloud-run', ci: 'gitlab-ci' }
);
if (correctedDatabase.database !== 'postgres') {
  fail++;
  console.error(\`FAIL  corrected database did not win: \${correctedDatabase.database}\`);
} else {
  console.log('PASS  latest corrected database wins');
}

const correctedRegion = parseScaffoldOptions(
  'Azure Container Apps in us-central1 with Python. Corrected region: eastus.',
  { cloud: 'azure', orchestrator: 'container-apps', ci: 'github-actions' }
);
if (correctedRegion.region !== 'eastus') {
  fail++;
  console.error(\`FAIL  corrected region did not win: \${correctedRegion.region}\`);
} else {
  console.log('PASS  latest corrected region wins');
}

const outputCases: Array<{ name: string; presets: Presets; database: 'none' | 'postgres' | 'redis'; forbidden: RegExp[] }> = [
  {
    name: 'ECS Redis removes relational outputs',
    presets: { cloud: 'aws', orchestrator: 'ecs', ci: 'github-actions' },
    database: 'redis',
    forbidden: [/aws_db_instance\.main/, /rds_endpoint/],
  },
  {
    name: 'EKS no-data removes data outputs',
    presets: { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' },
    database: 'none',
    forbidden: [/aws_db_instance\.main/, /aws_elasticache.*\.redis/, /rds_endpoint/, /redis_primary_endpoint/],
  },
  {
    name: 'Cloud Run PostgreSQL removes Redis outputs',
    presets: { cloud: 'gcp', orchestrator: 'cloud-run', ci: 'gitlab-ci' },
    database: 'postgres',
    forbidden: [/google_redis_instance\.cache/, /redis_host/],
  },
  {
    name: 'Cloud Run no-data removes all data outputs',
    presets: { cloud: 'gcp', orchestrator: 'cloud-run', ci: 'gitlab-ci' },
    database: 'none',
    forbidden: [/google_redis_instance\.cache/, /google_sql_database_instance\.main/, /redis_host/, /sql_connection_name/],
  },
];
for (const outputCase of outputCases) {
  const profile = detectScaffoldProfile(outputCase.presets.cloud + ' ' + outputCase.presets.orchestrator, outputCase.presets)!;
  const optionSet = {
    region: outputCase.presets.cloud === 'gcp' ? 'us-central1' : 'us-east-1',
    environments: ['development'],
    database: outputCase.database,
    databaseMode: 'standard' as const,
    access: 'private' as const,
    scale: 'small' as const,
    runtime: 'node' as const,
  };
  const outputContent = mergeLockedBaseFiles([], profile, {
    fillMissing: true,
    forceStubs: true,
    presets: outputCase.presets,
    scaffoldOptions: optionSet,
  }).files.find((file) => file.path === 'terraform/outputs.tf')?.content || '';
  if (outputCase.forbidden.some((pattern) => pattern.test(outputContent))) {
    fail++;
    console.error(\`FAIL  \${outputCase.name}: \${outputContent}\`);
  } else {
    console.log(\`PASS  \${outputCase.name}\`);
  }
}

const azureProfile = detectScaffoldProfile('azure aks', {
  cloud: 'azure', orchestrator: 'aks', ci: 'gitlab-ci',
})!;
const azureFiles = mergeLockedBaseFiles([], azureProfile, {
  fillMissing: true,
  forceStubs: true,
  presets: { cloud: 'azure', orchestrator: 'aks', ci: 'gitlab-ci' },
  scaffoldOptions: {
    region: 'eastus', environments: ['development'], database: 'mysql', databaseMode: 'standard',
    access: 'private', scale: 'small', runtime: 'java',
  },
}).files;
const azureDatabase = azureFiles.find((file) => file.path === 'terraform/database.tf')?.content || '';
if (
  azureDatabase.includes('storage_mb') ||
  !azureDatabase.includes('storage {') ||
  !azureDatabase.includes('size_gb = 32')
) {
  fail++;
  console.error(\`FAIL  Azure flexible server uses obsolete storage syntax: \${azureDatabase}\`);
} else {
  console.log('PASS  Azure flexible server uses provider-v4 storage syntax');
}

if (!requiresPlanApproval('Re-generate the stack with Go instead of Python', true)) {
  fail++;
  console.error('FAIL  regeneration did not require a replacement plan');
} else {
  console.log('PASS  regeneration requires a replacement architecture plan');
}

if (fail) {
  console.error(\`\\nOptions matrix FAILED (\${fail})\`);
  process.exit(1);
}
console.log('\\nOptions matrix PASSED — dynamic CI/runtime/DB/region wiring OK.');
`;

const tmp = path.join(root, 'scripts', '_qa-options-matrix-runner.mts');
fs.writeFileSync(tmp, runner, 'utf8');
try {
  const jiti = createJiti(import.meta.url, { alias: { '@': root } });
  await jiti.import(tmp);
} finally {
  fs.unlinkSync(tmp);
}
