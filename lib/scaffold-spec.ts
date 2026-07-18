import type { Presets } from '@/types';

/** PRD-locked layout for Azure Go + Container Apps + PostgreSQL + Azure DevOps */
export const AZURE_GO_CONTAINER_APPS_FILES = [
  'terraform/versions.tf',
  'terraform/variables.tf',
  'terraform/main.tf',
  'terraform/network.tf',
  'terraform/database.tf',
  'terraform/key_vault.tf',
  'terraform/identity.tf',
  'terraform/container_apps.tf',
  'terraform/outputs.tf',
  'azure-pipelines.yml',
  'Dockerfile',
  'go.mod',
  'go.sum',
  'main.go',
  'README.md',
] as const;

/** PRD-locked layout for AWS Express + ECS Fargate + ALB + ECR + GitHub Actions */
export const AWS_ECS_EXPRESS_FILES = [
  'terraform/versions.tf',
  'terraform/variables.tf',
  'terraform/main.tf',
  'terraform/iam.tf',
  'terraform/security_groups.tf',
  'terraform/outputs.tf',
  '.github/workflows/deploy.yml',
  'Dockerfile',
  'app/package.json',
  'app/package-lock.json',
  'app/index.js',
  'README.md',
] as const;

/** PRD-locked layout for GCP FastAPI + Cloud Run + Cloud SQL + GitLab CI */
export const GCP_FASTAPI_CLOUDRUN_FILES = [
  'terraform/versions.tf',
  'terraform/variables.tf',
  'terraform/main.tf',
  'terraform/network.tf',
  'terraform/database.tf',
  'terraform/iam.tf',
  'terraform/outputs.tf',
  '.gitlab-ci.yml',
  'Dockerfile',
  'requirements.txt',
  'main.py',
  'README.md',
] as const;

/** Common AWS EKS + Helm + GitHub Actions layout (matches plan-first EKS scaffolds) */
export const AWS_EKS_HELM_FILES = [
  'terraform/versions.tf',
  'terraform/variables.tf',
  'terraform/main.tf',
  'terraform/iam.tf',
  'terraform/outputs.tf',
  '.github/workflows/deploy.yml',
  'app/Dockerfile',
  'app/package.json',
  'app/server.js',
  'charts/app/Chart.yaml',
  'charts/app/values.yaml',
  'charts/app/templates/deployment.yaml',
  'charts/app/templates/service.yaml',
  'charts/app/templates/ingress.yaml',
  'charts/app/templates/hpa.yaml',
  'README.md',
] as const;

/** Alternate paths that satisfy a required slot */
export const PATH_ALIASES: Record<string, string[]> = {
  'terraform/key_vault.tf': ['terraform/keyvault.tf', 'terraform/key-vault.tf'],
  'terraform/variables.tf': ['terraform/vars.tf'],
  'terraform/versions.tf': ['terraform/providers.tf'],
  'terraform/main.tf': ['terraform/ecs.tf', 'terraform/cloudrun.tf', 'terraform/eks.tf'],
  'terraform/iam.tf': ['terraform/identity.tf'],
  'terraform/network.tf': ['terraform/networking.tf', 'terraform/vpc.tf'],
  'terraform/database.tf': ['terraform/db.tf', 'terraform/sql.tf', 'terraform/rds.tf'],
  'Dockerfile': ['go-backend/Dockerfile', 'app/Dockerfile'],
  'app/Dockerfile': ['Dockerfile'],
  'main.go': ['go-backend/main.go', 'app/main.go'],
  'go.mod': ['go-backend/go.mod', 'app/go.mod'],
  'go.sum': ['go-backend/go.sum', 'app/go.sum'],
  'app/index.js': ['index.js', 'src/index.js', 'app/server.js', 'server.js'],
  'app/server.js': ['app/index.js', 'index.js', 'server.js', 'src/index.js'],
  'app/package.json': ['package.json'],
  'app/package-lock.json': ['package-lock.json'],
  'main.py': ['app/main.py', 'src/main.py'],
  'requirements.txt': ['app/requirements.txt'],
  'README.md': ['readme.md'],
  '.github/workflows/deploy.yml': [
    '.github/workflows/ci.yml',
    '.github/workflows/cd.yml',
    '.github/workflows/pipeline.yml',
  ],
};

export type ScaffoldProfileId =
  | 'azure-go-container-apps'
  | 'aws-ecs-express'
  | 'gcp-fastapi-cloudrun'
  | 'aws-eks-helm';

export interface ScaffoldProfile {
  id: ScaffoldProfileId;
  requiredPaths: readonly string[];
}

export const AZURE_GO_CONTAINER_APPS_PROFILE: ScaffoldProfile = {
  id: 'azure-go-container-apps',
  requiredPaths: AZURE_GO_CONTAINER_APPS_FILES,
};

