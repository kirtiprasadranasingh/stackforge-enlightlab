/**
 * The single, validated source of truth for a StackForge run.
 *
 * Plans and generated scaffolds must be derived from this value, never by
 * re-parsing an earlier plan or the whole chat transcript.  The model may
 * explain the spec, but it is not allowed to change it.
 */
import { CI_LABELS, validateRegionForCloud } from '@/lib/clarifying-questions';
import { inferPresetsFromPrompt } from '@/lib/infer-presets';
import { parseScaffoldOptions, type ScaffoldOptions } from '@/lib/scaffold-options';
import { detectScaffoldProfile } from '@/lib/scaffold-spec';
import { mergeLockedBaseFiles } from '@/lib/scaffold-base-files';
import { normalizeScaffoldFiles } from '@/lib/normalize-scaffold';
import type { GeneratedFile, Presets } from '@/types';

const NATIVE_CI_CLOUD: Partial<Record<Presets['ci'], Presets['cloud']>> = {
  'aws-codepipeline': 'aws',
  'gcp-cloud-build': 'gcp',
  'oci-devops': 'oracle',
};
export const REQUIREMENTS_MANIFEST_PATH = '.stackforge/requirements.json';

export interface ArchitectureSpec {
  presets: Presets;
  options: ScaffoldOptions;
  /** The confirmed interview block, or the original request for direct prompts. */
  source: string;
  issues: string[];
}

export interface RequirementsManifest {
  version: 1;
  presets: Presets;
  options: ScaffoldOptions;
}

/**
 * The architecture-plan manifest must come from the same locked profile that
 * generates the ZIP. This prevents an LLM from inventing plausible-looking
 * files (for example alb_controller.tf or artifact_registry.tf) that do not
 * exist in the approved scaffold.
 */
export function generatedFilePathsForSpec(spec: ArchitectureSpec): string[] {
  const profile = detectScaffoldProfile(spec.source, spec.presets);
  if (!profile) return [REQUIREMENTS_MANIFEST_PATH];
  const merged = mergeLockedBaseFiles([], profile, {
    fillMissing: true,
    forceStubs: true,
    presets: spec.presets,
    scaffoldOptions: spec.options,
  }).files;
  // Production generation normalizes after the locked merge (including the
  // selected CI file). The plan must mirror that final output, not the
  // intermediate base where a profile may still carry GitHub Actions.
  const files = normalizeScaffoldFiles(merged, {
    profile,
    presets: spec.presets,
    scaffoldOptions: spec.options,
  });
  const paths = files.map((file) => file.path.replace(/\\/g, '/')).map((path) => {
    // Cloud Run and Container Apps runtime stubs are emitted at repository
    // root. Keep the plan manifest aligned even if an intermediate normalizer
    // retained an app/ path before the final generation pass.
    if (
      (spec.presets.orchestrator === 'cloud-run' || spec.presets.orchestrator === 'container-apps') &&
      /^app\/(?:Dockerfile|Program\.cs|app\.csproj|main\.py|requirements\.txt|main\.go|go\.mod|go\.sum)$/.test(path)
    ) {
      return path.slice(4);
    }
    return path;
  });

  // applyScaffoldOptions generates environments/${env}.tfvars for every selected
  // environment, but normalizeScaffoldFiles does not call applyScaffoldOptions.
  // Add them explicitly so validatePlanAgainstSpec knows they are produced files
  // and doesn't reject a plan that correctly lists them in its file manifest.
  const envPaths = (spec.options.environments || []).map(
    (env) => `environments/${env}.tfvars`
  );

  return [REQUIREMENTS_MANIFEST_PATH, ...paths, ...envPaths]
    .filter((path, index, paths) => paths.indexOf(path) === index);
}

function generatedManifestBlock(spec: ArchitectureSpec): string {
  return generatedFilePathsForSpec(spec).map((path) => `- \`${path}\``).join('\n');
}

