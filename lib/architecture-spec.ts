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
import type { Presets } from '@/types';

export interface ArchitectureSpec {
  presets: Presets;
  options: ScaffoldOptions;
  /** The confirmed interview block, or the original request for direct prompts. */
  source: string;
  issues: string[];
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
  const source = (params.interviewAnswers || params.prompt).trim();
  const presets = inferPresetsFromPrompt(
    [params.prompt, params.interviewAnswers || ''].filter(Boolean).join('\n'),
    params.presets
  );
  const options = parseScaffoldOptions(source, presets);
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
  return { presets, options, source, issues };
}

/** Stable, model-readable context for plan generation. */
export function formatArchitectureSpecForPrompt(spec: ArchitectureSpec): string {
  const { presets, options } = spec;
  return `## Validated architecture specification (authoritative)
- Cloud: ${presets.cloud}
- Hosting/orchestrator: ${presets.orchestrator}
- CI/CD: ${presets.ci}
- Region: ${options.region}
- Environments: ${options.environments.join(', ')}
- API access: ${labelForAccess(options.access)}
- Data service: ${labelForDatabase(options.database)}
- Health-check runtime: ${labelForRuntime(options.runtime)}
- Scale tier: ${options.scale}

Use every value above exactly. Do not introduce a different cloud, region, CI/CD system, database/cache, environment, runtime, or access mode.`;
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
  if (options.runtime === 'java' && /spring boot-based|demoapplication\.java/i.test(normalized)) {
    issues.push('Plan promotes Spring Boot even though only Java was confirmed.');
  }
  if (options.runtime === 'dotnet' && /asp\.net (?:controllers|services)/i.test(normalized)) {
    issues.push('Plan promotes an ASP.NET application even though only .NET was confirmed.');
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

  return [...new Set(issues)];
}
