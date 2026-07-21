import { z } from 'zod';

/** Allowlisted scaffold checks — never accept free-form shell. */
export const CHECK_IDS = [
  'all',
  'terraform',
  'helm',
  'hadolint',
  'actionlint',
] as const;

export type ScaffoldCheckId = (typeof CHECK_IDS)[number];

export const CHECK_LABELS: Record<ScaffoldCheckId, string> = {
  all: 'Run all checks',
  terraform: 'terraform init · validate · plan',
  helm: 'helm lint · template',
  hadolint: 'hadolint',
  actionlint: 'actionlint',
};

export const CHECK_TIMEOUT_MS: Record<ScaffoldCheckId, number> = {
  // Terraform init can download large providers; keep validate from being starved.
  all: 210_000,
  terraform: 180_000,
  helm: 60_000,
  hadolint: 20_000,
  actionlint: 20_000,
};

export const ScaffoldCheckFileSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[a-zA-Z0-9/_.\-]+$/),
  content: z.string().max(120_000),
});

export const ScaffoldCheckRequestSchema = z.object({
  check: z.enum(CHECK_IDS),
  files: z.array(ScaffoldCheckFileSchema).min(1).max(60),
});
