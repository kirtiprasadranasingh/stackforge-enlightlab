import type { Presets } from '@/types';

const CLOUD_LABELS: Record<Presets['cloud'], string> = {
  aws: 'AWS',
  azure: 'Microsoft Azure',
  gcp: 'Google Cloud',
  oracle: 'Oracle Cloud Infrastructure',
};

const ORCHESTRATOR_LABELS: Record<Presets['orchestrator'], string> = {
  eks: 'Amazon EKS',
  ecs: 'Amazon ECS',
  aks: 'Azure Kubernetes Service (AKS)',
  gke: 'Google Kubernetes Engine (GKE)',
  oke: 'Oracle Kubernetes Engine (OKE)',
  'cloud-run': 'Google Cloud Run',
  'container-apps': 'Azure Container Apps',
  serverless: 'serverless containers',
};

const CI_LABELS: Record<Presets['ci'], string> = {
  'github-actions': 'GitHub Actions',
  'gitlab-ci': 'GitLab CI',
  jenkins: 'Jenkins',
  'azure-devops': 'Azure DevOps Pipelines',
};

function detectRuntime(prompt: string): string | null {
  const text = prompt.toLowerCase();
  if (/\b(node(?:\.js)?|express|nestjs)\b/.test(text)) return 'Node.js';
  if (/\b(python|fastapi|django|flask)\b/.test(text)) return 'Python';
  if (/\b(go|golang)\b/.test(text)) return 'Go';
  if (/\b(java|spring(?:\s+boot)?)\b/.test(text)) return 'Java';
  if (/\b(\.net|dotnet|c#)\b/.test(text)) return '.NET';
  return null;
}

function detectDatabase(prompt: string): string | null {
  const text = prompt.toLowerCase();
  if (/\b(postgresql|postgres|rds postgres)\b/.test(text)) return 'PostgreSQL';
  if (/\b(mysql|mariadb)\b/.test(text)) return 'MySQL';
  if (/\b(mongodb|mongo)\b/.test(text)) return 'MongoDB';
  if (/\b(redis|valkey)\b/.test(text)) return 'Redis/Valkey';
  if (/\b(database|db)\b/.test(text)) return 'the database';
  return null;
}

function detectEnvironments(prompt: string): string[] {
  const text = prompt.toLowerCase();
  return ['development', 'dev', 'staging', 'production', 'prod']
    .filter((environment) => new RegExp(`\\b${environment}\\b`).test(text))
    .map((environment) => {
      if (environment === 'dev') return 'development';
      if (environment === 'prod') return 'production';
      return environment;
    })
    .filter((environment, index, all) => all.indexOf(environment) === index);
}

/**
 * Build a reliable first-round client interview without depending on streamed
 * model JSON. Presets have already been reconciled with explicit prompt terms.
 */
export function buildClarifyingQuestions(
  prompt: string,
  presets: Presets
): string[] {
  const runtime = detectRuntime(prompt);
  const database = detectDatabase(prompt);
  const environments = detectEnvironments(prompt);
  const target = `${CLOUD_LABELS[presets.cloud]} with ${
    ORCHESTRATOR_LABELS[presets.orchestrator]
  } and ${CI_LABELS[presets.ci]}`;
  const details = [
    runtime ? `${runtime} as the minimal container runtime` : null,
    database,
  ].filter(Boolean);

  const questions = [
    `I have the target as ${target}${
      details.length ? `, using ${details.join(' and ')}` : ''
    }. Is that correct?`,
    `Which ${CLOUD_LABELS[presets.cloud]} region should the infrastructure use?`,
    environments.length
      ? `You mentioned ${environments.join(
          ' and '
        )}. Should the scaffold cover only that environment, or also development and production?`
      : 'Which environments should the scaffold cover? (development, staging, production, or a subset)',
    'Should the service be internet-facing or private, and do you need a custom domain with managed TLS?',
  ];

  if (database) {
    questions.push(
      `For ${database}, should it use private networking, high availability, automated backups, and what retention period do you require?`
    );
  } else {
    questions.push(
      'Does the workload need a managed database, cache, queue, or other stateful service? (none is valid)'
    );
  }

  if (!runtime) {
    questions.push(
      'Which runtime should the minimal buildable health-check container use? (Node.js, Go, Python, Java, or .NET)'
    );
  } else {
    questions.push(
      'What traffic, availability, and scaling baseline should I design for? (expected requests, minimum replicas, and any uptime target)'
    );
  }

  return questions.slice(0, 6);
}
