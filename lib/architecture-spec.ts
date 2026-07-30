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
  return [REQUIREMENTS_MANIFEST_PATH, ...files.map((file) => file.path.replace(/\\/g, '/'))]
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
      return /\b(us-east-1|us-west-2|eu-west-1|ap-south-1|us-central1|europe-west1|asia-south1|eastus|westeurope|centralindia|ap-mumbai-1|us-ashburn-1|eu-frankfurt-1|uk-london-1|me-jeddah-1)\b/.test(value);
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
 * Preserve requirements named in the original prompt.  An interview response
 * overrides a field only when it actually names a value for that field; its
 * parser defaults must never erase (for example) "Java" from the prompt.
 */
function mergePromptAndInterviewOptions(
  prompt: string,
  interviewAnswers: string | undefined,
  presets: Presets
): ScaffoldOptions {
  const promptOptions = parseScaffoldOptions(prompt, presets);
  if (!interviewAnswers?.trim()) return promptOptions;

  const answerOptions = parseScaffoldOptions(interviewAnswers, presets);
  const merged = { ...promptOptions };
  for (const key of Object.keys(merged) as OptionKey[]) {
    if (hasExplicitValue(interviewAnswers, key)) {
      merged[key] = answerOptions[key] as never;
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
  const region = validateRegionForCloud(options.region, presets.cloud);
  const issues: string[] = [];

  // Do not silently "map" a cross-cloud region to a default.  The UI should
  // ask again and the API must refuse to make a plan/code from it.
  if (!region.isValid) {
    issues.push(region.feedback || `Invalid ${presets.cloud} region: ${options.region}`);
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
    ((presets.cloud === 'gcp' && presets.orchestrator === 'gke') ||
      (presets.cloud === 'azure' && presets.orchestrator === 'container-apps') ||
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
  if (options.environments.length === 1) {
    const only = options.environments[0];
    const extras = ['development', 'staging', 'production'].filter((env) => env !== only);
    if (extras.some((env) => new RegExp(`(?:one environment|confirmed requirements)[\\s\\S]{0,180}\\b${env}\\b`, 'i').test(normalized))) {
      issues.push('Plan invents extra environments for a one-environment selection.');
    }
  }

  if (options.access === 'private' && /public with secure https|public without a custom domain/i.test(normalized)) {
    issues.push('Plan contradicts the private/internal access selection.');
  }
  if (options.access === 'public_basic' && /client confirmed public with secure https/i.test(normalized)) {
    issues.push('Plan changes default-hostname public access into custom-domain HTTPS.');
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

  return [...new Set(issues)];
}