export function createRequirementsManifest(spec: ArchitectureSpec): GeneratedFile {
  const manifest: RequirementsManifest = {
    version: 1,
    presets: spec.presets,
    options: spec.options,
  };
  return {
    path: REQUIREMENTS_MANIFEST_PATH,
    language: 'json',
    content: `${JSON.stringify(manifest, null, 2)}\n`,
    description: 'Validated StackForge requirements contract',
  };
}

export function readRequirementsManifest(
  files: Array<Pick<GeneratedFile, 'path' | 'content'>>
): RequirementsManifest | null {
  const raw = files.find((file) => file.path === REQUIREMENTS_MANIFEST_PATH)?.content;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RequirementsManifest>;
    if (
      parsed.version !== 1 ||
      !parsed.presets ||
      !parsed.options ||
      typeof parsed.presets.cloud !== 'string' ||
      typeof parsed.presets.orchestrator !== 'string' ||
      typeof parsed.presets.ci !== 'string' ||
      typeof parsed.options.runtime !== 'string' ||
      typeof parsed.options.database !== 'string' ||
      !Array.isArray(parsed.options.environments)
    ) {
      return null;
    }
    return parsed as RequirementsManifest;
  } catch {
    return null;
  }
}

type OptionKey = keyof ScaffoldOptions;

