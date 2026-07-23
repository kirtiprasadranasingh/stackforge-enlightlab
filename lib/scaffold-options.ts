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

/**
 * Clarifying questions embed menus like `(options: Node.js / Go / Python / …)`.
 * Matching those lists made every interview look like Python + Redis were chosen.
 * Strip menus before keyword scans; prefer explicit client overrides.
 */
function stripOptionMenus(text: string): string {
  return text.replace(/\(options:\s*[^)]+\)/gi, ' ');
}

function runtimeFromPhrase(phrase: string): RuntimeKind | null {
  const v = phrase.toLowerCase();
  if (/\bpython\b|\bfastapi\b|\bdjango\b|\bflask\b/.test(v)) return 'python';
  if (/\bgolang\b|\bgo\b|\bgin\b/.test(v)) return 'go';
  if (/\bjava\b|\bspring\b/.test(v)) return 'java';
  if (/\.net\b|\bdotnet\b|\bc#\b|\basp\.?\s*net\b/.test(v)) return 'dotnet';
  if (/\bnode\.?js\b|\bnodejs\b|\bexpress\b|\bnext\.?js\b|\bnestjs\b/.test(v)) {
    return 'node';
  }
  return null;
}

function databaseFromPhrase(phrase: string): DatabaseKind | null {
  const v = phrase.toLowerCase();
  if (/\bno data service\b|\bnone\b|\bwithout (a )?database\b/.test(v)) {
    return 'none';
  }
  if (/\bmongodb\b|\bmongo\b|\bdocumentdb\b/.test(v)) return 'mongodb';
  if (/\bredis\b|\bvalkey\b/.test(v)) return 'redis';
  if (/\bmysql\b|\bmariadb\b/.test(v)) return 'mysql';
  if (/\bpostgres\b|\bpostgresql\b/.test(v)) return 'postgres';
  return null;
}

/** Merge prompt + plan + chat text into concrete scaffold options. */
export function parseScaffoldOptions(
  text: string,
  presets: Presets
): ScaffoldOptions {
  const raw = text;
  // Ignore option menus so listed alternatives cannot override the real pick.
  const t = stripOptionMenus(raw).toLowerCase();
  const out = defaultScaffoldOptions(presets);

  // Region
  const regionMatch = t.match(
    /\b(us-east-1|us-west-2|eu-west-1|ap-south-1|us-central1|europe-west1|asia-south1|eastus|westeurope|centralindia|ap-mumbai-1|us-ashburn-1|eu-frankfurt-1|uk-london-1|me-jeddah-1)\b/
  );
  if (regionMatch) out.region = regionMatch[1];

  // Environments — prefer explicit interview phrases; avoid matching
  // "production-grade" / accidental "prod" substrings.
  // "One environment" must win over plan prose that lists all three names.
  if (/\bone environment\b/.test(t)) {
    out.environments = ['staging'];
  } else if (/\bdevelopment,\s*staging,\s*and\s*production\b/.test(t)) {
    out.environments = ['development', 'staging', 'production'];
  } else if (/\bdevelopment and staging\b/.test(t)) {
    out.environments = ['development', 'staging'];
  } else if (/\bdevelopment and production\b/.test(t)) {
    out.environments = ['development', 'production'];
  } else {
    const envs: string[] = [];
    if (/\bdevelopment\b/.test(t)) envs.push('development');
    if (/\bstaging\b/.test(t)) envs.push('staging');
    if (/\bproduction\b/.test(t) && !/\bproduction-grade\b|\bproduction ready\b/.test(t)) {
      envs.push('production');
    }
    if (envs.length) out.environments = envs;
  }

  // Database — client override / Confirmed-choices arrows beat plan prose + menus
  const dataOverride = raw.match(
    /data service\s*\(client override\):\s*([^\n.]+)/i
  );
  const dbFromOverride = dataOverride
    ? databaseFromPhrase(dataOverride[1])
    : null;
  // Scan every → answer line (first → is often cloud/CI, not data)
  let dbFromArrow: DatabaseKind | null = null;
  for (const m of raw.matchAll(/→\s*([^\n]+)/g)) {
    const arrowText = m[1];
    if (
      !/data service|no data service|postgres|postgresql|mysql|redis|mongo|mongodb|valkey/i.test(
        arrowText
      )
    ) {
      continue;
    }
    const parsed = databaseFromPhrase(arrowText);
    if (parsed) dbFromArrow = parsed;
  }

  if (dbFromOverride) {
    out.database = dbFromOverride;
  } else if (dbFromArrow) {
    out.database = dbFromArrow;
  } else {
    // Keyword scan on text with option menus stripped (QA #4: don't wipe Mongo via "stateless")
    const askedNoData =
      /\bno data service\b/.test(t) ||
      /\bwithout (a )?database\b/.test(t) ||
      /database\s*\(client override\):\s*none\b/.test(t) ||
      /→\s*no data service\b/.test(t);
    const askedMongo = /\bmongodb\b|\bmongo\b/.test(t);
    const askedRedis =
      /\bredis\s*cache\b|\bvalkey\s*cache\b|\bcache(?:\s+only)?\s*:\s*redis\b/.test(
        t
      ) ||
      (/\bredis\b|\bvalkey\b/.test(t) &&
        !/\b(postgres|postgresql|mysql|mariadb|mongo)\b/.test(t));
    const askedMysql = /\bmysql\b|\bmariadb\b/.test(t);
    const askedPostgres =
      /\bpostgres\b|\bpostgresql\b/.test(t) ||
      /postgresql stand-in/i.test(t) ||
      /postgres stand-in/i.test(t);

    if (askedMongo) {
      out.database = 'mongodb';
    } else if (askedRedis) {
      out.database = 'redis';
    } else if (askedMysql && !askedPostgres) {
      out.database = 'mysql';
    } else if (askedPostgres) {
      out.database = 'postgres';
    } else if (askedNoData) {
      out.database = 'none';
    }
  }

  // Database mode — order matters: specific phrases beat generic "backup"
  if (/\bstandard private database\b/.test(t)) {
    out.databaseMode = 'standard';
  } else if (
    /\bprivate database with 7-day\b|\b7-day automatic backups\b|\bautomatic backups\b/.test(
      t
    )
  ) {
    out.databaseMode = 'ha_backup';
  } else if (
    /\bhigh availability\b|\bmulti-?az\b|\bha\b.*\b(redis|valkey|postgres|mysql)\b|\b(redis|valkey)\b.*\bhigh availability\b/.test(
      t
    )
  ) {
    out.databaseMode = 'ha';
  }

  // Access
  if (/\bprivate and internal only\b|\bprivate\/internal\b|\binternal only\b/.test(t)) {
    out.access = 'private';
  } else if (
    /\bpublic without a custom domain\b/.test(t) ||
    /\bhttps on (the )?default (load[- ]?balancer|alb|lb) hostname\b/.test(t)
  ) {
    out.access = 'public_basic';
  } else if (/\bpublic with secure https\b|\bpublic with https\b/.test(t)) {
    out.access = 'public_https';
  }

  // Scale — allow em/en dashes between "Small" and "2 app copies"
  if (/\bsmall\b[\s\S]{0,40}2\s*app\s*copies?\b|\b2\s*app\s*copies\b/.test(t)) {
    out.scale = 'small';
  } else if (/\bmedium\b[\s\S]{0,40}3\s*to\s*5|\b3\s*to\s*5\s*app\s*copies\b/.test(t)) {
    out.scale = 'medium';
  } else if (/\bhigh traffic\b|\bautomatic scaling\b/.test(t)) {
    out.scale = 'high';
  }

  // Runtime — Language (client override) always wins over option menus / plan prose
  const langOverride = raw.match(
    /language(?:\/framework)?\s*\(client override\):\s*([^\n]+)/i
  );
  const langFromOverride = langOverride
    ? runtimeFromPhrase(langOverride[1])
    : null;
  // Confirmed choices: "→ Language (client override): Node.js..." or bare "→ Python"
  const langArrowMatches = [
    ...raw.matchAll(
      /(?:which language[^\n]*\n\s*)?→\s*((?:language(?:\/framework)?\s*\(client override\):\s*)?[^\n]+)/gi
    ),
  ];
  let langFromArrow: RuntimeKind | null = null;
  for (const m of langArrowMatches) {
    const phrase = m[1];
    if (
      /language\s*\(client override\)|node\.?js|\bpython\b|\bgo\b|\bjava\b|\.net\b/i.test(
        phrase
      )
    ) {
      langFromArrow = runtimeFromPhrase(phrase) || langFromArrow;
    }
  }

  if (langFromOverride) {
    out.runtime = langFromOverride;
  } else if (langFromArrow) {
    out.runtime = langFromArrow;
  } else {
    const rt =
      runtimeFromPhrase(t) ||
      (/\bnode\.?js\b|\bexpress\b|\bnext\.?js\b/.test(t) ? 'node' : null);
    if (rt) out.runtime = rt;
  }

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
