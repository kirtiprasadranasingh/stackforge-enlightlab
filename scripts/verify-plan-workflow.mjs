/**
 * Focused checks for plan-first gating + stream markers (no test runner required).
 * Usage: node scripts/verify-plan-workflow.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function runCheck(name, source) {
  const tmp = path.join(os.tmpdir(), `stackforge-check-${Date.now()}-${Math.random().toString(16).slice(2)}.ts`);
  fs.writeFileSync(tmp, source, 'utf8');
  try {
    const res = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['--yes', 'tsx', tmp],
      { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' }
    );
    if (res.status !== 0) {
      throw new Error(`${name} failed:\n${res.stderr || res.stdout}`);
    }
    const line = (res.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
    return JSON.parse(line || 'null');
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

const gates = runCheck(
  'requiresPlanApproval',
  `
import { requiresPlanApproval, isIterativeEditPrompt } from ${JSON.stringify(path.join(root, 'lib/stack-intent.ts'))};
const results = [
  requiresPlanApproval('Deploy an Express app on AWS ECS Fargate behind an ALB with ECR and GitHub Actions', false) === true,
  requiresPlanApproval('add HPA to the deployment', true) === false,
  requiresPlanApproval('hi', false) === false,
  isIterativeEditPrompt('fix the IAM policy') === true,
];
console.log(JSON.stringify(results));
`
);
assert.ok(gates.every(Boolean), `plan approval gates failed: ${JSON.stringify(gates)}`);
console.log('PASS  requiresPlanApproval / iterative edit gates');

const interview = runCheck(
  'clarifying-questions',
  `
import { buildClarifyingQuestions } from ${JSON.stringify(path.join(root, 'lib/clarifying-questions.ts'))};
const questions = buildClarifyingQuestions(
  'A Node.js REST API on AWS EKS with autoscaling, a staging environment, GitHub Actions, and PostgreSQL',
  { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' }
);
console.log(JSON.stringify(questions));
`
);
assert.equal(interview.length, 6);
assert.ok(interview[0].includes('AWS'));
assert.ok(interview[0].includes('Amazon EKS'));
assert.ok(interview[0].includes('GitHub Actions'));
assert.ok(interview.some((question) => question.includes('PostgreSQL')));
assert.ok(interview.every((question) => question.endsWith('?') || question.endsWith(')')));
assert.ok(interview.every((question) => !/^\d+[.)]/.test(question)));
assert.ok(
  interview.every((question) => /\(options:/.test(question)),
  'every interview question should present selectable options'
);
console.log('PASS  deterministic client interview is contextual, optioned, and unnumbered');

const parsed = runCheck(
  'stream-parse',
  `
import { createParseState, appendAndParse } from ${JSON.stringify(path.join(root, 'lib/stream-parse.ts'))};
const state = createParseState();
const text = \`<<<STATUS>>>
Drafting…
<<<QUESTIONS>>>
[]
<<<PLAN>>>
## Stack summary
AWS ECS Fargate + Express
## File manifest
- terraform/main.tf
- Dockerfile
<<<SUMMARY>>>
Approve to generate.
<<<WARNINGS>>>
[]\`;
const p = appendAndParse(state, text);
console.log(JSON.stringify({
  hasPlan: Boolean(p.plan && p.plan.includes('ECS')),
  files: p.files.length,
  questionsEmpty: Array.isArray(p.questions) && p.questions.length === 0,
}));
`
);
assert.equal(parsed.hasPlan, true);
assert.equal(parsed.files, 0);
assert.equal(parsed.questionsEmpty, true);
console.log('PASS  stream-parse PLAN marker (no files)');

const fragmented = runCheck(
  'fragmented-planning-stream',
  `
import { createParseState, appendAndParse } from ${JSON.stringify(path.join(root, 'lib/stream-parse.ts'))};
const state = createParseState();
const partial = appendAndParse(
  state,
  '<<<STATUS>>>\\nAsking…\\n<<<QUESTIONS>>>\\n["Which AWS'
);
const complete = appendAndParse(
  state,
  ' region should be used?", "2. Should ingress be public?"]\\n<<<SUMMARY>>>\\nPlease answer.\\n<<<WARNINGS>>>\\n[]'
);
const final = appendAndParse(state, '', true);
console.log(JSON.stringify({
  partialQuestions: partial.questions,
  completeQuestions: complete.questions,
  finalWarnings: final.warnings,
}));
`
);
assert.equal(fragmented.partialQuestions, undefined);
assert.deepEqual(fragmented.completeQuestions, [
  'Which AWS region should be used?',
  'Should ingress be public?',
]);
assert.deepEqual(fragmented.finalWarnings, []);
console.log('PASS  fragmented planning stream waits for complete sections');

const validation = runCheck(
  'validation',
  `
import { validateGenerateRequest } from ${JSON.stringify(path.join(root, 'lib/validation.ts'))};
const ok = validateGenerateRequest({
  prompt: 'Deploy Express on ECS with ALB',
  phase: 'plan',
  presets: { cloud: 'aws', orchestrator: 'ecs', ci: 'github-actions' },
});
const genMissing = validateGenerateRequest({
  prompt: 'Deploy Express on ECS with ALB',
  phase: 'generate',
  approvedPlan: 'short',
  presets: { cloud: 'aws', orchestrator: 'ecs', ci: 'github-actions' },
});
console.log(JSON.stringify({
  planOk: ok.success,
  shortPlanRejected: !genMissing.success,
}));
`
);
assert.equal(validation.planOk, true);
assert.equal(validation.shortPlanRejected, true);
console.log('PASS  GenerateRequestSchema phase + approvedPlan');

const eksCompletion = runCheck(
  'eks-manifest-completion-inputs',
  `
import {
  detectScaffoldProfile,
  parseFileManifestFromPlan,
  getMissingPaths,
} from ${JSON.stringify(path.join(root, 'lib/scaffold-spec.ts'))};
import { createParseState, appendAndParse } from ${JSON.stringify(path.join(root, 'lib/stream-parse.ts'))};

const profile = detectScaffoldProfile(
  'A Node.js REST API on AWS EKS with GitHub Actions and PostgreSQL',
  { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' }
);
const plan = \`## File manifest
terraform/versions.tf: Terraform and AWS provider versions.
terraform/variables.tf: Input variables.
terraform/main.tf: Core VPC and EKS.
app/Dockerfile: Container definition.
charts/app/Chart.yaml: Helm chart metadata.
.github/workflows/deploy.yml: CI/CD pipeline.
README.md: Setup instructions.
\`;
const paths = parseFileManifestFromPlan(plan);
const missing = getMissingPaths([{ path: 'terraform/variables.tf' }], paths);

const state = createParseState();
const parsed = appendAndParse(
  state,
  '<<<FILE path="terraform/main.tf">>>\\nresource "aws_vpc" "main" {}\\n<<<END_FILE>>>',
  true
);

console.log(JSON.stringify({
  profileId: profile?.id ?? null,
  pathCount: paths.length,
  missingCount: missing.length,
  pathOnlyParsed: parsed.files.map((f) => f.path),
}));
`
);
assert.equal(eksCompletion.profileId, 'aws-eks-helm');
assert.ok(eksCompletion.pathCount >= 6);
assert.ok(eksCompletion.missingCount >= 5);
assert.deepEqual(eksCompletion.pathOnlyParsed, ['terraform/main.tf']);
console.log('PASS  EKS profile + plan manifest + path-only FILE markers');

console.log('===== ALL WORKFLOW CHECKS PASSED =====');
