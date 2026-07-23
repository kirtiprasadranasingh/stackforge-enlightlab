/**
 * Detect whether a user message is a brand-new stack generation vs an iterative edit.
 */

/** Concrete infra / cloud / runtime tokens — shared by conversational + gate logic. */
export function hasInfraSignal(prompt: string): boolean {
  const raw = prompt.toLowerCase();
  // Languages alone are NOT infra (blocks "hello world in Python" jailbreaks).
  // Require cloud/orchestrator/IaC/CI or a clear stack-shaped ask.
  return /\b(aws|azure|gcp|oci|oracle|eks|gke|aks|oke|ecs|fargate|lambda|container\s*apps?|cloud\s*run|kubernetes|k8s|terraform|helm|dockerfile|docker|pipeline|ci\s*\/?\s*cd|gitlab|github\s*actions|jenkins|circleci|azure\s*devops|codepipeline|code\s*build|cloud\s*build|oci\s*devops|microservice|micro-?service|serverless|cluster|ingress|autoscal|replica|hpa|nsg|vpc|subnet|load\s*balancer|database|postgres|postgresql|mysql|mongo|mongodb|redis|dynamodb|scaffold|provision|infrastructure|infra\b)\b/.test(
    raw
  );
}

/** Named cloud / orchestrator — enough to start an interview even on short prompts. */
export function hasCloudOrOrchestratorSignal(prompt: string): boolean {
  return /\b(aws|azure|gcp|oci|oracle|eks|gke|aks|oke|ecs|fargate|lambda|container\s*apps?|cloud\s*run|kubernetes|k8s)\b/i.test(
    prompt
  );
}

