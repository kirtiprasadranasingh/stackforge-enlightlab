"use strict";
/**
 * Detect whether a user message is a brand-new stack generation vs an iterative edit.
 */
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasInfraSignal = hasInfraSignal;
exports.isUnsupportedRuntimePrompt = isUnsupportedRuntimePrompt;
exports.hasRuntimeAppSignal = hasRuntimeAppSignal;
exports.isAffirmativeContinuePrompt = isAffirmativeContinuePrompt;
exports.resolveStackPromptFromAffirmation = resolveStackPromptFromAffirmation;
exports.resolveDiscoveryPrompt = resolveDiscoveryPrompt;
exports.isRequirementCorrectionPrompt = isRequirementCorrectionPrompt;
exports.hasCloudOrOrchestratorSignal = hasCloudOrOrchestratorSignal;
exports.isJailbreakPrompt = isJailbreakPrompt;
exports.isOffTopicPrompt = isOffTopicPrompt;
exports.isOutOfScopeOpsPrompt = isOutOfScopeOpsPrompt;
exports.isVagueStackPrompt = isVagueStackPrompt;
exports.isFullStackPrompt = isFullStackPrompt;
exports.isIterativeEditPrompt = isIterativeEditPrompt;
exports.isValidationFixPrompt = isValidationFixPrompt;
exports.buildValidationFixPrompt = buildValidationFixPrompt;
exports.requiresPlanApproval = requiresPlanApproval;
exports.isGreetingOnlyPrompt = isGreetingOnlyPrompt;
exports.isConversationalPrompt = isConversationalPrompt;
/** Concrete infra / cloud / runtime tokens — shared by conversational + gate logic. */
function hasInfraSignal(prompt) {
    var raw = prompt.toLowerCase();
    // Languages alone are NOT infra (blocks "hello world in Python" jailbreaks).
    // Require cloud/orchestrator/IaC/CI or a clear stack-shaped ask.
    return /\b(aws|azure|gcp|google\s*cloud|oci|oracle|eks|gke|aks|oke|ecs|fargate|lambda|container\s*apps?|cloud\s*run|kubernetes|k8s|terraform|helm|dockerfile|docker|pipeline|ci\s*\/?\s*cd|gitlab|github\s*actions|jenkins|circleci|azure\s*devops|codepipeline|code\s*build|cloud\s*build|oci\s*devops|microservice|micro-?service|serverless|cluster|ingress|autoscal|replica|hpa|nsg|vpc|subnet|load\s*balancer|database|postgres|postgresql|mysql|mongo|mongodb|redis|dynamodb|scaffold|provision|infrastructure|infra\b)\b/.test(raw);
}
/**
 * Returns true when the prompt explicitly requests a runtime that StackForge
 * does not support (e.g. PHP, Ruby, Rust). These must never silently fall back
 * to Node — instead the API should reply with a clear unsupported message.
 */
function isUnsupportedRuntimePrompt(prompt) {
    var lower = prompt.toLowerCase();
    if (isJailbreakPrompt(lower))
        return false;
    return /\b(php|ruby(?:\s+on\s+rails)?|rails|rust(?:\s+actix)?|elixir|phoenix)\b/i.test(lower);
}
/** ".NET API", "Java service", etc. — enough to start clarify even without a cloud name. */
function hasRuntimeAppSignal(prompt) {
    var t = prompt.trim();
    // ".NET" begins with a non-word char — do not require a leading \b before \.net
    if (/(?:^|[^a-z0-9_])(?:\.net|dotnet|asp\.?net)\b.{0,40}\b(api|service|app|application|backend|microservice)\b/i.test(t)) {
        return true;
    }
    return (/\b(node\.?js|python|java|golang|go|fastapi|spring|express|next\.?js)\b.{0,40}\b(api|service|app|application|backend|microservice)\b/i.test(t) ||
        /\b(api|service|app|application|backend)\b.{0,40}(?:\.net|dotnet|asp\.?net|node\.?js|python|java|golang|go)\b/i.test(t));
}
/** Short affirmations after the bot offered to scaffold a runtime/API. */
function isAffirmativeContinuePrompt(prompt) {
    var lower = prompt
        .toLowerCase()
        .trim()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, '');
    return /^(yes|yeah|yep|yup|sure|ok|okay|please|continue|proceed|go ahead|lets go|let's go|do it|sounds good)(\s+(please|continue|go ahead))?$/.test(lower) || /^(yes|yeah|sure|ok|okay|please)\s+(please|continue)$/.test(lower);
}
/**
 * If the user says "yes please" after a .NET/runtime offer, return the prior
 * stack prompt so clarify can start instead of a welcome reset.
 */
