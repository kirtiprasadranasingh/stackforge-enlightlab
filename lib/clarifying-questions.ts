import type { Presets } from '@/types';
import { promptNamesCloud } from '@/lib/infer-presets';

export const CLOUD_LABELS: Record<Presets['cloud'], string> = {
  aws: 'AWS',
  azure: 'Microsoft Azure',
  gcp: 'Google Cloud',
  oracle: 'Oracle Cloud Infrastructure',
};

export const ORCHESTRATOR_LABELS: Record<Presets['orchestrator'], string> = {
  eks: 'Amazon EKS',
  ecs: 'Amazon ECS',
  aks: 'Azure Kubernetes Service (AKS)',
  gke: 'Google Kubernetes Engine (GKE)',
  oke: 'Oracle Kubernetes Engine (OKE)',
  'cloud-run': 'Google Cloud Run',
  'container-apps': 'Azure Container Apps',
  serverless: 'serverless containers',
};

export const CI_LABELS: Record<Presets['ci'], string> = {
  'github-actions': 'GitHub Actions',
  'gitlab-ci': 'GitLab CI',
  jenkins: 'Jenkins',
  'azure-devops': 'Azure DevOps Pipelines',
};

export const REGION_OPTIONS_BY_CLOUD: Record<Presets['cloud'], string[]> = {
  aws: ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1'],
  gcp: ['us-central1', 'europe-west1', 'asia-south1'],
  azure: ['eastus', 'westeurope', 'centralindia'],
  oracle: ['ap-mumbai-1', 'us-ashburn-1', 'eu-frankfurt-1'],
};

export const HOSTING_OPTIONS_BY_CLOUD: Record<Presets['cloud'], string[]> = {
  aws: ['Amazon EKS', 'Amazon ECS'],
  azure: ['Azure Kubernetes Service (AKS)', 'Azure Container Apps'],
  gcp: ['Google Kubernetes Engine (GKE)', 'Google Cloud Run'],
  oracle: ['Oracle Kubernetes Engine (OKE)'],
};

/** Parse "Question text? (options: A / B / C)" into prompt + options. */
export function parseClarifyingQuestion(raw: string): {
  prompt: string;
  options: string[];
} {
  const match = raw.match(/^([\s\S]*?)\s*\(options:\s*([\s\S]*?)\)\s*$/i);
  if (!match) return { prompt: raw, options: [] };

  return {
    prompt: match[1].trim(),
    options: match[2]
      .split(/\s+\/\s+/)
      .map((option) => option.trim())
      .filter(Boolean),
  };
}

function detectCloudLabel(text: string): Presets['cloud'] | null {
  const value = text.toLowerCase();
  if (value.includes('oracle')) return 'oracle';
  if (value.includes('google cloud') || value.includes('gcp')) return 'gcp';
  if (value.includes('microsoft azure') || /\bazure\b/.test(value)) return 'azure';
  if (/\baws\b/.test(value) || value.includes('amazon web services')) return 'aws';
  return null;
}

export function cloudFromInterviewAnswer(
  answer: string | undefined
): Presets['cloud'] | null {
  if (!answer) return null;
  const text = answer.trim();

  if (text.startsWith('Change the cloud:')) {
    const choice = text
      .slice('Change the cloud:'.length)
      .split(/\s*\|\s*/)[0]
      .trim();
    return detectCloudLabel(choice);
  }

  if (text.startsWith('Change the hosting platform:')) {
    const choice = text.slice('Change the hosting platform:'.length).toLowerCase();
    if (choice.includes('oke') || choice.includes('oracle')) return 'oracle';
    if (
      choice.includes('gke') ||
      choice.includes('cloud run') ||
      choice.includes('google')
    ) {
      return 'gcp';
    }
    if (
      choice.includes('aks') ||
      choice.includes('container apps') ||
      choice.includes('azure')
    ) {
      return 'azure';
    }
    if (choice.includes('eks') || choice.includes('ecs') || choice.includes('amazon')) {
      return 'aws';
    }
  }

  // Direct pick from "Which cloud should we use?" (no Change the cloud: prefix)
  return detectCloudLabel(text);
}

/**
 * Detect the cloud proposed in the first "Does this setup match…" question so
 * that a "Change the hosting platform" follow-up can stay within that cloud.
 * Returns null for open "Which cloud should we use?" questions (all clouds listed).
 */
