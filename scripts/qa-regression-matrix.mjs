#!/usr/bin/env node
/**
 * Targeted regressions from the manual QA rows 37–47.  This is deliberately
 * deterministic and does not call the LLM or cloud providers.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createJiti } from 'jiti';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, 'scripts', '_qa-regression-matrix-runner.mts');
const runner = `
import { buildArchitectureSpec } from '../lib/architecture-spec.ts';
import { sanitizePlanAgainstInterview } from '../lib/sanitize-plan.ts';
import { isVagueStackPrompt, resolveDiscoveryPrompt, resolveStackPromptFromAffirmation } from '../lib/stack-intent.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.error('FAIL  ' + name + (detail ? ': ' + detail : '')); }
}

for (const fragment of ['Small deployment.', 'Medium deployment', 'Public HTTPS', 'Public without custom domain', 'Private VPC only']) {
  check('requirement fragment starts an interview: ' + fragment, isVagueStackPrompt(fragment));
}

const discoveredSmall = resolveDiscoveryPrompt('AWS', [
  { role: 'user', content: 'Small deployment.' },
  { role: 'assistant', content: 'What kind of application are you building and which cloud?' },
  { role: 'user', content: 'game app and cloud' },
  { role: 'assistant', content: 'Which cloud provider would you like to use?' },
]) || 'AWS';
const small = buildArchitectureSpec({
  prompt: discoveredSmall,
  interviewAnswers: 'Amazon EKS. ap-south-1. Production only. Public HTTP on the default load-balancer hostname. PostgreSQL. .NET.',
  presets: { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' },
});
const smallPlan = sanitizePlanAgainstInterview(
  '## Architecture\\n- Scale tier: Medium\\n- Use Multi-AZ PostgreSQL and an enabled Ingress resource.\\n- No specific .NET framework is assumed.\\n## File manifest\\n- terraform/main.tf',
  small.source,
  small.presets
);
check('row 37: bare small deployment is retained', small.options.scale === 'small', small.options.scale);
check('row 37: discovery retains game and scale context', /small deployment/i.test(small.source) && /game app/i.test(small.source), small.source);
check('row 37: standard database does not promise HA', !/multi[- ]?az|high availability/i.test(smallPlan), smallPlan);
check('row 37: .NET wording is internally consistent', !/no specific \.net framework/i.test(smallPlan) && /minimal ASP\.NET Core/i.test(smallPlan), smallPlan);
check('row 37: production HTTP is warned', /Production HTTP warning/i.test(smallPlan), smallPlan);
check('row 37: game context is disclosed without invented game services', /Game-workload decision required/i.test(smallPlan), smallPlan);

const healthPrompt = 'Google Cloud and health-related application';
const discoveredHealth = resolveDiscoveryPrompt(healthPrompt, [
  { role: 'user', content: 'Medium deployment.' },
  { role: 'assistant', content: 'What application and cloud should we use?' },
]);
check('row 38: discovery retains medium sizing', /Medium deployment/i.test(discoveredHealth || ''), discoveredHealth || 'null');
check(
  'row 38: affirmative turn keeps previous stack request',
  resolveStackPromptFromAffirmation('ok', [
    { role: 'user', content: healthPrompt },
    { role: 'assistant', content: 'I can help generate the infrastructure scaffold.' },
  ]) === healthPrompt
);

const cloudRun = buildArchitectureSpec({
  prompt: 'Healthcare infrastructure on Google Cloud',
  interviewAnswers: 'Cloud Run. Google Cloud Build. europe-west1. Production only. Public with secure HTTPS and a custom domain. MySQL. Python.',
  presets: { cloud: 'gcp', orchestrator: 'cloud-run', ci: 'gcp-cloud-build' },
});
const cloudRunPlan = sanitizePlanAgainstInterview(
  '## Architecture\\n- Medium tier and HTTP-only final endpoint.\\n- Create google_dns_managed_zone and Cloud Run Domain Mapping with a Google-managed certificate.\\n## File manifest\\n- terraform/main.tf',
  cloudRun.source,
  cloudRun.presets
);
check('row 39: custom HTTPS is never described as HTTP-only final delivery', !/http-only final/i.test(cloudRunPlan) && /Custom HTTPS boundary/i.test(cloudRunPlan), cloudRunPlan);
check('row 39: healthcare obligations are explicit but not falsely claimed', /Healthcare decision required/i.test(cloudRunPlan) && !/HIPAA compliant/i.test(cloudRunPlan), cloudRunPlan);
check('row 39: ungenerated custom-domain resources are not promised', !/google_dns_managed_zone|Google-managed certificate/i.test(cloudRunPlan) && /locked scaffold does not create Cloud DNS, a domain mapping/i.test(cloudRunPlan), cloudRunPlan);

const privateAks = buildArchitectureSpec({
  prompt: 'Private VPC only on Microsoft Azure',
  interviewAnswers: 'Azure Kubernetes Service (AKS). GitLab CI. westeurope. Development and staging. Private and internal only. PostgreSQL. Java. Medium - 3 to 5 app copies.',
  presets: { cloud: 'azure', orchestrator: 'aks', ci: 'gitlab-ci' },
});
const privateAksPlan = sanitizePlanAgainstInterview(
  '## Architecture\\n- Create a private AKS cluster and internal ingress controller.\\n- Create Azure Private DNS Zone and Private Link.\\n- Java is not selected.\\n## File manifest\\n- terraform/main.tf',
  privateAks.source,
  privateAks.presets
);
check('row 40: private AKS plan does not promise absent integrations', !/Create a private AKS cluster|Create Azure Private DNS Zone/i.test(privateAksPlan) && /Private AKS delivery boundary/i.test(privateAksPlan), privateAksPlan);
check('row 40: Java selection is not contradicted', !/Java is not selected/i.test(privateAksPlan), privateAksPlan);

const ecsHelm = buildArchitectureSpec({
  prompt: 'Create an ECS deployment with Kubernetes Helm.',
  presets: { cloud: 'aws', orchestrator: 'ecs', ci: 'github-actions' },
});
check('row 42: ECS plus Helm is blocked before plan generation', ecsHelm.issues.some((issue) => /cannot deploy Kubernetes Helm charts/i.test(issue)), ecsHelm.issues.join(' | '));

for (const prompt of ['Use every cloud.', 'Deploy simultaneously on AWS, Azure, OCI and GCP.']) {
  const multi = buildArchitectureSpec({ prompt, presets: { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' } });
  check('rows 46/47: multi-cloud request is guided to separate coherent projects', multi.issues.some((issue) => /one cloud provider scaffold per project/i.test(issue)), multi.issues.join(' | '));
}
const correctedMultiCloud = buildArchitectureSpec({
  prompt: 'Use every cloud.',
  interviewAnswers: 'Cloud provider (client override): Google Cloud. Hosting platform: Google Kubernetes Engine (GKE). us-central1.',
  presets: { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' },
});
check('multi-cloud request can be corrected to one explicit cloud', !correctedMultiCloud.issues.some((issue) => /one cloud provider scaffold/i.test(issue)), correctedMultiCloud.issues.join(' | '));

const comprehensive = buildArchitectureSpec({
  prompt: 'Create production ecommerce Kubernetes infrastructure with PostgreSQL, Redis, autoscaling, monitoring, logging, CI/CD, CDN, disaster recovery, backups and health checks.',
  interviewAnswers: 'Cloud provider: AWS. Amazon EKS. GitHub Actions. us-east-1. Production only. Private and internal only. PostgreSQL. High traffic - automatic scaling. Python.',
  presets: { cloud: 'aws', orchestrator: 'eks', ci: 'github-actions' },
});
check('row 43: explicitly requested unimplemented modules are not silently omitted', comprehensive.issues.some((issue) => /CDN.*managed monitoring.*centralized logging.*disaster recovery/i.test(issue)), comprehensive.issues.join(' | '));

if (failures) process.exit(1);
console.log('QA regression matrix PASSED — rows 37–47 contracts are enforced.');
`;

fs.writeFileSync(tmp, runner, 'utf8');
try {
  const jiti = createJiti(import.meta.url, { alias: { '@': root } });
  await jiti.import(tmp);
} finally {
  fs.unlinkSync(tmp);
}
