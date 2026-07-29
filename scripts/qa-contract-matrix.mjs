#!/usr/bin/env node
/**
 * Exhaustive supported-option contract QA.
 *
 * Every generated case is built from the same locked requirements contract
 * that production uses, then run through validation-style normalization. This
 * catches a default template silently replacing a selected runtime, database,
 * access mode, environment set, or scale tier.
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
import { normalizeScaffoldFiles } from '../lib/normalize-scaffold.ts';
import { createRequirementsManifest, readRequirementsManifest } from '../lib/architecture-spec.ts';
import { validateScaffoldContract } from '../lib/scaffold-contract.ts';
import { CI_OPTIONS_BY_CLOUD, type Presets } from '../types/index.ts';
import type { ScaffoldOptions } from '../lib/scaffold-options.ts';

const profiles: Presets[] = [
  { cloud: 'aws', orchestrator: 'ecs', ci: 'github-actions' },
  { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' },
  { cloud: 'gcp', orchestrator: 'cloud-run', ci: 'gitlab-ci' },
  { cloud: 'gcp', orchestrator: 'gke', ci: 'github-actions' },
  { cloud: 'azure', orchestrator: 'container-apps', ci: 'azure-devops' },
  { cloud: 'azure', orchestrator: 'aks', ci: 'github-actions' },
  { cloud: 'oracle', orchestrator: 'oke', ci: 'github-actions' },
];

const regions: Record<Presets['cloud'], string> = {
  aws: 'eu-west-1',
  gcp: 'europe-west1',
  azure: 'westeurope',
  oracle: 'eu-frankfurt-1',
};
const databaseModes: Array<Pick<ScaffoldOptions, 'database' | 'databaseMode'>> = [
  { database: 'none', databaseMode: 'standard' },
  { database: 'postgres', databaseMode: 'standard' },
  { database: 'postgres', databaseMode: 'ha_backup' },
  { database: 'mysql', databaseMode: 'standard' },
  { database: 'mysql', databaseMode: 'ha_backup' },
  { database: 'redis', databaseMode: 'standard' },
  { database: 'redis', databaseMode: 'ha' },
  { database: 'redis', databaseMode: 'ha_backup' },
];
const runtimes: ScaffoldOptions['runtime'][] = ['node', 'python', 'go', 'java', 'dotnet'];
const accessModes: ScaffoldOptions['access'][] = ['private', 'public_basic', 'public_https'];
const scales: ScaffoldOptions['scale'][] = ['small', 'medium', 'high'];
const environments: string[][] = [
  ['development'],
  ['development', 'staging'],
  ['development', 'staging', 'production'],
];

let cases = 0;
const failures: string[] = [];

function optionLabel(presets: Presets, options: ScaffoldOptions): string {
  return [
    presets.cloud,
    presets.orchestrator,
    presets.ci,
    options.runtime,
    options.database + '/' + options.databaseMode,
    options.access,
    options.scale,
    options.environments.join('+'),
  ].join(' | ');
}

function runtimeIssues(files: Array<{ path: string; content: string }>, runtime: ScaffoldOptions['runtime']): string[] {
  const paths = new Set(files.map((file) => file.path));
  const has = (suffix: string) => [...paths].some((path) => path === suffix || path.endsWith('/' + suffix));
  const nodeFiles = ['app/server.js', 'app/package.json', 'app/package-lock.json', 'server.js', 'package.json', 'package-lock.json'];
  const issues: string[] = [];
  if (runtime === 'java' && (!has('Application.java') || !has('pom.xml') || !has('Dockerfile'))) issues.push('Java files missing');
  if (runtime === 'dotnet' && (!has('Program.cs') || !has('app.csproj') || !has('Dockerfile'))) issues.push('.NET files missing');
  if (runtime === 'go' && (!has('main.go') || !has('go.mod') || !has('Dockerfile'))) issues.push('Go files missing');
  if (runtime === 'python' && (!has('main.py') || !has('requirements.txt') || !has('Dockerfile'))) issues.push('Python files missing');
  if (runtime === 'node' && (!has('server.js') || !has('package.json') || !has('Dockerfile'))) issues.push('Node files missing');
  if (runtime !== 'node') {
    for (const path of nodeFiles) if (paths.has(path)) issues.push('conflicting Node file ' + path);
  }
  return issues;
}

function runCase(presets: Presets, options: ScaffoldOptions): void {
  cases++;
  const profile = detectScaffoldProfile(presets.cloud + ' ' + presets.orchestrator, presets);
  if (!profile) {
    failures.push(optionLabel(presets, options) + ' :: no locked profile');
    return;
  }
  const spec = { presets, options, source: '', issues: [] };
  const generated = mergeLockedBaseFiles([], profile, {
    fillMissing: true,
    forceStubs: true,
    presets,
    scaffoldOptions: options,
  }).files;
  const normalized = normalizeScaffoldFiles(
    [...generated, createRequirementsManifest(spec)],
    { applyLockedProfile: true, terraformOnly: true, presets, scaffoldOptions: options }
  );
  const issues = [
    ...validateScaffoldContract(normalized, presets, options),
    ...runtimeIssues(normalized, options.runtime),
  ];
  const manifest = readRequirementsManifest(normalized);
  if (!manifest || JSON.stringify(manifest.presets) !== JSON.stringify(presets) || JSON.stringify(manifest.options) !== JSON.stringify(options)) {
    issues.push('requirements manifest changed during normalization');
  }
  const actualEnvironments = normalized
    .filter((file) => /^environments\\/[^/]+\\.tfvars$/.test(file.path))
    .map((file) => file.path.replace(/^environments\\//, '').replace(/\\.tfvars$/, ''))
    .sort();
  if (actualEnvironments.join(',') !== [...options.environments].sort().join(',')) {
    issues.push('environment tfvars mismatch: ' + actualEnvironments.join(','));
  }
  if (issues.length) failures.push(optionLabel(presets, options) + ' :: ' + [...new Set(issues)].join('; '));
}

for (const base of profiles) {
  for (const runtime of runtimes) {
    for (const data of databaseModes) {
      for (const access of accessModes) {
        for (const scale of scales) {
          for (const envs of environments) {
            runCase(base, {
              region: regions[base.cloud],
              environments: envs,
              database: data.database,
              databaseMode: data.databaseMode,
              access,
              scale,
              runtime,
            });
          }
        }
      }
    }
  }
}

// CI is an independent axis: check every CI option offered for each cloud.
for (const base of profiles) {
  for (const ci of CI_OPTIONS_BY_CLOUD[base.cloud]) {
    runCase({ ...base, ci }, {
      region: regions[base.cloud],
      environments: ['development', 'staging'],
      database: 'redis',
      databaseMode: 'ha',
      access: 'private',
      scale: 'medium',
      runtime: 'java',
    });
  }
}

if (failures.length) {
  console.error('FAIL  contract matrix: ' + failures.length + ' of ' + cases + ' cases failed');
  for (const failure of failures.slice(0, 80)) console.error('  - ' + failure);
  if (failures.length > 80) console.error('  - ... ' + (failures.length - 80) + ' more');
  process.exit(1);
}
console.log('PASS  contract matrix: ' + cases + ' supported option cases');
`;

const tmp = path.join(root, 'scripts', '_qa-contract-matrix-runner.mts');
fs.writeFileSync(tmp, runner, 'utf8');
try {
  const jiti = createJiti(import.meta.url, { alias: { '@': root } });
  await jiti.import(tmp);
} finally {
  fs.unlinkSync(tmp);
}