export const AWS_ECS_EXPRESS_PROFILE: ScaffoldProfile = {
  id: 'aws-ecs-express',
  requiredPaths: AWS_ECS_EXPRESS_FILES,
};

export const GCP_FASTAPI_CLOUDRUN_PROFILE: ScaffoldProfile = {
  id: 'gcp-fastapi-cloudrun',
  requiredPaths: GCP_FASTAPI_CLOUDRUN_FILES,
};

export const AWS_EKS_HELM_PROFILE: ScaffoldProfile = {
  id: 'aws-eks-helm',
  requiredPaths: AWS_EKS_HELM_FILES,
};

export function detectScaffoldProfile(
  prompt: string,
  presets: Presets
): ScaffoldProfile | null {
  const t = prompt.toLowerCase();

  const isAzureCa =
    presets.cloud === 'azure' &&
    (presets.orchestrator === 'container-apps' ||
      /container\s*apps?/.test(t));

  const isGo = /\bgo\b|golang/.test(t);
  const isPostgres = /postgres|postgresql/.test(t);
  const isAzdo =
    presets.ci === 'azure-devops' || /azure\s*devops|azure\s*pipelines/.test(t);

  if (isAzureCa && isGo && isPostgres && isAzdo) {
    return AZURE_GO_CONTAINER_APPS_PROFILE;
  }

  const isAwsEcs =
    presets.cloud === 'aws' &&
    (presets.orchestrator === 'ecs' || /\becs\b|\bfargate\b/.test(t));
  const isExpress = /express/.test(t);
  const isGha =
    presets.ci === 'github-actions' || /github\s*actions/.test(t);

  if (isAwsEcs && isExpress && isGha) {
    return AWS_ECS_EXPRESS_PROFILE;
  }

  const isGcpRun =
    presets.cloud === 'gcp' &&
    (presets.orchestrator === 'cloud-run' ||
      presets.orchestrator === 'serverless' ||
      /cloud\s*run/.test(t));
  const isFastapi = /fastapi|fast\s*api/.test(t);
  const isGitlab = presets.ci === 'gitlab-ci' || /gitlab/.test(t);

  if (isGcpRun && isFastapi && isPostgres && isGitlab) {
    return GCP_FASTAPI_CLOUDRUN_PROFILE;
  }

  const isAwsEks =
    presets.cloud === 'aws' &&
    (presets.orchestrator === 'eks' || /\beks\b/.test(t));
  if (isAwsEks && isGha) {
    return AWS_EKS_HELM_PROFILE;
  }

  return null;
}

/**
 * Extract concrete file paths from an approved plan's File manifest section.
 * Supports bullets, `path: description`, and bare relative paths.
 */