function resolveStackPromptFromAffirmation(prompt, history) {
    var _a;
    if (!isAffirmativeContinuePrompt(prompt) || !(history === null || history === void 0 ? void 0 : history.length))
        return null;
    for (var i = history.length - 1; i >= 0; i--) {
        var m = history[i];
        if (m.role !== 'user')
            continue;
        var c = (m.content || '').trim();
        if (!c || isAffirmativeContinuePrompt(c))
            continue;
        if (hasRuntimeAppSignal(c) || hasInfraSignal(c) || isVagueStackPrompt(c)) {
            return c;
        }
    }
    var asst = history
        .filter(function (h) { return h.role === 'assistant'; })
        .map(function (h) { return h.content || ''; })
        .join('\n');
    if (/help you set up (the )?infrastructure|set up the infrastructure for your|great project/i.test(asst)) {
        var user = history.find(function (h) { return h.role === 'user' && (h.content || '').trim(); });
        if ((_a = user === null || user === void 0 ? void 0 : user.content) === null || _a === void 0 ? void 0 : _a.trim())
            return user.content.trim();
    }
    return null;
}
/**
 * Preserve short discovery fragments that precede the first concrete cloud
 * choice. Examples from manual QA are:
 *   "Small deployment" -> "game app and cloud" -> "AWS"
 *   "Medium deployment" -> "Google Cloud and health-related application"
 *
 * Without this handoff the final cloud token starts an interview by itself and
 * silently loses workload, scale, and access intent from the same conversation.
 */
function resolveDiscoveryPrompt(prompt, history) {
    var current = prompt.trim();
    if (!current || !(history === null || history === void 0 ? void 0 : history.length))
        return null;
    if (!hasCloudOrOrchestratorSignal(current) && !hasInfraSignal(current))
        return null;
    var fragments = [];
    for (var i = history.length - 1; i >= 0 && fragments.length < 4; i--) {
        var message = history[i];
        if (message.role !== 'user')
            continue;
        var value = (message.content || '').trim();
        if (!value || value === current || isAffirmativeContinuePrompt(value) || isGreetingOnlyPrompt(value)) {
            continue;
        }
        // Stop at an older fully specified request; only collect the short
        // discovery fragments immediately leading into this project.
        if (hasCloudOrOrchestratorSignal(value) && value.length > 80)
            break;
        if (/\b(?:small|medium|large|high traffic|scalable|deployment|workload|service|api|app|application|game|gaming|healthcare|health[- ]?related|e-?commerce|public|private|https?|vpc|cloud|production|staging|development)\b/i.test(value)) {
            fragments.unshift(value);
        }
    }
    return fragments.length ? __spreadArray(__spreadArray([], fragments, true), [current], false).join('\n') : null;
}
/**
 * A follow-up that changes one locked requirement must revise the saved
 * interview rather than start a new discovery turn. Region chips are often
 * answered as a bare value (for example `westeurope`), so requiring a verb
 * such as "change" caused the prior invalid region to win forever.
 */
