#!/usr/bin/env node
/**
 * QA matrix — profile detection + locked base file coverage.
 * Run: node scripts/qa-matrix.mjs
 *
 * Does not call Gemini. Validates that each cloud profile has a locked base
 * set and that detectScaffoldProfile maps the QA prompts correctly.
 */
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Compile-on-the-fly via tsx if available; else require built dist is N/A.
// Prefer dynamic import of TS through node --experimental or spawn npx tsx.
function loadViaTsx(scriptBody) {
  const tmp = path.join(root, 'scripts', '_qa-matrix-runner.mts');
  fs.writeFileSync(tmp, scriptBody, 'utf8');
  const r = spawnSync(
    'npx',
    ['--yes', 'tsx', tmp],
    { cwd: root, encoding: 'utf8', shell: true }
  );
  fs.unlinkSync(tmp);
  return r;
}

const runner = `
import { detectScaffoldProfile } from '../lib/scaffold-spec.ts';
import { getProfileBaseFiles, mergeLockedBaseFiles, FORCE_STUB_PATHS } from '../lib/scaffold-base-files.ts';
import { getMissingPaths } from '../lib/scaffold-spec.ts';
import type { Presets } from '../types/index.ts';

const CASES: Array<{
  name: string;
  prompt: string;
  presets: Presets;
  expectProfile: string;
}> = [
  {
    name: 'AWS ECS Express',
    prompt: 'A Node.js Express REST API on AWS ECS Fargate with ALB, Redis, and GitHub Actions',
    presets: { cloud: 'aws', orchestrator: 'ecs', ci: 'github-actions' },
    expectProfile: 'aws-ecs-express',
  },
  {
    name: 'AWS EKS Helm',
    prompt: 'A Node.js REST API on AWS EKS with autoscaling, staging, GitHub Actions, and PostgreSQL',
    presets: { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' },
    expectProfile: 'aws-eks-helm',
  },
  {
    name: 'GCP Cloud Run FastAPI',
    prompt: 'A FastAPI service on GCP Cloud Run with Cloud SQL PostgreSQL and GitLab CI',
    presets: { cloud: 'gcp', orchestrator: 'cloud-run', ci: 'gitlab-ci' },
    expectProfile: 'gcp-fastapi-cloudrun',
  },
  {
    name: 'Azure Container Apps Go',
    prompt: 'A Go API on Azure Container Apps with PostgreSQL and Azure DevOps pipelines',
    presets: { cloud: 'azure', orchestrator: 'container-apps', ci: 'azure-devops' },
    expectProfile: 'azure-go-container-apps',
  },
  {
    name: 'Oracle OKE',
    prompt: 'A Node.js API on Oracle OKE with Helm and GitHub Actions',
    presets: { cloud: 'oracle', orchestrator: 'oke', ci: 'github-actions' },
    expectProfile: 'oracle-oke-helm',
  },
];

let fail = 0;
for (const c of CASES) {
  const profile = detectScaffoldProfile(c.prompt, c.presets);
  const id = profile?.id || '(null)';
  if (id !== c.expectProfile) {
    console.error(\`FAIL  profile \${c.name}: got \${id}, want \${c.expectProfile}\`);
    fail++;
    continue;
  }
  const base = getProfileBaseFiles(profile!.id);
  const basePaths = Object.keys(base);
  if (basePaths.length < 5) {
    console.error(\`FAIL  base files \${c.name}: only \${basePaths.length} locked files\`);
    fail++;
    continue;
  }
  const merged = mergeLockedBaseFiles([], profile!, { fillMissing: true, forceStubs: true });
  const missing = getMissingPaths(merged.files, [...profile!.requiredPaths]);
  if (missing.length > 0) {
    console.error(\`FAIL  coverage \${c.name}: still missing \${missing.join(', ')}\`);
    fail++;
    continue;
  }
  for (const stub of FORCE_STUB_PATHS) {
    if (profile!.requiredPaths.includes(stub as never) || base[stub]) {
      const f = merged.files.find((x) => x.path === stub);
      if (base[stub] && (!f || !f.content.trim())) {
        console.error(\`FAIL  stub \${c.name}: empty \${stub}\`);
        fail++;
      }
    }
  }
  console.log(\`PASS  \${c.name} → \${id} (\${merged.files.length} seeded files)\`);
}

if (fail > 0) {
  console.error(\`\\nQA matrix FAILED (\${fail})\`);
  process.exit(1);
}
console.log('\\nQA matrix PASSED — all cloud profiles detect + seed locked bases.');
`;

const result = loadViaTsx(runner);
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exit(result.status ?? 1);
