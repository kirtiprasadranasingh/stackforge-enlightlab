/**
 * Detect whether a user message is a brand-new stack generation vs an iterative edit.
 */

export function isFullStackPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase().trim();
  if (lower.length < 25) return false;

  // Explicit full-stack verbs
  if (
    /^(deploy|create|generate|build|scaffold|design|set\s+up|provision)\b/.test(lower) &&
    lower.length > 40
  ) {
    return true;
  }

  if (
    lower.startsWith('a ') ||
    lower.startsWith('an ') ||
    lower.startsWith('new ') ||
    lower.startsWith('i need ') ||
    lower.startsWith('i want ')
  ) {
    const hasCloud =
      /\b(aws|azure|gcp|oci|oracle|eks|gke|aks|oke|ecs|fargate|container\s*apps?|cloud\s*run)\b/.test(
        lower
      );
    if (hasCloud && lower.length > 35) return true;
  }

  const hasCloud =
    /\b(aws|azure|gcp|oci|oracle|eks|gke|aks|oke|ecs|fargate|container\s*apps?|cloud\s*run)\b/.test(
      lower
    );
  const hasApp =
    /\b(api|service|backend|app|application|microservice|pipeline|database|postgres|rest)\b/.test(
      lower
    );

  // Long cloud+app descriptions are new stacks, not small edits
  if (hasCloud && hasApp && lower.length > 50) return true;

  return false;
}

/** Small iterative edits — never wipe the workspace for these. */
export function isIterativeEditPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase().trim();
  if (
    /^(add|update|fix|change|harden|secure|wire|include|remove|delete|rename|move)\b/.test(
      lower
    )
  ) {
    return true;
  }
  if (
    /\b(dev\/prod|dev and prod|hpa|autoscaling|nsg|scale rules|where (did |you )?update)\b/.test(
      lower
    )
  ) {
    return true;
  }
  return false;
}

/**
 * New projects and major architecture changes require plan approval before files are emitted.
 * Small follow-up edits against an existing workspace bypass the gate.
 */
export function requiresPlanApproval(
  prompt: string,
  hasExistingFiles: boolean
): boolean {
  if (hasExistingFiles && isIterativeEditPrompt(prompt)) return false;
  if (isFullStackPrompt(prompt)) return true;
  // First generation with enough detail (greetings handled earlier in the API)
  if (!hasExistingFiles && prompt.trim().length >= 25) return true;
  return false;
}