export function baseCloudFromSetupQuestion(
  question: string | undefined
): Presets['cloud'] | null {
  if (!question) return null;
  const lower = question.toLowerCase();
  if (/^which cloud should we use\?/i.test(question.trim())) return null;
  // Only trust the proposed target clause, not the options list.
  const match = lower.match(
    /does this setup match what you need:\s*(.+?)(?:\?|\(|$)/i
  );
  const target = match?.[1] || '';
  if (!target) return null;
  if (target.includes('oracle cloud infrastructure') || target.includes('oracle')) {
    return 'oracle';
  }
  if (target.includes('microsoft azure') || target.includes('azure')) return 'azure';
  if (target.includes('google cloud') || target.includes('gcp')) return 'gcp';
  if (/\baws\b/.test(target) || target.includes('amazon')) return 'aws';
  return null;
}

/**
 * Keep later questions aligned with earlier choices (e.g. region list matches
 * the cloud the client picked in a "Change the cloud" follow-up).
 */
export function adaptClarifyingQuestions(
  questions: string[],
  answers: Record<number, string>
): string[] {
  const chosenCloud = cloudFromInterviewAnswer(answers[0]);
  if (!chosenCloud) return questions;

  const regions = REGION_OPTIONS_BY_CLOUD[chosenCloud].join(' / ');
  const hosting = HOSTING_OPTIONS_BY_CLOUD[chosenCloud].join(' / ');
  return questions.map((question) => {
    if (/^Where should we host it\?/i.test(question)) {
      return `Where should we host it? (options: ${regions})`;
    }
    if (/^Which hosting platform should we use\?/i.test(question)) {
      return `Which hosting platform should we use? (options: ${hosting})`;
    }
    return question;
  });
}

/** Expand interview picks into explicit requirements for the plan model. */
export function formatInterviewAnswerForPlan(rawAnswer: string): string {
  const answer = rawAnswer.trim();
  if (!answer) return answer;

  if (answer === 'Yes, use this setup') {
    return 'Keep the suggested cloud, hosting platform, and CI/CD as proposed.';
  }

  // Direct cloud pick from open "Which cloud should we use?"
  const directCloud = detectCloudLabel(answer);
  if (
    directCloud &&
    /^(AWS|Microsoft Azure|Google Cloud|Oracle Cloud Infrastructure)$/i.test(answer)
  ) {
    return `Cloud provider (client override): ${answer}. Use this instead of any default cloud.`;
  }

  const knownHosting = Object.values(HOSTING_OPTIONS_BY_CLOUD).flat();
  if (knownHosting.some((h) => h.toLowerCase() === answer.toLowerCase())) {
    return `Hosting platform (client override): ${answer}. Use this instead of any default hosting platform.`;
  }

  if (answer.startsWith('Change the cloud:')) {
    const rest = answer.slice('Change the cloud:'.length).trim();
    const [cloudPart, ...more] = rest.split(/\s*\|\s*/);
    const hostingPart = more
      .find((part) => /^Hosting:\s*/i.test(part))
      ?.replace(/^Hosting:\s*/i, '')
      .trim();
    const cloud = cloudPart.trim();
    if (hostingPart) {
      return `Cloud provider (client override): ${cloud}. Hosting platform (client override): ${hostingPart}. Use these instead of the originally suggested values.`;
    }
    return `Cloud provider (client override): ${cloud}. Use this instead of the originally suggested cloud.`;
  }

  const changeMatchers: Array<{ prefix: string; label: string }> = [
    {
      prefix: 'Change the hosting platform:',
      label: 'Hosting platform (client override)',
    },
    { prefix: 'Change CI/CD:', label: 'CI/CD system (client override)' },
    { prefix: 'Another service:', label: 'Data service (client override)' },
  ];

  for (const { prefix, label } of changeMatchers) {
    if (answer.startsWith(prefix)) {
      const choice = answer.slice(prefix.length).trim();
      return `${label}: ${choice}. Use this instead of the originally suggested value.`;
    }
  }

  return answer;
}

function detectRuntime(prompt: string): string | null {
  const text = prompt.toLowerCase();
  // Next.js / Nest / Express are Node runtimes — never fall through to a language question.
  if (
    /\b(next\.?js|nextjs|node(?:\.js)?|express|nestjs|react)\b/.test(text)
  ) {
    return 'Node.js';
  }
  if (/\b(python|fastapi|django|flask)\b/.test(text)) return 'Python';
  if (/\b(go|golang)\b/.test(text)) return 'Go';
  if (/\b(java|spring(?:\s+boot)?)\b/.test(text)) return 'Java';
  if (/\b(\.net|dotnet|c#)\b/.test(text)) return '.NET';
  return null;
}

/**
 * True when the prompt explicitly rules out persistence, e.g. "no database",
 * "without a db", "stateless". Prevents the interview from asking how to
 * configure a database that the user said they don't want.
 */
function hasNoDataSignal(prompt: string): boolean {
  const text = prompt.toLowerCase();
  return (
    /\bno\s+(database|db|data\s*(?:store|base)?|persistence|storage)\b/.test(text) ||
    /\bwithout\s+(a\s+)?(database|db|data\s*store|persistence)\b/.test(text) ||
    /\bstateless\b/.test(text)
  );
}

function detectDatabase(prompt: string): string | null {
  const text = prompt.toLowerCase();
  if (hasNoDataSignal(prompt)) return null;
  if (/\b(postgresql|postgres|rds postgres)\b/.test(text)) return 'PostgreSQL';
  if (/\b(mysql|mariadb)\b/.test(text)) return 'MySQL';
  if (/\b(mongodb|mongo)\b/.test(text)) return 'MongoDB';
  if (/\b(redis|valkey)\b/.test(text)) return 'Redis/Valkey';
  if (/\b(database|db)\b/.test(text)) return 'the database';
  return null;
}

function detectEnvironments(prompt: string): string[] {
  const text = prompt.toLowerCase();
  const canon = (environment: string) =>
    environment === 'dev'
      ? 'development'
      : environment === 'prod'
        ? 'production'
        : environment;

  // Drop any environment the prompt explicitly rules out, e.g. "no staging",
  // "no phantom staging", "without a staging environment". Without this, the
  // word inside a negation gets detected and the interview asks for it anyway.
  const isNegated = (environment: string) =>
    new RegExp(
      `\\b(no|without|not|skip|exclude|drop|remove)\\s+(?:\\w+\\s+){0,3}${environment}\\b`
    ).test(text);

  let found = ['development', 'dev', 'staging', 'production', 'prod']
    .filter(
      (environment) =>
        new RegExp(`\\b${environment}\\b`).test(text) && !isNegated(environment)
    )
    .map(canon)
    .filter((environment, index, all) => all.indexOf(environment) === index);

  // "only a production environment" / "production only" / "single environment"
  // collapses to the one named environment so we don't invent extra stages.
  const onlyMatch = text.match(
    /\bonly\s+(?:a\s+|an\s+)?(?:\w+\s+){0,2}(development|dev|staging|production|prod)\b/
  );
  if (onlyMatch) {
    found = [canon(onlyMatch[1])];
  }

  return found;
}

/**
 * Build the environments question so the exact combination the user asked for is
 * always the first (default) selectable option. Without this, a "dev + prod"
 * request could only be answered with "Development and staging", which silently
 * drops production and adds staging.
 */
function buildEnvironmentsQuestion(environments: string[]): string {
  const titleCase = (value: string) =>
    value.charAt(0).toUpperCase() + value.slice(1);

  // Human label for a set of environments, e.g. ["development","production"]
  // -> "Development and production"; three-plus uses Oxford-comma style so it
  // never collides with the " / " option delimiter.
  const labelFor = (envs: string[]): string => {
    const names = envs.map(titleCase);
    if (names.length <= 1) return names[0] ?? '';
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  };

  const alternatives = [
    'Development and staging',
    'Development, staging, and production',
  ];

  if (!environments.length) {
    return `Which environments do you need? (options: One environment / ${alternatives.join(
      ' / '
    )})`;
  }

  const detectedLabel = labelFor(environments);
  const options = [detectedLabel, ...alternatives].filter(
    (option, index, all) =>
      all.findIndex((o) => o.toLowerCase() === option.toLowerCase()) === index
  );

  return `You mentioned ${environments.join(
    ' and '
  )}. Which environments do you need? (options: ${options.join(' / ')})`;
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
  const noData = hasNoDataSignal(prompt);
  const database = detectDatabase(prompt);
  const environments = detectEnvironments(prompt);
  const target = `${CLOUD_LABELS[presets.cloud]} with ${
    ORCHESTRATOR_LABELS[presets.orchestrator]
  } and ${CI_LABELS[presets.ci]}`;
  const details = [
    runtime ? `${runtime} as the minimal container runtime` : null,
    database,
  ].filter(Boolean);

  const regionOptions = REGION_OPTIONS_BY_CLOUD[presets.cloud].join(' / ');
  const namedCloud = promptNamesCloud(prompt);

  // When the user did not name a cloud, do NOT assert silent UI defaults (AWS/EKS).
  const setupQuestion = namedCloud
    ? `Does this setup match what you need: ${target}${
        details.length ? `, using ${details.join(' and ')}` : ''
      }? (options: Yes, use this setup / Change the cloud / Change the hosting platform / Change CI/CD)`
    : `Which cloud should we use? (options: AWS / Microsoft Azure / Google Cloud / Oracle Cloud Infrastructure)`;

  const questions = namedCloud
    ? [
        setupQuestion,
        `Where should we host it? (options: ${regionOptions})`,
        buildEnvironmentsQuestion(environments),
        'Who should be able to access the API? (options: Public with secure HTTPS / Public without a custom domain / Private and internal only)',
      ]
    : [
        setupQuestion,
        'Which hosting platform should we use? (options: Managed Kubernetes / Serverless containers)',
        `Where should we host it? (options: ${regionOptions})`,
        buildEnvironmentsQuestion(environments),
        'Who should be able to access the API? (options: Public with secure HTTPS / Public without a custom domain / Private and internal only)',
      ];

  if (database) {
    questions.push(
      `How should ${database} be configured? (options: Standard private database / High availability / Private database with 7-day automatic backups)`
    );
  } else if (!noData) {
    // Only ask about data when the user hasn't already ruled it out. When the
    // prompt says "no database", we skip this entirely so the scaffold stays
    // stateless and Q1 never tacks on "and the database".
    questions.push(
      'Does the service need stored data or a cache? (options: No data service / PostgreSQL / MySQL / Redis cache / Another service)'
    );
  }

  if (!runtime) {
    questions.push(
      'Which language should the health-check service use? (options: Node.js / Go / Python / Java / .NET)'
    );
  } else {
    questions.push(
      'How much traffic should we plan for? (options: Small — 2 app copies / Medium — 3 to 5 app copies / High traffic — automatic scaling)'
    );
  }

  return questions.slice(0, 7);
}
