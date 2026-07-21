import { z } from 'zod';
import type { Presets } from '@/types';

export const PresetsSchema = z.object({
  cloud: z.enum(['oracle', 'aws', 'gcp', 'azure']),
  orchestrator: z.enum([
    'oke',
    'eks',
    'gke',
    'aks',
    'ecs',
    'serverless',
    'cloud-run',
    'container-apps',
  ]),
  ci: z.enum([
    'github-actions',
    'gitlab-ci',
    'jenkins',
    'azure-devops',
    'aws-codepipeline',
    'gcp-cloud-build',
    'oci-devops',
  ]),
}) as z.ZodType<Presets>;

const HistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  // Allow longer assistant/plan turns; repair prompts may appear in history.
  content: z.string().max(16000),
});

const ExistingFileSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[a-zA-Z0-9/_.\-]+$/),
  content: z.string().max(120000),
});

export const GenerateRequestSchema = z
  .object({
    // Repair turns embed scaffold-check FAIL logs — need headroom beyond short chat.
    prompt: z.string().min(1).max(16000),
    presets: PresetsSchema.optional(),
    /** Prior chat turns (optional — for Lovable-style iteration) */
    history: z.array(HistoryMessageSchema).max(20).optional(),
    /** Current project files for follow-up edits */
    existingFiles: z.array(ExistingFileSchema).max(60).optional(),
    /** clarify | plan | generate — defaults to generate for small edits */
    phase: z.enum(['clarify', 'plan', 'generate']).optional(),
    /** Required when phase=generate for new/major stacks */
    approvedPlan: z.string().max(20000).optional(),
    /** Prior plan when revising */
    priorPlan: z.string().max(20000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.prompt.trim().length < 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Message cannot be empty',
        path: ['prompt'],
      });
    }
    if (data.phase === 'generate' && data.approvedPlan !== undefined) {
      if (data.approvedPlan.trim().length < 20) {
        ctx.addIssue({
          code: 'custom',
          message: 'approvedPlan is too short',
          path: ['approvedPlan'],
        });
      }
    }
  });

export const GeneratedFileSchema = z.object({
  path: z
    .string()
    .min(1, 'File path required')
    .max(512, 'File path too long')
    .regex(/^[a-zA-Z0-9/_.\-]+$/, 'Invalid file path characters'),
  language: z.string().min(1),
  content: z
    .string()
    .min(1, 'File content required')
    .max(120000, 'File too large (max 120KB)'),
  description: z.string().optional(),
});

export const GenerationResultSchema = z.object({
  files: z
    .array(GeneratedFileSchema)
    .min(1, 'At least one file required')
    .max(40, 'Too many files'),
  summary: z.string().max(2000).optional(),
  warnings: z.array(z.string()).optional(),
});

export function validateGenerateRequest(data: unknown) {
  return GenerateRequestSchema.safeParse(data);
}

export function validateGenerationResult(data: unknown) {
  return GenerationResultSchema.safeParse(data);
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public details?: z.ZodError
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class GenerationError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'GenerationError';
  }
}
