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

/** Alternate paths that satisfy a required slot */
export const PATH_ALIASES: Record<string, string[]> = {
  'terraform/key_vault.tf': ['terraform/keyvault.tf', 'terraform/key-vault.tf'],
  'terraform/variables.tf': ['terraform/vars.tf'],
  'terraform/versions.tf': ['terraform/providers.tf'],
  'terraform/main.tf': ['terraform/ecs.tf', 'terraform/cloudrun.tf'],
  'terraform/iam.tf': ['terraform/identity.tf'],
  'terraform/network.tf': ['terraform/networking.tf', 'terraform/vpc.tf'],
  'terraform/database.tf': ['terraform/db.tf', 'terraform/sql.tf'],
  'Dockerfile': ['go-backend/Dockerfile', 'app/Dockerfile'],
  'main.go': ['go-backend/main.go', 'app/main.go'],
  'go.mod': ['go-backend/go.mod', 'app/go.mod'],
  'go.sum': ['go-backend/go.sum', 'app/go.sum'],
  'app/index.js': ['index.js', 'src/index.js', 'app/server.js', 'server.js'],
  'app/package.json': ['package.json'],
  'app/package-lock.json': ['package-lock.json'],
  'main.py': ['app/main.py', 'src/main.py'],
  'requirements.txt': ['app/requirements.txt'],
  'README.md': ['readme.md'],
};

export type ScaffoldProfileId =
  | 'azure-go-container-apps'
  | 'aws-ecs-express'
  | 'gcp-fastapi-cloudrun';

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

  return null;
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
  const paths = new Set(files.map((f) => f.path.replace(/\\/g, '/')));
  const missing: string[] = [];
  for (const required of profile.requiredPaths) {
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
- Apply the PART B rules for this profile (B6 Azure / B8 ECS / B9 GCP).`;
}

export function buildCompletionPrompt(
  missingPaths: string[],
  existingFiles: { path: string; content: string }[],
  profile: ScaffoldProfile
): string {
  const existingList = existingFiles.map((f) => f.path).join(', ');
  const missingList = missingPaths.map((p) => `- ${p}`).join('\n');

  const architecture =
    profile.id === 'azure-go-container-apps'
      ? 'Azure Container Apps + Go + PostgreSQL + Azure DevOps'
      : profile.id === 'aws-ecs-express'
        ? 'AWS ECS Fargate + Express + ALB + ECR + CloudWatch + GitHub Actions'
        : 'GCP Cloud Run + FastAPI + Cloud SQL + GitLab CI';

  const rules =
    profile.id === 'azure-go-container-apps'
      ? 'Apply PART B6 (go.mod/go.sum, Key Vault key_vault_secret_id, subnet delegation, acrName vs acrRepository, lifecycle ignore_changes on image, real rollback).'
      : profile.id === 'aws-ecs-express'
        ? 'Apply PART B8 (required_providers, image_uri via GITHUB_OUTPUT, healthCheck vs curl in image, services-stable, package-lock, non-root USER, OIDC, scoped IAM).'
        : 'Apply PART B9 (deletion_protection, private SQL networking, secret value injection, Cloud SQL attach, no create_all at import, valid GitLab YAML, real tests, WIF).';

  return `## Completion pass — missing required files
Profile: ${profile.id}
Already emitted: ${existingList || '(none)'}

Emit ONLY the missing files below using <<<FILE>>> markers with **exact** paths and full content.
Do not re-emit files that already exist unless you are fixing them.

Missing:
${missingList}

Use the same ${architecture} architecture as the existing files.
Any missing application-source file must remain a minimal buildable health-check stub only — no CRUD, auth, UI, or business-domain behavior.
${rules}

Emit markers now.`;
}