function hasExplicitValue(text: string, key: OptionKey): boolean {
  const value = text.toLowerCase();
  switch (key) {
    case 'region':
      return /\b(us-east-1|us-west-2|eu-west-1|ap-south-1|us-central1|europe-west1|asia-south1|eastus|eastus2|westus|westeurope|northeurope|centralindia|ap-mumbai-1|us-ashburn-1|eu-frankfurt-1|uk-london-1|me-jeddah-1)\b/.test(value) ||
        /^(?:use|set|change|switch|to\s+)?([a-z0-9-]+)$/i.test(value.trim());
    case 'environments':
      return /\b(one environment|development|staging|production)\b/.test(value);
    case 'database':
      return /\b(redis|valkey|postgres(?:ql)?|mysql|mariadb|mongodb|mongo|no data service|without (?:a )?database)\b/.test(value);
    case 'databaseMode':
      return /\b(high availability|multi-?az|7-day|automatic backups|standard private database)\b/.test(value);
    case 'access':
      return /\b(private and internal only|private\/internal|public without a custom domain|public http on the default (?:load[- ]?balancer|alb|lb) hostname|public with (?:secure )?https|default (?:load[- ]?balancer|alb|lb) hostname)\b/.test(value);
    case 'scale':
      return /\b(small|medium|high traffic|automatic scaling|[2-5] app copies)\b/.test(value);
    case 'runtime':
      return /\b(node\.?js|express|python|go(?:lang)?|java|\.net|dotnet|c#)\b/.test(value);
  }
}

/**
 * Preserve requirements named in the original prompt. An explicit user prompt
 * (such as a bare region correction "westeurope" or "eastus") overrides older
 * interview answers.
 */
function mergePromptAndInterviewOptions(
  prompt: string,
  interviewAnswers: string | undefined,
  presets: Presets
): ScaffoldOptions {
  const promptOptions = parseScaffoldOptions(prompt, presets);
  if (!interviewAnswers?.trim()) return promptOptions;

  const answerOptions = parseScaffoldOptions(interviewAnswers, presets);
  const merged = { ...answerOptions };

  for (const key of Object.keys(merged) as OptionKey[]) {
    if (hasExplicitValue(prompt, key)) {
      merged[key] = promptOptions[key] as never;
    }
  }
  return merged;
}

const CLOUD_FORBIDDEN_TERMS: Record<Presets['cloud'], RegExp[]> = {
  aws: [
    /\bAzure Key Vault\b/i,
    /\bApplication Gateway\b/i,
    /\bOCI Vault\b/i,
    /\bOCIR\b/i,
    /\bGoogle Secret Manager\b/i,
  ],
  azure: [
    /\bAWS Secrets Manager\b/i,
    /\bAmazon ECR\b/i,
    /\bOCI Vault\b/i,
    /\bOCIR\b/i,
    /\bGoogle Secret Manager\b/i,
  ],
  gcp: [
    /\bAWS Secrets Manager\b/i,
    /\bAmazon ECR\b/i,
    /\bAzure Key Vault\b/i,
    /\bApplication Gateway\b/i,
    /\bOCI Vault\b/i,
    /\bOCIR\b/i,
  ],
  oracle: [
    /\bAWS Secrets Manager\b/i,
    /\bAmazon ECR\b/i,
    /\bAzure Key Vault\b/i,
    /\bApplication Gateway\b/i,
    /\bGoogle Secret Manager\b/i,
  ],
};

function labelForDatabase(database: ScaffoldOptions['database']): string {
  switch (database) {
    case 'none':
      return 'No data service';
    case 'redis':
      return 'Redis cache';
    case 'postgres':
      return 'PostgreSQL';
    case 'mysql':
      return 'MySQL';
    case 'mongodb':
      return 'MongoDB requested';
  }
}

function labelForAccess(access: ScaffoldOptions['access']): string {
  if (access === 'private') return 'Private and internal only';
  if (access === 'public_basic') return 'Public without a custom domain';
  return 'Public with secure HTTPS';
}

function labelForRuntime(runtime: ScaffoldOptions['runtime']): string {
  return runtime === 'node' ? 'Node.js' : runtime === 'dotnet' ? '.NET' : runtime[0].toUpperCase() + runtime.slice(1);
}

/** Helm is a Kubernetes packaging tool; ECS has a different deployment model. */
function hasEcsHelmConflict(text: string, presets: Presets): boolean {
  return (
    presets.cloud === 'aws' &&
    presets.orchestrator === 'ecs' &&
    /\b(?:helm|kubernetes|k8s)\b/i.test(text)
  );
}

/** StackForge deliberately produces one coherent provider scaffold per run. */
function requestsMultipleClouds(text: string): boolean {
  const promptLines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const revisionIndex = promptLines.findIndex((l) => l.toLowerCase().includes('revision feedback'));
  const latestPrompt = revisionIndex !== -1 && revisionIndex + 1 < promptLines.length 
    ? promptLines.slice(revisionIndex + 1).join('\n') 
    : promptLines[promptLines.length - 1] || text;
  
  const lower = latestPrompt.toLowerCase();
  if (/\b(?:every|all|multiple|multi)[ -]?(?:cloud|provider)s?\b|\bsimultaneously\b/.test(lower)) {
    return true;
  }
  const clouds = [
    /\baws\b|amazon web services/,
    /\bazure\b|microsoft azure/,
    /\b(?:gcp|google cloud)\b/,
    /\b(?:oci|oracle cloud)\b/,
  ].filter((pattern) => pattern.test(lower));
  return clouds.length > 1 && /\b(?:deploy|provision|build|create|use)\b/.test(lower);
}

function interviewCorrectedToOneCloud(text: string | undefined): boolean {
  if (!text?.trim()) return false;
  return /(?:cloud provider|which cloud should we use|client override|\bcloud\b)\s*(?:\([^)]*\))?\s*:\s*(?:AWS|Amazon Web Services|Microsoft Azure|Azure|Google Cloud|GCP|Oracle Cloud|OCI)\b/i.test(
    text
  ) || /\b(?:use|deploy on)\s+(?:aws|amazon|azure|microsoft|gcp|google|oci|oracle)\s+(?:as|for)\s+(?:the\s+)?(?:primary\s+)?(?:cloud|provider)\b/i.test(text);
}

function requestedUnimplementedModules(text: string): string[] {
  const modules: string[] = [];
  if (/\b(?:cdn|content delivery network)\b/i.test(text)) modules.push('CDN');
  if (/\bmonitoring\b/i.test(text)) modules.push('managed monitoring');
  if (/\blogging\b/i.test(text)) modules.push('centralized logging');
  if (/\b(?:disaster recovery|cross[- ]region recovery|multi[- ]region recovery)\b/i.test(text)) {
    modules.push('disaster recovery');
  }
  return [...new Set(modules)];
}

