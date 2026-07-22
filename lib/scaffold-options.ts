/**
 * Parsed interview / prompt choices that customize locked templates.
 * Presets (cloud/orchestrator/ci) stay separate; these fill the blanks.
 */
import type { Presets } from '@/types';

export type DatabaseKind = 'none' | 'postgres' | 'mysql' | 'redis' | 'mongodb';
export type DatabaseMode = 'standard' | 'ha' | 'ha_backup';
export type AccessMode = 'public_https' | 'public_basic' | 'private';
export type ScaleTier = 'small' | 'medium' | 'high';
export type RuntimeKind = 'node' | 'python' | 'go' | 'java' | 'dotnet';

export interface ScaffoldOptions {
  region: string;
  environments: string[];
  database: DatabaseKind;
  databaseMode: DatabaseMode;
  access: AccessMode;
  scale: ScaleTier;
  runtime: RuntimeKind;
}

const DEFAULT_REGION: Record<Presets['cloud'], string> = {
  aws: 'us-east-1',
  gcp: 'us-central1',
  azure: 'eastus',
  oracle: 'ap-mumbai-1',
};

export function defaultScaffoldOptions(presets: Presets): ScaffoldOptions {
  return {
    region: DEFAULT_REGION[presets.cloud] || 'us-east-1',
    environments: ['staging'],
    database: 'postgres',
    databaseMode: 'standard',
    access: 'private',
    scale: 'medium',
    runtime: 'node',
  };
}

/** Merge prompt + plan + chat text into concrete scaffold options. */
export function parseScaffoldOptions(
  text: string,
  presets: Presets
): ScaffoldOptions {
  const t = text.toLowerCase();
  const out = defaultScaffoldOptions(presets);

  // Region
  const regionMatch = t.match(
    /\b(us-east-1|us-west-2|eu-west-1|ap-south-1|us-central1|europe-west1|asia-south1|eastus|westeurope|centralindia|ap-mumbai-1|us-ashburn-1|eu-frankfurt-1)\b/
  );
  if (regionMatch) out.region = regionMatch[1];

  // Environments
  const wantsDev = /\bdevelopment\b|\bdev\b/.test(t);
  const wantsStaging = /\bstaging\b/.test(t);
  const wantsProd = /\bproduction\b|\bprod\b/.test(t);
  if (/\bone environment\b/.test(t) && !wantsDev && !wantsProd) {
    out.environments = ['staging'];
  } else if (wantsDev || wantsStaging || wantsProd) {
    const envs: string[] = [];
    if (wantsDev) envs.push('development');
    if (wantsStaging) envs.push('staging');
    if (wantsProd) envs.push('production');
    if (envs.length) out.environments = envs;
  }

  // Database kind
  if (
    /\bno data service\b|\bno database\b|\bwithout (a )?database\b|\bstateless\b/.test(
      t
    )
  ) {
    out.database = 'none';
  } else if (/\bmongodb\b|\bmongo\b/.test(t)) {
    out.database = 'mongodb';
  } else if (/\bmysql\b|\bmariadb\b/.test(t)) {
    out.database = 'mysql';
  } else if (/\bredis\b|\bvalkey\b/.test(t) && !/\bpostgres\b|\bmysql\b/.test(t)) {
    out.database = 'redis';
  } else if (/\bpostgres\b|\bpostgresql\b/.test(t)) {
    out.database = 'postgres';
  }

  // Database mode
  if (/\bhigh availability\b|\bmulti-?az\b|\bha\b/.test(t)) {
    out.databaseMode = 'ha';
  }
  if (/\b7-day\b|\bautomatic backups\b|\bbackup\b/.test(t)) {
    out.databaseMode = 'ha_backup';
  }
  if (/\bstandard private database\b/.test(t)) {
    out.databaseMode = 'standard';
  }

  // Access
  if (/\bprivate and internal only\b|\bprivate\/internal\b|\binternal only\b/.test(t)) {
    out.access = 'private';
  } else if (/\bpublic without a custom domain\b/.test(t)) {
    out.access = 'public_basic';
  } else if (/\bpublic with secure https\b|\bpublic with https\b/.test(t)) {
    out.access = 'public_https';
  }

  // Scale
  if (/\bsmall\b.*2 app|\b2 app copies\b/.test(t)) {
    out.scale = 'small';
  } else if (/\bmedium\b.*3 to 5|\b3 to 5 app copies\b/.test(t)) {
    out.scale = 'medium';
  } else if (/\bhigh traffic\b|\bautomatic scaling\b/.test(t)) {
    out.scale = 'high';
  }

  // Runtime
  if (/\bpython\b|\bfastapi\b|\bdjango\b/.test(t)) out.runtime = 'python';
  else if (/\bgolang\b|\b\bgo\b|\bgin\b/.test(t)) out.runtime = 'go';
  else if (/\bjava\b|\bspring\b/.test(t)) out.runtime = 'java';
  else if (/\.net\b|\bdotnet\b|\bc#\b/.test(t)) out.runtime = 'dotnet';
  else if (/\bnode\.?js\b|\bexpress\b|\bnext\.?js\b/.test(t)) out.runtime = 'node';

  return out;
}

export function scaleToReplicas(scale: ScaleTier): {
  replicaCount: number;
  minReplicas: number;
  maxReplicas: number;
  desiredCount: number;
} {
  switch (scale) {
    case 'small':
      return { replicaCount: 2, minReplicas: 2, maxReplicas: 4, desiredCount: 2 };
    case 'high':
      return { replicaCount: 4, minReplicas: 3, maxReplicas: 20, desiredCount: 4 };
    default:
      return { replicaCount: 3, minReplicas: 3, maxReplicas: 5, desiredCount: 3 };
  }
}

export function regionVarName(cloud: Presets['cloud']): string {
  if (cloud === 'gcp') return 'region';
  if (cloud === 'azure') return 'location';
  if (cloud === 'oracle') return 'region';
  return 'aws_region';
}