export function parseFileManifestFromPlan(plan: string): string[] {
  const text = plan.trim();
  if (!text) return [];

  const sectionMatch = text.match(
    /(?:^|\n)##?\s*File manifest\b([\s\S]*?)(?=\n##?\s+[A-Z]|\n#\s+[A-Z]|$)/i
  );
  const section = sectionMatch?.[1] ?? text;
  const paths: string[] = [];
  const seen = new Set<string>();
  // Paths like terraform/main.tf, app/Dockerfile, .github/workflows/deploy.yml, README.md
  const pathToken =
    '(\\.?[A-Za-z0-9_-]+(?:/[A-Za-z0-9_.-]+)+/[A-Za-z0-9_.-]+|\\.?[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+\\.[A-Za-z0-9]+|Dockerfile|Makefile|README\\.md|go\\.mod|go\\.sum)';

  for (const rawLine of section.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const candidates = [
      line.match(new RegExp(`^[-*]\\s*\`?${pathToken}\`?(?:\\s*[:—-].*)?$`, 'i')),
      line.match(new RegExp(`^\`?${pathToken}\`?\\s*[:—-]`, 'i')),
      line.match(new RegExp(`^\`${pathToken}\`$`, 'i')),
    ];

    for (const match of candidates) {
      const path = match?.[1]?.replace(/\\/g, '/').replace(/^\.\//, '');
      if (!path || seen.has(path) || path.includes(' ')) continue;
      // Prefer real project paths (nested or known root artifacts)
      if (
        path.includes('/') ||
        /^(README\.md|Dockerfile|Makefile|go\.mod|go\.sum|package\.json|requirements\.txt)$/i.test(
          path
        )
      ) {
        seen.add(path);
        paths.push(path);
      }
      break;
    }
  }

  return paths;
}

export function resolveRequiredSlot(
  paths: Set<string>,
  required: string
): string | null {
  if (paths.has(required)) return required;
  for (const alt of PATH_ALIASES[required] || []) {
    if (paths.has(alt)) return alt;
  }
  return null;
}

export function getMissingRequiredPaths(
  files: { path: string }[],
  profile: ScaffoldProfile
): string[] {
  return getMissingPaths(files, profile.requiredPaths);
}

export function getMissingPaths(
  files: { path: string }[],
  requiredPaths: readonly string[]
): string[] {
  const paths = new Set(files.map((f) => f.path.replace(/\\/g, '/')));
  const missing: string[] = [];
  for (const required of requiredPaths) {
    if (!resolveRequiredSlot(paths, required)) {
      missing.push(required);
    }
  }
  return missing;
}

export function buildLockedManifestPrompt(profile: ScaffoldProfile): string {
  const list = profile.requiredPaths.map((p) => `- ${p}`).join('\n');
  const pathHint =
    profile.id === 'azure-go-container-apps'
      ? 'Use these **exact** paths at the repository root (Go app at root — NOT go-backend/ or app/).'
      : profile.id === 'aws-ecs-express'
        ? 'Use these paths (Express under app/; Terraform under terraform/; workflow under .github/workflows/).'
        : profile.id === 'aws-eks-helm'
          ? 'Use these paths (Node stub under app/; Helm under charts/app/; Terraform under terraform/; workflow under .github/workflows/).'
          : 'Use these paths (Python app at repo root unless noted; Terraform under terraform/).';

  return `## LOCKED FILE MANIFEST (mandatory — PRD)
Emit a complete <<<FILE path="..." language="...">>> ... <<<END_FILE>>> block for **every** path below.
${pathHint}

${list}

Rules:
- Do NOT skip any file.
- Application-source paths in this manifest are minimal build/health-check stubs only. Do not add CRUD, authentication, UI, or business-domain behavior.
- README content belongs in README.md only — <<<SUMMARY>>> must be 2–3 sentences listing what was created.
- End SUMMARY with: "This is a reviewable starting scaffold — review before provisioning; it is not drop-in production code."
- Apply the PART B rules for this profile (B6 Azure / B8 ECS / B9 GCP / B for EKS Helm).`;
}

export function buildCompletionPrompt(
  missingPaths: string[],
  existingFiles: { path: string; content: string }[],
  profile?: ScaffoldProfile | null
): string {
  const existingList = existingFiles.map((f) => f.path).join(', ');
  const missingList = missingPaths.map((p) => `- ${p}`).join('\n');

  const architecture =
    profile?.id === 'azure-go-container-apps'
      ? 'Azure Container Apps + Go + PostgreSQL + Azure DevOps'
      : profile?.id === 'aws-ecs-express'
        ? 'AWS ECS Fargate + Express + ALB + ECR + CloudWatch + GitHub Actions'
        : profile?.id === 'aws-eks-helm'
          ? 'AWS EKS + Helm + ALB Controller + RDS PostgreSQL + GitHub Actions'
          : profile?.id === 'gcp-fastapi-cloudrun'
            ? 'GCP Cloud Run + FastAPI + Cloud SQL + GitLab CI'
            : 'the already-approved infrastructure architecture';

  const rules =
    profile?.id === 'azure-go-container-apps'
      ? 'Apply PART B6 (go.mod/go.sum, Key Vault key_vault_secret_id, subnet delegation, acrName vs acrRepository, lifecycle ignore_changes on image, real rollback).'
      : profile?.id === 'aws-ecs-express'
        ? 'Apply PART B8 (required_providers, image_uri via GITHUB_OUTPUT, healthCheck vs curl in image, services-stable, package-lock, non-root USER, OIDC, scoped IAM).'
        : profile?.id === 'aws-eks-helm'
          ? 'Apply EKS rules: IRSA for ALB controller separate from app SA, HPA enabled by default, private RDS, probes on /health, GitHub OIDC, complete Helm chart.'
          : profile?.id === 'gcp-fastapi-cloudrun'
            ? 'Apply PART B9 (deletion_protection, private SQL networking, secret value injection, Cloud SQL attach, no create_all at import, valid GitLab YAML, real tests, WIF).'
            : 'Apply PART B mechanical rules for the chosen cloud/CI. Keep app sources as a minimal /health stub only.';

  return `## Completion pass — missing required files
${profile ? `Profile: ${profile.id}\n` : ''}Already emitted: ${existingList || '(none)'}

Emit ONLY the missing files below using <<<FILE path="..." language="...">>> ... <<<END_FILE>>> markers with **exact** paths and full content.
Do not re-emit files that already exist unless you are fixing them.
Do not stop until every missing path below has a complete file body.

Missing:
${missingList}

Use the same ${architecture} architecture as the existing files / approved plan.
Any missing application-source file must remain a minimal buildable health-check stub only — no CRUD, auth, UI, or business-domain behavior.
${rules}

Emit markers now.`;
}
