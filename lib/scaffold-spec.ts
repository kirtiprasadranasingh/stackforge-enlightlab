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
  'environments/staging.tfvars',
  'environments/development.tfvars',
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
  'terraform/vpc.tf',
  'terraform/ecs.tf',
  'terraform/alb.tf',
  'terraform/iam.tf',
  'terraform/security_groups.tf',
  'terraform/redis.tf',
  'terraform/outputs.tf',
  '.github/workflows/deploy.yml',
  'app/Dockerfile',
  'app/package.json',
  'app/package-lock.json',
  'app/server.js',
  'README.md',
] as const;

/** PRD-locked layout for GCP FastAPI + Cloud Run + Cloud SQL + GitLab CI */
export const GCP_FASTAPI_CLOUDRUN_FILES = [
  'terraform/versions.tf',
  'terraform/variables.tf',
  'terraform/main.tf',
  'terraform/network.tf',
  'terraform/database.tf',
  'terraform/cloudrun.tf',
  'terraform/iam.tf',
  'terraform/outputs.tf',
  'environments/staging.tfvars',
  'environments/development.tfvars',
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
  'terraform/network.tf',
  'terraform/security_groups.tf',
  'terraform/iam.tf',
  'terraform/eks.tf',
  'terraform/database.tf',
  'terraform/outputs.tf',
  'environments/staging.tfvars',
  'environments/development.tfvars',
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

/** Common Oracle OKE + Helm + GitHub Actions layout */
export const ORACLE_OKE_HELM_FILES = [
  'terraform/versions.tf',
  'terraform/variables.tf',
  'terraform/main.tf',
  'terraform/network.tf',
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
  'terraform/vpc.tf': ['terraform/network.tf', 'terraform/networking.tf'],
  'terraform/ecs.tf': ['terraform/main.tf'],
  'terraform/alb.tf': ['terraform/load_balancer.tf'],
  'terraform/redis.tf': ['terraform/elasticache.tf', 'terraform/cache.tf'],
  'terraform/cloudwatch.tf': ['terraform/logging.tf'],
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
  | 'aws-eks-helm'
  | 'oracle-oke-helm'
  | 'azure-aks-helm'
  | 'gcp-gke-helm';

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

export const ORACLE_OKE_HELM_PROFILE: ScaffoldProfile = {
  id: 'oracle-oke-helm',
  requiredPaths: ORACLE_OKE_HELM_FILES,
};

export const AZURE_AKS_HELM_FILES = [
  'terraform/versions.tf',
  'terraform/variables.tf',
  'terraform/main.tf',
  'terraform/network.tf',
  'terraform/aks.tf',
  'terraform/database.tf',
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

export const GCP_GKE_HELM_FILES = [
  'terraform/versions.tf',
  'terraform/variables.tf',
  'terraform/main.tf',
  'terraform/network.tf',
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

export const AZURE_AKS_HELM_PROFILE: ScaffoldProfile = {
  id: 'azure-aks-helm',
  requiredPaths: AZURE_AKS_HELM_FILES,
};

export const GCP_GKE_HELM_PROFILE: ScaffoldProfile = {
  id: 'gcp-gke-helm',
  requiredPaths: GCP_GKE_HELM_FILES,
};

export function detectScaffoldProfile(
  prompt: string,
  presets: Presets
): ScaffoldProfile | null {
  const t = prompt.toLowerCase();

  // Client overrides always win over the original prompt keywords
  // (e.g. "OKE prompt" + Azure AKS override must not stay on Oracle).
  const hasAzureOverride =
    presets.cloud === 'azure' ||
    presets.orchestrator === 'aks' ||
    presets.orchestrator === 'container-apps' ||
    /cloud provider\s*\(client override\)\s*:[^.\n]*(azure|microsoft)/i.test(
      prompt
    ) ||
    /hosting platform\s*\(client override\)\s*:[^.\n]*(aks|azure kubernetes|container apps?)/i.test(
      prompt
    ) ||
    /microsoft\s+azure[\s\S]{0,200}hosting platform\s*\(client override\)/i.test(
      prompt
    );

  const hasOracleOverride =
    presets.cloud === 'oracle' ||
    presets.orchestrator === 'oke' ||
    /cloud provider\s*\(client override\)\s*:[^.\n]*(oracle|oci)/i.test(prompt) ||
    /hosting platform\s*\(client override\)\s*:[^.\n]*(oke|oracle kubernetes)/i.test(
      prompt
    ) ||
    /oracle cloud infrastructure[\s\S]{0,200}hosting platform\s*\(client override\)/i.test(
      prompt
    );

  const hasAwsOverride =
    presets.cloud === 'aws' ||
    presets.orchestrator === 'eks' ||
    presets.orchestrator === 'ecs' ||
    /hosting platform\s*\(client override\)\s*:[^.\n]*(eks|ecs|fargate)/i.test(
      prompt
    );

  const hasGcpOverride =
    presets.cloud === 'gcp' ||
    presets.orchestrator === 'gke' ||
    presets.orchestrator === 'cloud-run' ||
    /hosting platform\s*\(client override\)\s*:[^.\n]*(gke|cloud run)/i.test(
      prompt
    );

  if (hasAzureOverride) {
    // Explicit AKS / Kubernetes in the prompt always wins over a leftover
    // Container Apps UI preset (common cause of hybrid ACA+Helm scaffolds).
    if (
      presets.orchestrator === 'aks' ||
      /\baks\b/.test(t) ||
      /azure\s+kubernetes/.test(t) ||
      /kubernetes\s+service/.test(t)
    ) {
      return AZURE_AKS_HELM_PROFILE;
    }
    if (
      presets.orchestrator === 'container-apps' ||
      /container\s*apps?/.test(t)
    ) {
      return AZURE_GO_CONTAINER_APPS_PROFILE;
    }
    return AZURE_AKS_HELM_PROFILE;
  }

  if (hasOracleOverride) {
    return ORACLE_OKE_HELM_PROFILE;
  }

  if (hasAwsOverride) {
    if (presets.orchestrator === 'ecs' || /\becs\b|\bfargate\b/.test(t)) {
      return AWS_ECS_EXPRESS_PROFILE;
    }
    return AWS_EKS_HELM_PROFILE;
  }

  if (hasGcpOverride) {
    if (
      presets.orchestrator === 'cloud-run' ||
      presets.orchestrator === 'serverless' ||
      /cloud\s*run/.test(t)
    ) {
      return GCP_FASTAPI_CLOUDRUN_PROFILE;
    }
    return GCP_GKE_HELM_PROFILE;
  }

  // No client override — match on presets + prompt keywords
  if (
    presets.cloud === 'azure' &&
    (presets.orchestrator === 'container-apps' || /container\s*apps?/.test(t))
  ) {
    return AZURE_GO_CONTAINER_APPS_PROFILE;
  }

  if (
    presets.cloud === 'aws' &&
    (presets.orchestrator === 'ecs' || /\becs\b|\bfargate\b/.test(t))
  ) {
    return AWS_ECS_EXPRESS_PROFILE;
  }

  if (
    presets.cloud === 'aws' &&
    (presets.orchestrator === 'eks' || /\beks\b/.test(t))
  ) {
    return AWS_EKS_HELM_PROFILE;
  }

  if (
    presets.cloud === 'gcp' &&
    (presets.orchestrator === 'cloud-run' ||
      presets.orchestrator === 'serverless' ||
      /cloud\s*run/.test(t))
  ) {
    return GCP_FASTAPI_CLOUDRUN_PROFILE;
  }

  if (presets.cloud === 'oracle' || /\b(oci|oracle|oke)\b/.test(t)) {
    return ORACLE_OKE_HELM_PROFILE;
  }

  if (
    presets.cloud === 'azure' &&
    (presets.orchestrator === 'aks' || /\baks\b/.test(t))
  ) {
    return AZURE_AKS_HELM_PROFILE;
  }

  if (
    presets.cloud === 'gcp' &&
    (presets.orchestrator === 'gke' || /\bgke\b/.test(t))
  ) {
    return GCP_GKE_HELM_PROFILE;
  }

  return null;
}

/**
 * Infer locked profile from generated files (used on validate / normalize
 * when we must replace model Terraform with the validated template).
 */
export function detectProfileFromGeneratedFiles(
  files: Array<{ path: string; content: string }>
): ScaffoldProfile | null {
  const paths = files.map((f) => f.path.replace(/\\/g, '/'));
  const pathBlob = paths.join('\n');
  const tfBlob = files
    .filter((f) => f.path.replace(/\\/g, '/').endsWith('.tf'))
    .map((f) => f.content)
    .join('\n');
  const hasCharts = paths.some((p) => p.startsWith('charts/'));

  if (
    /oracle\/oci|resource\s+"oci_|provider\s+"oci"/.test(tfBlob) ||
    /tenancy_ocid|compartment_ocid/.test(tfBlob)
  ) {
    return ORACLE_OKE_HELM_PROFILE;
  }

  if (
    /hashicorp\/azurerm|provider\s+"azurerm"|azurerm_/.test(tfBlob) &&
    (hasCharts || /azurerm_kubernetes_cluster/.test(tfBlob))
  ) {
    return AZURE_AKS_HELM_PROFILE;
  }

  if (
    /azurerm_container_app|container_apps\.tf/.test(tfBlob) ||
    pathBlob.includes('azure-pipelines.yml')
  ) {
    return AZURE_GO_CONTAINER_APPS_PROFILE;
  }

  if (
    /hashicorp\/google|provider\s+"google"|google_cloud_run|google_container_cluster/.test(
      tfBlob
    )
  ) {
    if (hasCharts || /google_container_cluster/.test(tfBlob)) {
      return GCP_GKE_HELM_PROFILE;
    }
    return GCP_FASTAPI_CLOUDRUN_PROFILE;
  }

  if (
    /hashicorp\/aws|provider\s+"aws"|resource\s+"aws_/.test(tfBlob) ||
    pathBlob.includes('terraform/')
  ) {
    if (
      hasCharts ||
      /aws_eks_cluster|aws_eks_node_group|aws_eks_fargate/.test(tfBlob)
    ) {
      return AWS_EKS_HELM_PROFILE;
    }
    if (/aws_ecs_service|aws_ecs_cluster|ecs\.tf/.test(tfBlob + pathBlob)) {
      return AWS_ECS_EXPRESS_PROFILE;
    }
    // Default AWS + charts already handled; bare AWS → ECS profile (common QA)
    if (!hasCharts) return AWS_ECS_EXPRESS_PROFILE;
    return AWS_EKS_HELM_PROFILE;
  }

  if (hasCharts) return AWS_EKS_HELM_PROFILE;
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
        : profile.id === 'aws-eks-helm' || profile.id === 'oracle-oke-helm'
          ? 'Use these paths (Node stub under app/; Helm under charts/app/; Terraform under terraform/; workflow under .github/workflows/).'
          : 'Use these paths (Python app at repo root unless noted; Terraform under terraform/).';

  return `## LOCKED FILE MANIFEST (mandatory — PRD)
Emit a complete <<<FILE path="..." language="...">>> ... <<<END_FILE>>> block for **every** path below.
${pathHint}
Fragile stub paths (app entrypoints, Dockerfiles, package manifests) may already be seeded by StackForge — overwrite them only with an equally minimal /health stub, never a full business app.

${list}

Rules:
- Do NOT skip any file.
- Application-source paths in this manifest are minimal build/health-check stubs only. Do not add CRUD, authentication, UI, or business-domain behavior.
- README content belongs in README.md only — <<<SUMMARY>>> must be 2–3 sentences listing what was created.
- End SUMMARY with: "This is a reviewable starting scaffold — review before provisioning; it is not drop-in production code."
- Apply the PART B rules for this profile (B6 Azure / B8 ECS / B9 GCP / EKS-OKE Helm).`;
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
            : profile?.id === 'oracle-oke-helm'
              ? 'Oracle OKE + Helm + OCIR + GitHub Actions'
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
            : profile?.id === 'oracle-oke-helm'
              ? 'Apply OCI/OKE rules: real OCI provider pins, NSG least privilege, OCIR image refs, Helm probes on /health, GitHub Actions deploy notes.'
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