function isRequirementCorrectionPrompt(prompt) {
    var text = prompt.trim();
    if (!text)
        return false;
    var bareRequirement = /^(?:postgres(?:ql)?|mysql|mariadb|redis(?:\s+cache)?|valkey|no data service|development only|staging only|production only|us-east-1|us-west-2|eu-west-1|ap-south-1|us-central1|europe-west1|asia-south1|eastus|westeurope|centralindia|ap-mumbai-1|us-ashburn-1|eu-frankfurt-1)$/i;
    if (bareRequirement.test(text))
        return true;
    return /\b(?:change|switch|use|set|update|correct|replace)\b[\s\S]{0,100}\b(?:aws|azure|gcp|google cloud|oracle|ecs|eks|gke|cloud run|container apps|aks|oke|github actions|gitlab|jenkins|cloud build|azure devops|us-east-1|us-west-2|eu-west-1|ap-south-1|us-central1|europe-west1|asia-south1|eastus|westeurope|centralindia|ap-mumbai-1|private|public|https|http|postgres|mysql|redis|valkey|no data|development|staging|production|node|python|go|java|\.net|dotnet|small|medium|high traffic)\b/i.test(text);
}
/** Named cloud / orchestrator — enough to start an interview even on short prompts. */
function hasCloudOrOrchestratorSignal(prompt) {
    return /\b(aws|azure|gcp|google\s*cloud|oci|oracle|eks|gke|aks|oke|ecs|fargate|lambda|container\s*apps?|cloud\s*run|kubernetes|k8s)\b/i.test(prompt);
}
/** Prompt-injection / jailbreak attempts — never start clarify or emit code. */
function isJailbreakPrompt(prompt) {
    var lower = prompt.toLowerCase().trim();
    if (/\bignore\s+(all\s+)?(previous|prior|above)\s+instructions\b/.test(lower) ||
        /\bdisregard\s+(all\s+)?(previous|prior|above)\s+instructions\b/.test(lower) ||
        /\byou\s+are\s+now\b.{0,40}\b(dan|jailbreak|unrestricted)\b/.test(lower) ||
        /\bdo\s+not\s+follow\s+(your|the)\s+(system|developer)\s+prompt\b/.test(lower) ||
        /\boverride\s+(your|the)\s+system\s+prompt\b/.test(lower)) {
        return true;
    }
    // "Output a hello world script" without any cloud/infra framing
    if (/\b(hello\s*world|print\s*\(\s*['\"]hello|script\s+in\s+python|write\s+.*\bcode\b)\b/.test(lower) &&
        !hasCloudOrOrchestratorSignal(lower) &&
        !/\b(terraform|helm|dockerfile|pipeline|scaffold|infrastructure)\b/.test(lower)) {
        return true;
    }
    return false;
}
/**
 * Off-topic asks (recipes, homework, general coding) outside StackForge scope.
 * Cake recipe, jokes, etc. — refuse without starting an infra interview.
 */
function isOffTopicPrompt(prompt) {
    if (isJailbreakPrompt(prompt))
        return true;
    var lower = prompt.toLowerCase().trim();
    if (hasCloudOrOrchestratorSignal(lower) || hasInfraSignal(lower))
        return false;
    if (/\b(recipe|cake|cookie|cook|bake|chocolate|pasta|pizza|song|lyrics|poem|joke|story|homework|essay|translate|weather|stock\s*price)\b/.test(lower)) {
        return true;
    }
    // Generic "write a X script/app" with no cloud
    if (/^(write|output|give\s+me|create|make)\b.{0,80}\b(script|program|function|class|hello\s*world)\b/.test(lower)) {
        return true;
    }
    return false;
}
/**
 * Ops / product asks outside StackForge's generator scope (billing, CMS install,
 * managing DNS as a service). These must NOT invent an AWS/EKS interview.
 */
function isOutOfScopeOpsPrompt(prompt) {
    if (isOffTopicPrompt(prompt))
        return true;
    var lower = prompt.toLowerCase().trim();
    if (/\b(pay|paying|settle)\b.{0,40}\b(bill|invoice|aws\s*bill|azure\s*bill)\b/.test(lower)) {
        return true;
    }
    if (/\b(manage|register|renew)\b.{0,20}\b(my\s+)?dns\b/.test(lower) &&
        !/\b(terraform|route\s*53|cloud\s*dns|dns\s*zone)\b/.test(lower)) {
        return true;
    }
    // WordPress / CMS deploy without an explicit infra scaffold framing
    if (/\b(wordpress|woocommerce|drupal|magento|shopify)\b/.test(lower) &&
        !/\b(terraform|eks|gke|aks|oke|ecs|fargate|helm|scaffold|manifest)\b/.test(lower)) {
        return true;
    }
    return false;
}
/**
 * Vague deploy/scaffold asks with no cloud/CI named — e.g. "Deploy my app".
 * These MUST enter the clarifying interview; never invent AWS/EKS defaults.
 */
function isVagueStackPrompt(prompt) {
    var lower = prompt.toLowerCase().trim().replace(/[.!?]+$/g, '');
    if (!lower)
        return false;
    // Requirement fragments are valid interview starters even without a cloud.
    // Keep them out of casual chat so the missing axes are collected.
    if (/\b(?:small|medium|large|high[- ]traffic)\s+(?:deployment|scale|workload|service)\b/i.test(lower) ||
        /\b(?:public\s+(?:https?|without (?:a )?custom domain)|private(?:\s+vpc)?(?:\s+only)?|private and internal only)\b/i.test(lower) ||
        /\b(?:game|gaming|healthcare|health|e-?commerce|startup|web|api|service|app|application|backend|frontend)\b.{0,40}\b(?:app|application|service|backend|cloud|deployment|workload|infra(?:structure)?)\b/i.test(lower) ||
        /\b(?:app|application|service|backend|cloud)\b.{0,40}\b(?:game|gaming|healthcare|health|e-?commerce|startup|web|api|cloud)\b/i.test(lower)) {
        if (!hasCloudOrOrchestratorSignal(lower)) {
            return true;
        }
    }
    // Named cloud/orchestrator/CI → not vague (interview still runs via other gates)
    if (hasCloudOrOrchestratorSignal(lower))
        return false;
    if (/\b(github\s*actions|gitlab|jenkins|azure\s*devops|codepipeline|cloud\s*build|oci\s*devops|terraform|helm|dockerfile)\b/.test(lower)) {
        return false;
    }
    // "Deploy my app/backend", "create an application", "build my api"
    if (/^(deploy|create|generate|build|scaffold|design|set\s+up|setup|provision|host)\b/.test(lower) &&
        /\b(app|application|service|api|project|stack|backend|frontend|website|site|devops|infra(?:structure)?|startup)\b/.test(lower)) {
        return true;
    }
    // Ultra-short: "deploy app", "host application", "create service"
    if (/^(deploy|scaffold|set\s+up|setup|provision|host)\s+(an?\s+|my\s+|our\s+|the\s+)?(app|application|service|api|stack|backend)\b/.test(lower)) {
        return true;
    }
    // "I need scalable infrastructure" / "I want infrastructure" with no cloud named
    if (/^(i\s+need|i\s+want|we\s+need|need|want)\b/.test(lower) &&
        /\b(infra(?:structure)?|scalable|scale|hosting|platform|deploy)\b/.test(lower)) {
        return true;
    }
    // "Create DevOps for my startup" / "build devops platform" with no cloud named
    if (/\bdevops\b/.test(lower) &&
        /^(create|generate|build|scaffold|design|set\s+up|setup|provision)\b/.test(lower)) {
        return true;
    }
    return false;
}
function isFullStackPrompt(prompt) {
    var lower = prompt.toLowerCase().trim();
    if (isOutOfScopeOpsPrompt(lower))
        return false;
    // Repair / validation-fix turns are never a brand-new stack interview
    if (isValidationFixPrompt(prompt))
        return false;
    if (/^(add|update|fix|change|harden|secure|wire|include|remove|delete|rename|move)\b/.test(lower)) {
        return false;
    }
    // "Deploy my app" and similar — interview first, never silent AWS/EKS generation
    if (isVagueStackPrompt(prompt))
        return true;
    // ".NET API" / "Java service" without a cloud still starts the interview
    if (hasRuntimeAppSignal(prompt))
        return true;
    // Short but explicit cloud/orchestrator prompts are still full-stack requests
    // e.g. "An Oracle OKE service", "A Node.js API on AWS EKS"
    if (hasCloudOrOrchestratorSignal(lower) && lower.length >= 12) {
        return true;
    }
    if (lower.length < 20)
        return false;
    // Explicit full-stack verbs (enough detail to treat as a new stack request)
    if (/^(deploy|create|generate|build|scaffold|design|set\s+up|provision)\b/.test(lower)) {
        return true;
    }
    if (lower.startsWith('a ') ||
        lower.startsWith('an ') ||
        lower.startsWith('new ') ||
        lower.startsWith('i need ') ||
        lower.startsWith('i want ')) {
        var hasCloud_1 = hasCloudOrOrchestratorSignal(lower);
        if (hasCloud_1 && lower.length >= 18)
            return true;
    }
    var hasCloud = hasCloudOrOrchestratorSignal(lower);
    var hasApp = /\b(api|service|backend|app|application|microservice|pipeline|database|postgres|rest)\b/.test(lower);
    if (hasCloud && hasApp && lower.length > 30)
        return true;
    return false;
}
/** Small iterative edits — never wipe the workspace for these. */
function isIterativeEditPrompt(prompt) {
    var lower = prompt.toLowerCase().trim();
    if (isValidationFixPrompt(prompt))
        return true;
    if (/^(add|update|fix|change|harden|secure|wire|include|remove|delete|rename|move)\b/.test(lower)) {
        return true;
    }
    if (/\b(dev\/prod|dev and prod|hpa|autoscaling|nsg|scale rules|where (did |you )?update)\b/.test(lower)) {
        return true;
    }
    return false;
}
/**
 * User pasted a scaffold-check report or asked to make checks pass.
 * Must stay iterative — never restart clarify/plan or wipe files.
 */
function isValidationFixPrompt(prompt) {
    var text = prompt.trim();
    if (!text)
        return false;
    var lower = text.toLowerCase();
    if (/=====?\s*validation report\s*=====?/i.test(text) ||
        /\bresult:\s*failed\b/i.test(text) ||
        /^fail\s+- /im.test(text) ||
        /\bfail\s+-\s+(terraform|hadolint|actionlint|helm)\b/i.test(text)) {
        return true;
    }
    if (/\b(make (them|it|all checks|the checks) pass|fix (these |the )?(validation |check |scaffold )?(failures?|errors?|issues?)|correct (the |these )?(error|errors|failures?)|checks? (did not|didn't|failed|not )pass)\b/i.test(lower)) {
        return true;
    }
    return false;
}
/** Build the chat/API prompt used when repairing from scaffold-check FAIL lines. */
function buildValidationFixPrompt(failReport) {
    // Keep FAIL lines only — drop PASS/INFO noise so the request stays under API limits.
    var failOnly = failReport
        .split(/\r?\n/)
        .filter(function (l) { return /^FAIL\s+-/i.test(l.trim()) || /^RESULT:\s*FAILED/i.test(l.trim()); })
        .join('\n');
    var trimmed = (failOnly || failReport)
        .trim()
        .slice(0, 8000)
        .replace(/\bterraform init\b/gi, 'terraform-init')
        .replace(/\bdocker build\b/gi, 'docker-build')
        .replace(/\bkubectl apply\b/gi, 'kubectl-apply');
    return "Fix the scaffold so \"Run all checks\" passes. Do not change cloud, region, environments, or architecture \u2014 only correct the failing files. Do not ask clarifying questions.\n\nRules:\n- Duplicate Terraform data/resources/outputs: keep one definition, remove the duplicate.\n- GCP Cycle data.google_project \u2194 google_project_service: set project = var.project_id on APIs; remove depends_on google_project_service from data.google_project.\n- Artifact Registry: never use .repository_url \u2014 construct location-docker.pkg.dev/project/repo/\u2026.\n- App sources: keep a minimal /health stub only (no CRUD, ORM, auth).\n- actionlint / YAML: put shell with colons in a run: | block.\n- IAM condition keys with colons must be quoted: \"ForAllValues:StringLike\" = { ... }\n- EKS: do NOT add ECS resources or put kubernetes/helm providers in terraform/ecs.tf \u2014 use eks/main/iam/alb_controller only. Delete ecs.tf if this is EKS+Helm.\n- Do NOT modify .github/workflows/deploy.yml, Dockerfiles, package.json, server.js, main.py, main.go, or charts/app/Chart.yaml / _helpers.tpl \u2014 those are locked.\n- Emit full corrected file bodies with <<<FILE>>> markers only for Terraform files that still fail validate.\n- Do not ask clarifying questions.\n\nValidation failures:\n".concat(trimmed);
}
/**
 * New projects and major architecture changes require plan approval before files are emitted.
 * Small follow-up edits against an existing workspace bypass the gate.
 *
 * CRITICAL: Short infra prompts (e.g. "A Node.js API on AWS EKS") must still
 * enter the clarifying interview — never jump straight to file generation.
 */
function requiresPlanApproval(prompt, hasExistingFiles) {
    if (/\b(?:re[-\s]?generate|regenerate)\b/i.test(prompt))
        return true;
    if (hasExistingFiles && isIterativeEditPrompt(prompt))
        return false;
    if (isOutOfScopeOpsPrompt(prompt))
        return false; // handled as a scoped reply, not generate
    // Vague "Deploy my app" etc. — always interview on a new project
    if (isVagueStackPrompt(prompt))
        return true;
    if (isFullStackPrompt(prompt))
        return true;
    // First generation: any infra signal, or enough free text to interview on
    if (!hasExistingFiles) {
        if (hasInfraSignal(prompt))
            return true;
        if (prompt.trim().length >= 20)
            return true;
        // Short deploy/create verbs without cloud still need an interview
        if (/^(deploy|create|generate|build|scaffold|design|set\s+up|setup|provision)\b/i.test(prompt.trim())) {
            return true;
        }
    }
    return false;
}
/** Detect conversational greetings, confirmations, or general questions. */
function isGreetingOnlyPrompt(prompt) {
    var lower = prompt.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
    var greetings = [
        'hi', 'hello', 'hey', 'yo', 'good morning', 'good afternoon', 'good evening',
        'hola', 'hi there', 'hello there', 'greetings', 'wasup', 'whats up', 'sup'
    ];
    return greetings.includes(lower);
}
/** Detect conversational greetings, confirmations, or general questions. */
function isConversationalPrompt(prompt) {
    var lower = prompt.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
    if (isGreetingOnlyPrompt(prompt))
        return true;
    var acknowledgements = [
        'all good', 'al good', 'looks good', 'look good', 'perfect', 'thanks', 'thank you',
        'great', 'nice', 'awesome', 'ok', 'okay', 'yes', 'no', 'agree', 'cool',
        'fine', 'sure', 'go ahead', 'sound good', 'sounds good', 'indeed', 'done',
        'no changes', 'no changes needed'
    ];
    if (acknowledgements.includes(lower))
        return true;
    var genericQuestions = [
        'how are you', 'how is it going', 'how goes it', 'who are you', 'what is this',
        'what can you do', 'what are you', 'how do you work', 'what are your capabilities',
        'what can you help with', 'what do you do', 'help', 'what should i say'
    ];
    if (genericQuestions.includes(lower))
        return true;
    // Out-of-scope ops asks are not "conversation" — route them to a scope reply
    // in the API (separate from small talk).
    if (isOutOfScopeOpsPrompt(prompt))
        return false;
    if (isJailbreakPrompt(prompt))
        return false;
    // Block unsupported runtimes
    if (isUnsupportedRuntimePrompt(prompt))
        return false;
    if (hasInfraSignal(prompt) ||
        hasCloudOrOrchestratorSignal(prompt) ||
        hasRuntimeAppSignal(prompt)) {
        return false;
    }
    if (isVagueStackPrompt(prompt))
        return false;
    // Discovery-fragment combined prompts — produced by resolveDiscoveryPrompt when
    // the user types a short context turn then a cloud/deployment term. These MUST
    // reach the clarify interview, never be treated as small talk.
    // Examples: "Small deployment\ngame app and cloud", "Medium deployment\nhealthcare app"
    var discoveryKeywords = /\b(game|gaming|app|application|cloud|workload|service|health|healthcare|e.?commerce|startup|backend|frontend|api|deployment|scale|scalable)\b/i;
    var hasMultilineContext = prompt.includes('\n') && discoveryKeywords.test(prompt);
    if (hasMultilineContext)
        return false;
    // Single-line fragment with deployment intent that doesn't have a verb — still an interview starter
    var deploymentContext = /\b(game\s+app|game\s+application|gaming\s+app|healthcare\s+app|health\s+app|ecommerce\s+app|startup\s+app|backend\s+service|cloud\s+app)\b/i;
    if (deploymentContext.test(prompt))
        return false;
    var commandVerb = /^(add|update|fix|change|remove|delete|rename|move|create|generate|build|make|set\s*up|setup|deploy|scaffold|provision|harden|secure|wire|include|configure|refactor|optimize|design)\b/;
    if (commandVerb.test(lower))
        return false;
    return true;
}