/** Build the final requirements once, with no plan prose as an input. */
export function buildArchitectureSpec(params: {
  prompt: string;
  interviewAnswers?: string;
  presets: Presets;
}): ArchitectureSpec {
  const rawSource = [params.prompt, params.interviewAnswers || ''].filter(Boolean).join('\n').trim();
  const presets = inferPresetsFromPrompt(
    [params.prompt, params.interviewAnswers || ''].filter(Boolean).join('\n'),
    params.presets
  );
  const options = mergePromptAndInterviewOptions(params.prompt, params.interviewAnswers, presets);
  // The original conversation can omit an item that was supplied by the
  // selected profile (most often CI/CD).  Keep the raw request, but append a
  // canonical recap so downstream sanitizers and generators never mistake a
  // selected default for an unconfirmed requirement.
  const source = [
    rawSource,
    'Confirmed requirements (canonical):',
    `Cloud: ${presets.cloud}`,
    `Hosting/orchestrator: ${presets.orchestrator}`,
    `CI/CD system: ${CI_LABELS[presets.ci]}`,
    `Region: ${options.region}`,
    `Environments: ${options.environments.join(', ')}`,
    `API access: ${labelForAccess(options.access)}`,
    `Data service: ${labelForDatabase(options.database)}`,
    `Health-check runtime: ${labelForRuntime(options.runtime)}`,
  ].join('\n');
  const multipleClouds = requestsMultipleClouds(params.prompt) &&
    !interviewCorrectedToOneCloud(params.interviewAnswers) &&
    !interviewCorrectedToOneCloud(params.prompt);

  if (multipleClouds) {
    return {
      isValid: false,
      issues: [
        'StackForge generates one cloud provider scaffold per project so the architecture, Terraform, CI/CD, and validation stay consistent. Choose one primary cloud, or create a separate project for each cloud.'
      ],
      presets,
      options,
    };
  }

  const region = validateRegionForCloud(options.region, presets.cloud);
  const issues: string[] = [];

  // Do not silently "map" a cross-cloud region to a default.  The UI should
  // ask again and the API must refuse to make a plan/code from it.
  if (!region.isValid) {
    issues.push(region.feedback || `Invalid ${presets.cloud} region: ${options.region}`);
  }
  const nativeCiCloud = NATIVE_CI_CLOUD[presets.ci];
  if (nativeCiCloud && nativeCiCloud !== presets.cloud) {
    issues.push(
      `${CI_LABELS[presets.ci]} is a provider-native CI/CD service and the locked adapter only targets ${nativeCiCloud.toUpperCase()}. Choose GitHub Actions, GitLab CI, Jenkins, or Azure DevOps for cross-cloud delivery, or change the cloud to ${nativeCiCloud.toUpperCase()}.`
    );
  }
  if (hasEcsHelmConflict(rawSource, presets)) {
    issues.push(
      'Amazon ECS cannot deploy Kubernetes Helm charts. Choose Amazon EKS with Helm, or keep Amazon ECS and use ECS task definitions/services instead, before generating a plan.'
    );
  }
  
  const unimplementedModules = params.interviewAnswers?.trim()
    ? requestedUnimplementedModules(params.prompt)
    : [];
  if (unimplementedModules.length > 0) {
    issues.push(
      `The current locked scaffold does not yet generate these explicitly requested modules: ${unimplementedModules.join(', ')}. Remove them to generate the supported base scaffold, or add provider-specific locked adapters before approval; StackForge will not silently omit them or promise code it cannot generate.`
    );
  }
  if (options.database === 'mongodb') {
    issues.push(
      'MongoDB is not supported by the locked infrastructure templates. Choose PostgreSQL, MySQL, Redis cache, or no data service before generating a plan.'
    );
  }
  // A cache/database request is a production-valid requirement, but it cannot
  // be silently fulfilled by a different service. Block before approval until
  // the selected profile has a provider-native locked adapter.
  if (
    options.database === 'redis' &&
    ((presets.cloud === 'azure' && presets.orchestrator === 'container-apps') ||
      (presets.cloud === 'oracle' && presets.orchestrator === 'oke'))
  ) {
    issues.push(
      `Redis/Valkey is not yet implemented for the locked ${presets.orchestrator.toUpperCase()} template. Choose PostgreSQL, MySQL, no data service, or a profile with a provider-native Redis adapter before generating a plan.`
    );
  }
  if (
    options.database === 'postgres' &&
    presets.cloud === 'oracle' &&
    presets.orchestrator === 'oke'
  ) {
    issues.push(
      'PostgreSQL is not yet implemented for the locked OKE template. The template must not substitute MySQL HeatWave for a PostgreSQL request; choose MySQL or another supported profile before generating a plan.'
    );
  }
  if (
    presets.cloud === 'aws' &&
    options.access === 'public_basic' &&
    /https[^\n]{0,80}default (?:load[- ]?balancer|alb|lb) hostname|default (?:load[- ]?balancer|alb|lb) hostname[^\n]{0,80}https/i.test(source)
  ) {
    issues.push(
      'Trusted HTTPS cannot be issued for the provider-owned default AWS load-balancer hostname. Choose public HTTP on the default hostname, or provide a custom domain for ACM HTTPS.'
    );
  }
  return { presets, options, source, issues };
}

