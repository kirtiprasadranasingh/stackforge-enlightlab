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

/** Detect conversational greetings, confirmations, or general questions. */
export function isConversationalPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");

  const greetings = [
    'hi', 'hello', 'hey', 'yo', 'good morning', 'good afternoon', 'good evening', 
    'hola', 'hi there', 'hello there', 'greetings', 'wasup', 'whats up', 'sup'
  ];
  if (greetings.includes(lower)) return true;

  const acknowledgements = [
    'all good', 'al good', 'looks good', 'look good', 'perfect', 'thanks', 'thank you', 
    'great', 'nice', 'awesome', 'ok', 'okay', 'yes', 'no', 'agree', 'cool', 
    'fine', 'sure', 'go ahead', 'sound good', 'sounds good', 'indeed', 'done', 
    'no changes', 'no changes needed'
  ];
  if (acknowledgements.includes(lower)) return true;

  const genericQuestions = [
    'how are you', 'how is it going', 'how goes it', 'who are you', 'what is this', 
    'what can you do', 'what are you', 'how do you work', 'what are your capabilities',
    'what can you help with', 'what do you do', 'help', 'what should i say'
  ];
  if (genericQuestions.includes(lower)) return true;

  // Use the ORIGINAL (unstripped) prompt for signal detection so we keep
  // punctuation-sensitive tokens like "ci/cd" and "node.js".
  const raw = prompt.toLowerCase();

  // Any concrete infrastructure signal means this is a real request, not chit-chat.
  const infraSignal =
    /\b(aws|azure|gcp|oci|oracle|eks|gke|aks|oke|ecs|fargate|lambda|container\s*apps?|cloud\s*run|kubernetes|k8s|terraform|helm|dockerfile|docker|pipeline|ci\s*\/?\s*cd|gitlab|github\s*actions|jenkins|circleci|microservice|micro-?service|backend|frontend|serverless|cluster|ingress|autoscal|replica|hpa|nsg|vpc|subnet|load\s*balancer|database|postgres|postgresql|mysql|mongo|mongodb|redis|dynamodb|graphql|rest\s*api|\bapi\b|manifest|scaffold|provision|infrastructure|infra\b|node\.?js|nextjs|next\.js|python|fastapi|django|flask|golang|\bjava\b|spring|\.net|dotnet|express|nestjs|rails|\bphp\b|laravel)\b/;
  if (infraSignal.test(raw)) return false;

  // Explicit build/edit commands (even without a named technology) are requests.
  const commandVerb =
    /^(add|update|fix|change|remove|delete|rename|move|create|generate|build|make|set\s*up|setup|deploy|scaffold|provision|harden|secure|wire|include|configure|refactor|optimize|design)\b/;
  if (commandVerb.test(lower)) return false;

  // No infrastructure signal and no build/edit command → treat as general
  // conversation (capabilities, identity, small talk, off-topic questions).
  // This keeps the assistant from inventing an AWS/EKS interview for prompts
  // the user never framed as an infrastructure request.
  return true;
}