/** Prompt-injection / jailbreak attempts — never start clarify or emit code. */
export function isJailbreakPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase().trim();
  if (
    /\bignore\s+(all\s+)?(previous|prior|above)\s+instructions\b/.test(lower) ||
    /\bdisregard\s+(all\s+)?(previous|prior|above)\s+instructions\b/.test(lower) ||
    /\byou\s+are\s+now\b.{0,40}\b(dan|jailbreak|unrestricted)\b/.test(lower) ||
    /\bdo\s+not\s+follow\s+(your|the)\s+(system|developer)\s+prompt\b/.test(lower) ||
    /\boverride\s+(your|the)\s+system\s+prompt\b/.test(lower)
  ) {
    return true;
  }
  // "Output a hello world script" without any cloud/infra framing
  if (
    /\b(hello\s*world|print\s*\(\s*['\"]hello|script\s+in\s+python|write\s+.*\bcode\b)\b/.test(
      lower
    ) &&
    !hasCloudOrOrchestratorSignal(lower) &&
    !/\b(terraform|helm|dockerfile|pipeline|scaffold|infrastructure)\b/.test(lower)
  ) {
    return true;
  }
  return false;
}

/**
 * Off-topic asks (recipes, homework, general coding) outside StackForge scope.
 * Cake recipe, jokes, etc. — refuse without starting an infra interview.
 */
export function isOffTopicPrompt(prompt: string): boolean {
  if (isJailbreakPrompt(prompt)) return true;
  const lower = prompt.toLowerCase().trim();
  if (hasCloudOrOrchestratorSignal(lower) || hasInfraSignal(lower)) return false;
  if (
    /\b(recipe|cake|cookie|cook|bake|chocolate|pasta|pizza|song|lyrics|poem|joke|story|homework|essay|translate|weather|stock\s*price)\b/.test(
      lower
    )
  ) {
    return true;
  }
  // Generic "write a X script/app" with no cloud
  if (
    /^(write|output|give\s+me|create|make)\b.{0,80}\b(script|program|function|class|hello\s*world)\b/.test(
      lower
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Ops / product asks outside StackForge's generator scope (billing, CMS install,
 * managing DNS as a service). These must NOT invent an AWS/EKS interview.
 */
export function isOutOfScopeOpsPrompt(prompt: string): boolean {
  if (isOffTopicPrompt(prompt)) return true;
  const lower = prompt.toLowerCase().trim();
  if (/\b(pay|paying|settle)\b.{0,40}\b(bill|invoice|aws\s*bill|azure\s*bill)\b/.test(lower)) {
    return true;
  }
  if (
    /\b(manage|register|renew)\b.{0,20}\b(my\s+)?dns\b/.test(lower) &&
    !/\b(terraform|route\s*53|cloud\s*dns|dns\s*zone)\b/.test(lower)
  ) {
    return true;
  }
  // WordPress / CMS deploy without an explicit infra scaffold framing
  if (
    /\b(wordpress|woocommerce|drupal|magento|shopify)\b/.test(lower) &&
    !/\b(terraform|eks|gke|aks|oke|ecs|fargate|helm|scaffold|manifest)\b/.test(lower)
  ) {
    return true;
  }
  return false;
}

/**
 * Vague deploy/scaffold asks with no cloud/CI named — e.g. "Deploy my app".
 * These MUST enter the clarifying interview; never invent AWS/EKS defaults.
 */
export function isVagueStackPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase().trim().replace(/[.!?]+$/g, '');
  if (!lower) return false;
  // Named cloud/orchestrator/CI → not vague (interview still runs via other gates)
  if (hasCloudOrOrchestratorSignal(lower)) return false;
  if (
    /\b(github\s*actions|gitlab|jenkins|azure\s*devops|codepipeline|cloud\s*build|oci\s*devops|terraform|helm|dockerfile)\b/.test(
      lower
    )
  ) {
    return false;
  }

  // "Deploy my app/backend", "create an application", "build my api"
  if (
    /^(deploy|create|generate|build|scaffold|design|set\s+up|setup|provision|host)\b/.test(
      lower
    ) &&
    /\b(app|application|service|api|project|stack|backend|frontend|website|site|devops|infra(?:structure)?|startup)\b/.test(
      lower
    )
  ) {
    return true;
  }
  // Ultra-short: "deploy app", "host application", "create service"
  if (
    /^(deploy|scaffold|set\s+up|setup|provision|host)\s+(an?\s+|my\s+|our\s+|the\s+)?(app|application|service|api|stack|backend)\b/.test(
      lower
    )
  ) {
    return true;
  }
  // "I need scalable infrastructure" / "I want infrastructure" with no cloud named
  if (
    /^(i\s+need|i\s+want|we\s+need|need|want)\b/.test(lower) &&
    /\b(infra(?:structure)?|scalable|scale|hosting|platform|deploy)\b/.test(lower)
  ) {
    return true;
  }
  // "Create DevOps for my startup" / "build devops platform" with no cloud named
  if (
    /\bdevops\b/.test(lower) &&
    /^(create|generate|build|scaffold|design|set\s+up|setup|provision)\b/.test(lower)
  ) {
    return true;
  }
  return false;
}

export function isFullStackPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase().trim();
  if (isOutOfScopeOpsPrompt(lower)) return false;
  // Repair / validation-fix turns are never a brand-new stack interview
  if (isValidationFixPrompt(prompt)) return false;
  if (
    /^(add|update|fix|change|harden|secure|wire|include|remove|delete|rename|move)\b/.test(
      lower
    )
  ) {
    return false;
  }

  // "Deploy my app" and similar — interview first, never silent AWS/EKS generation
  if (isVagueStackPrompt(prompt)) return true;

  // Short but explicit cloud/orchestrator prompts are still full-stack requests
  // e.g. "An Oracle OKE service", "A Node.js API on AWS EKS"
  if (hasCloudOrOrchestratorSignal(lower) && lower.length >= 12) {
    return true;
  }

  if (lower.length < 20) return false;

  // Explicit full-stack verbs (enough detail to treat as a new stack request)
  if (
    /^(deploy|create|generate|build|scaffold|design|set\s+up|provision)\b/.test(lower)
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
    const hasCloud = hasCloudOrOrchestratorSignal(lower);
    if (hasCloud && lower.length >= 18) return true;
  }

  const hasCloud = hasCloudOrOrchestratorSignal(lower);
  const hasApp =
    /\b(api|service|backend|app|application|microservice|pipeline|database|postgres|rest)\b/.test(
      lower
    );

  if (hasCloud && hasApp && lower.length > 30) return true;

  return false;
}

/** Small iterative edits — never wipe the workspace for these. */
export function isIterativeEditPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase().trim();
  if (isValidationFixPrompt(prompt)) return true;
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
 * User pasted a scaffold-check report or asked to make checks pass.
 * Must stay iterative — never restart clarify/plan or wipe files.
 */
export function isValidationFixPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  if (
    /=====?\s*validation report\s*=====?/i.test(text) ||
    /\bresult:\s*failed\b/i.test(text) ||
    /^fail\s+- /im.test(text) ||
    /\bfail\s+-\s+(terraform|hadolint|actionlint|helm)\b/i.test(text)
  ) {
    return true;
  }
  if (
    /\b(make (them|it|all checks|the checks) pass|fix (these |the )?(validation |check |scaffold )?(failures?|errors?|issues?)|correct (the |these )?(error|errors|failures?)|checks? (did not|didn't|failed|not )pass)\b/i.test(
      lower
    )
  ) {
    return true;
  }
  return false;
}

/** Build the chat/API prompt used when repairing from scaffold-check FAIL lines. */
export function buildValidationFixPrompt(failReport: string): string {
  // Keep FAIL lines only — drop PASS/INFO noise so the request stays under API limits.
  const failOnly = failReport
    .split(/\r?\n/)
    .filter((l) => /^FAIL\s+-/i.test(l.trim()) || /^RESULT:\s*FAILED/i.test(l.trim()))
    .join('\n');
  const trimmed = (failOnly || failReport)
    .trim()
    .slice(0, 8000)
    .replace(/\bterraform init\b/gi, 'terraform-init')
    .replace(/\bdocker build\b/gi, 'docker-build')
    .replace(/\bkubectl apply\b/gi, 'kubectl-apply');
  return `Fix the scaffold so "Run all checks" passes. Do not change cloud, region, environments, or architecture — only correct the failing files. Do not ask clarifying questions.

Rules:
- Duplicate Terraform data/resources/outputs: keep one definition, remove the duplicate.
- GCP Cycle data.google_project ↔ google_project_service: set project = var.project_id on APIs; remove depends_on google_project_service from data.google_project.
- Artifact Registry: never use .repository_url — construct location-docker.pkg.dev/project/repo/….
- App sources: keep a minimal /health stub only (no CRUD, ORM, auth).
- actionlint / YAML: put shell with colons in a run: | block.
- IAM condition keys with colons must be quoted: "ForAllValues:StringLike" = { ... }
- EKS: do NOT add ECS resources or put kubernetes/helm providers in terraform/ecs.tf — use eks/main/iam/alb_controller only. Delete ecs.tf if this is EKS+Helm.
- Do NOT modify .github/workflows/deploy.yml, Dockerfiles, package.json, server.js, main.py, main.go, or charts/app/Chart.yaml / _helpers.tpl — those are locked.
- Emit full corrected file bodies with <<<FILE>>> markers only for Terraform files that still fail validate.
- Do not ask clarifying questions.

Validation failures:
${trimmed}`;
}

/**
 * New projects and major architecture changes require plan approval before files are emitted.
 * Small follow-up edits against an existing workspace bypass the gate.
 *
 * CRITICAL: Short infra prompts (e.g. "A Node.js API on AWS EKS") must still
 * enter the clarifying interview — never jump straight to file generation.
 */
export function requiresPlanApproval(
  prompt: string,
  hasExistingFiles: boolean
): boolean {
  if (hasExistingFiles && isIterativeEditPrompt(prompt)) return false;
  if (isOutOfScopeOpsPrompt(prompt)) return false; // handled as a scoped reply, not generate
  // Vague "Deploy my app" etc. — always interview on a new project
  if (isVagueStackPrompt(prompt)) return true;
  if (isFullStackPrompt(prompt)) return true;
  // First generation: any infra signal, or enough free text to interview on
  if (!hasExistingFiles) {
    if (hasInfraSignal(prompt)) return true;
    if (prompt.trim().length >= 20) return true;
    // Short deploy/create verbs without cloud still need an interview
    if (
      /^(deploy|create|generate|build|scaffold|design|set\s+up|setup|provision)\b/i.test(
        prompt.trim()
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Detect conversational greetings, confirmations, or general questions. */
export function isGreetingOnlyPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
  const greetings = [
    'hi', 'hello', 'hey', 'yo', 'good morning', 'good afternoon', 'good evening',
    'hola', 'hi there', 'hello there', 'greetings', 'wasup', 'whats up', 'sup'
  ];
  return greetings.includes(lower);
}

/** Detect conversational greetings, confirmations, or general questions. */
export function isConversationalPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");

  if (isGreetingOnlyPrompt(prompt)) return true;

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

  // Out-of-scope ops asks are not "conversation" — route them to a scope reply
  // in the API (separate from small talk).
  if (isOutOfScopeOpsPrompt(prompt)) return false;
  if (isJailbreakPrompt(prompt)) return false;

  if (hasInfraSignal(prompt) || hasCloudOrOrchestratorSignal(prompt)) return false;
  if (isVagueStackPrompt(prompt)) return false;

  const commandVerb =
    /^(add|update|fix|change|remove|delete|rename|move|create|generate|build|make|set\s*up|setup|deploy|scaffold|provision|harden|secure|wire|include|configure|refactor|optimize|design)\b/;
  if (commandVerb.test(lower)) return false;

  return true;
}