/** Stable, model-readable context for plan generation. */
export function formatArchitectureSpecForPrompt(spec: ArchitectureSpec): string {
  const { presets, options } = spec;
  const eksDelivery =
    presets.cloud === 'aws' && presets.orchestrator === 'eks'
      ? options.access === 'private'
        ? '\n- Private EKS delivery: the locked scaffold emits a Helm ClusterIP Service with ingress disabled. It does NOT create an ALB, AWS Load Balancer Controller, IRSA/pod identity, NGINX ingress, custom domain, or private DNS. Do not promise those resources or their Terraform files.'
        : options.access === 'public_https'
          ? '\n- Public EKS delivery: the locked scaffold emits a Kubernetes Service type LoadBalancer on an AWS-assigned public hostname. It does NOT create a custom domain, Route 53/DNS record, ACM certificate, HTTPS ingress, ALB controller, IRSA/pod identity, or Cluster Autoscaler. State those as customer-provided production follow-up configuration; never claim they are generated. Do not describe ECS, NGINX ingress, or app.example.com for this path.'
          : '\n- Public EKS delivery: Kubernetes Service type LoadBalancer (AWS-assigned public hostname, HTTP by default). It does NOT create an ALB controller, IRSA/pod identity, or NGINX ingress. Do not describe ECS or app.example.com for this path.'
      : '';
  return `## Validated architecture specification (authoritative)
- Cloud: ${presets.cloud}
- Hosting/orchestrator: ${presets.orchestrator}
- CI/CD: ${presets.ci}
- Region: ${options.region}
- Environments: ${options.environments.join(', ')}
- API access: ${labelForAccess(options.access)}${options.access === 'public_basic' ? ' (HTTP on the provider default hostname; custom domain required for trusted HTTPS)' : ''}
- Data service: ${labelForDatabase(options.database)}
- Health-check runtime: ${labelForRuntime(options.runtime)}
- Scale tier: ${options.scale}${eksDelivery}

Use every value above exactly. Do not introduce a different cloud, region, CI/CD system, database/cache, environment, runtime, or access mode.

## Locked generated file manifest (authoritative)
The approved scaffold will contain exactly these generated paths. Reproduce this list under the plan's **File manifest** heading. Do not promise any other Terraform file, CI file, controller, certificate, registry integration, or cloud resource as generated; describe anything not represented here as a follow-up.
${generatedManifestBlock(spec)}`;
}

/**
 * Contract checks deliberately use a small deterministic vocabulary.  They
 * catch template leakage and contradiction before a plan reaches approval;
 * Gemini is then used only to repair the rejected prose.
 */
export function validatePlanAgainstSpec(plan: string, spec: ArchitectureSpec): string[] {
  const issues: string[] = [];
  const normalized = plan || '';
  const lower = normalized.toLowerCase();
  const { presets, options } = spec;

  if (!normalized.trim()) return ['The model did not return an architecture plan.'];
  const manifestMatch = /(^##\s*File manifest\s*$)([\s\S]*?)(?=^##\s+|(?![\s\S]))/im.exec(normalized);
  const expectedFiles = generatedFilePathsForSpec(spec);
  if (!manifestMatch) {
    issues.push('Plan is missing the locked generated file manifest.');
  } else {
    const manifest = manifestMatch[2];
    const missingFiles = expectedFiles.filter((path) => !manifest.includes(path));
    if (missingFiles.length) {
      issues.push(`Plan file manifest is missing generated paths: ${missingFiles.join(', ')}.`);
    }
    const mentionedFiles = manifest.match(/(?:\.github\/[^\s`]+|terraform\/[\w./-]+|charts\/[\w./-]+|app\/[\w./-]+|environments\/[\w./-]+|(?:^|\n)\s*[-*]\s*`?(?:Dockerfile|main\.py|main\.go|go\.mod|go\.sum|requirements\.txt|README\.md|\.gitlab-ci\.yml|azure-pipelines\.yml|Jenkinsfile|buildspec\.yml|cloudbuild\.yaml))/gim) || [];
    const unexpectedFiles = mentionedFiles
      .map((entry) => entry.trim().replace(/^[-*]\s*/, '').replace(/^`|`$/g, ''))
      .filter((path) => !expectedFiles.includes(path));
    if (unexpectedFiles.length) {
      issues.push(`Plan file manifest promises paths not generated by the locked profile: ${[...new Set(unexpectedFiles)].join(', ')}.`);
    }
  }
  if (!lower.includes(options.region.toLowerCase())) {
    issues.push(`Plan is missing the confirmed region ${options.region}.`);
  }
  const ciLabel = CI_LABELS[presets.ci].toLowerCase();
  if (!lower.includes(ciLabel) && !lower.includes(presets.ci)) {
    issues.push(`Plan is missing the confirmed CI/CD provider ${presets.ci}.`);
  }
  if (/ci\/cd (?:was )?not confirmed/i.test(normalized)) {
    issues.push('Plan says CI/CD was not confirmed even though the interview selected it.');
  }

  for (const forbidden of CLOUD_FORBIDDEN_TERMS[presets.cloud]) {
    if (forbidden.test(normalized)) {
      issues.push(`Plan contains a service from another cloud: ${forbidden.source}.`);
    }
  }
  if (presets.cloud === 'aws' && presets.orchestrator === 'eks' && /\b(ECS Fargate|AWS ECS template|aws_ecs_)\b/i.test(normalized)) {
    issues.push('EKS plan contains ECS-specific template assumptions.');
  }

  if (options.database === 'redis') {
    if (/data service:\s*(?:no database|no data service|postgres|mysql)/i.test(normalized)) {
      issues.push('Plan contradicts the Redis cache selection in its data-service summary.');
    }
    if (!/\b(redis|elasticache|valkey)\b/i.test(normalized)) {
      issues.push('Plan is missing the selected Redis cache.');
    }
  }
  if (options.database === 'none' && /\b(RDS|PostgreSQL|MySQL|Redis|ElastiCache|Cloud SQL)\b/i.test(normalized)) {
    issues.push('Plan introduces a database/cache even though No data service was selected.');
  }
  if (options.database === 'mongodb' && /terraform\/mongodb\.tf|aws_docdb_|mongodbatlas_/i.test(normalized)) {
    issues.push('Plan promises unsupported full MongoDB infrastructure.');
  }
  if (
    options.databaseMode === 'standard' &&
    /\b(?:multi[- ]?az|high availability|regional ha)\b/i.test(normalized)
  ) {
    issues.push('Plan adds high availability even though the standard database mode was selected.');
  }

  const runtime = labelForRuntime(options.runtime).toLowerCase();
  if (!lower.includes(runtime)) {
    issues.push(`Plan is missing the selected ${labelForRuntime(options.runtime)} runtime.`);
  }
  const javaFrameworkPromotion = normalized
    .split('\n')
    .some(
      (line) =>
        /spring boot-based|demoapplication\.java/i.test(line) &&
        !/\b(?:not|never)\b[^.\n]{0,80}\b(?:confirm|choose|select|request)/i.test(line)
    );
  if (options.runtime === 'java' && javaFrameworkPromotion) {
    issues.push('Plan promotes Spring Boot even though only Java was confirmed.');
  }
  if (options.runtime === 'java' && /health-check runtime was not confirmed|node\.js .*default scaffold placeholder/i.test(normalized)) {
    issues.push('Plan contradicts the confirmed Java runtime with a Node.js default assumption.');
  }
  if (options.runtime === 'java' && /\bJava(?:\s*\([^)]*\))?\s+is not selected\b/i.test(normalized)) {
    issues.push('Plan says Java is not selected even though Java is the confirmed runtime.');
  }
  // The locked .NET stub is deliberately a minimal ASP.NET Core `/health`
  // endpoint. It is an implementation default, not a client choice of
  // controllers, services, or a full application framework.
  if (options.runtime === 'dotnet') {
    const undisclosedFrameworkPromotion = normalized
      .split('\n')
      .some(
        (line) =>
          /asp\.net (?:controllers|services)|full asp\.net application/i.test(line) &&
          !/not confirmed|implementation default|minimal .*\/health/i.test(line)
      );
    if (undisclosedFrameworkPromotion) {
      issues.push('Plan promotes ASP.NET controllers/services even though only .NET was confirmed.');
    }
  }

  for (const env of options.environments) {
    if (!new RegExp(`\\b${env}\\b`, 'i').test(normalized)) {
      issues.push(`Plan is missing the confirmed ${env} environment.`);
    }
  }


  if (options.access === 'private' && /public with secure https|public without a custom domain/i.test(normalized)) {
    issues.push('Plan contradicts the private/internal access selection.');
  }
  if (
    options.access === 'private' &&
    /\b(?:public ingress|internet[- ]facing ingress|public load balancer)\b/i.test(normalized)
  ) {
    issues.push('Plan exposes a public ingress/load balancer despite the private/internal access selection.');
  }
  if (options.access === 'public_basic' && /client confirmed public with secure https/i.test(normalized)) {
    issues.push('Plan changes default-hostname public access into custom-domain HTTPS.');
  }
  const presentsHttpOnlyAsFinal = normalized.split('\n').some(
    (line) =>
      /\b(?:http-only|http only)\b[^\n]{0,100}\b(?:final|production|custom domain|https)\b|\b(?:final|production|custom domain|https)\b[^\n]{0,100}\b(?:http-only|http only)\b/i.test(line) &&
      !/\b(?:not final|not the final|do not treat|must not describe)\b/i.test(line)
  );
  if (options.access === 'public_https' && presentsHttpOnlyAsFinal) {
    issues.push('Plan presents HTTP-only delivery as the final result despite the confirmed custom HTTPS requirement.');
  }
  const expectedScale = options.scale === 'small' ? 'small' : options.scale === 'medium' ? 'medium' : 'high traffic';
  if (!new RegExp(`scale tier:\\s*${expectedScale}`, 'i').test(normalized)) {
    issues.push(`Plan does not preserve the confirmed ${expectedScale} scale tier.`);
  }
  if (presets.cloud === 'aws' && presets.orchestrator === 'eks' && options.access === 'public_https') {
    const promisesUnshippedTls = normalized
      .split('\n')
      .some(
        (line) =>
          /(?:create|provision|configure|generate|deploy).*(?:ACM|AWS Certificate Manager|Route ?53|DNS (?:record|zone)|HTTPS ingress|custom domain)|(?:ACM|AWS Certificate Manager|Route ?53|DNS (?:record|zone)|HTTPS ingress|custom domain).*(?:will be|is generated|is configured)/i.test(
            line
          ) && !/does not|not create|follow-up|customer-provided|provide the domain/i.test(line)
      );
    if (promisesUnshippedTls) {
      issues.push('EKS plan promises custom-domain HTTPS resources that the locked scaffold does not generate.');
    }
    if (/\bCluster Autoscaler\b/i.test(normalized) && !/does\s+(?:\*+\s*)?not(?:\s*\*+)?\s+create|not\s+create/i.test(normalized)) {
      issues.push('EKS plan promises Cluster Autoscaler even though the locked scaffold only configures application HPA/node-group bounds.');
    }
  }
  if (presets.cloud === 'aws' && presets.orchestrator === 'eks') {
    const unshippedEksIntegration = normalized
      .split('\n')
      .some(
        (line) =>
          /(?:AWS )?(?:Application )?Load Balancer|AWS Load Balancer Controller|\bIRSA\b|pod identity|terraform\/(?:alb(?:_controller)?|ecr|rds)\.tf/i.test(line) &&
          !/does\s+(?:\*+\s*)?not(?:\s*\*+)?(?:\s+create|\s+generate)|not\s+(?:create|generated)|follow-up|out of scope/i.test(line)
      );
    if (unshippedEksIntegration) {
      issues.push('EKS plan promises an ALB/controller/IRSA or Terraform file that the locked EKS scaffold does not generate.');
    }
  }
  if (presets.cloud === 'gcp' && presets.orchestrator === 'cloud-run' && options.access === 'public_https') {
    const unshippedDomainResources = normalized
      .split('\n')
      .some(
        (line) =>
          /\bgoogle_dns_(?:managed_zone|record_set)\b|\bCloud Run Domain Mapping\b|\bgoogle_cloud_run_domain_mapping\b|\bGoogle-managed (?:SSL )?certificate\b/i.test(line) &&
          !/does not|not create|not generated|follow-up|boundary/i.test(line)
      );
    if (unshippedDomainResources) {
      issues.push('Cloud Run plan promises custom-domain/DNS/certificate resources that the locked scaffold does not generate.');
    }
  }
  if (presets.cloud === 'azure' && presets.orchestrator === 'aks' && options.access === 'private') {
    const unshippedPrivateAks = normalized
      .split('\n')
      .some(
        (line) =>
          /\bprivate AKS cluster\b|\binternal ingress controller\b|\bAzure Private DNS Zone\b|\bPrivate Link\b|\bPrivate Endpoint\b/i.test(line) &&
          !/does not|not create|not generated|follow-up|boundary/i.test(line)
      );
    if (unshippedPrivateAks) {
      issues.push('Private AKS plan promises control-plane/ingress/private-network resources that the locked scaffold does not generate.');
    }
  }
  if (presets.cloud === 'gcp' && presets.orchestrator === 'gke') {
    const unshippedGkeIdentity = normalized
      .split('\n')
      .some(
        (line) =>
          /google_container_node_pool|\b(?:separate |managed )?node[ -]?pools?\b|Workload Identity(?: Federation)?|\b(?:Google|GCP) IAM\b|google_service_account|google_project_iam_member|service accounts? for GKE nodes|GitHub Actions service account/i.test(line) &&
          !/does not|not create|follow-up|extension point/i.test(line)
      );
    if (unshippedGkeIdentity) {
      issues.push('GKE plan promises node-pool or Google IAM/WIF resources that the locked Autopilot profile does not generate.');
    }
  }

  return [...new Set(issues)];
}
