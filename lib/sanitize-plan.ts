/**
 * Deterministic plan cleanup so inventable frameworks / scaffold defaults
 * never stay under Confirmed when the interview did not choose them.
 * (QA #8 Java→Spring Boot; QA #9 unasked Node/Postgres presented as final.)
 */

/** Affirmative Spring Boot selection — ignore "do NOT confirm Spring Boot" wording. */
function interviewChoseSpringBoot(context: string): boolean {
  if (/Language\/framework \(client override\):\s*Spring/i.test(context)) {
    return true;
  }
  if (/→\s*Spring(\s*Boot)?\b/i.test(context)) return true;
  // Bare chip "Spring Boot" as an answer line — not "Do NOT confirm Spring Boot"
  if (
    /(?:^|\n)\s*(?:→\s*)?Spring\s*Boot\s*$/im.test(context) ||
    /(?:^|\n)\s*(?:→\s*)?Spring\s*Boot\s*\./im.test(context)
  ) {
    return true;
  }
  return false;
}

function interviewChoseAspNet(context: string): boolean {
  if (/Language\/framework \(client override\):.*ASP/i.test(context)) return true;
  if (/→\s*ASP\.?NET/i.test(context)) return true;
  return false;
}

/** Interview (or prompt) affirmed Java as language only. */
export function interviewNamedJavaOnly(context: string): boolean {
  if (interviewChoseSpringBoot(context)) return false;
  if (/Language \(client override\):\s*Java only/i.test(context)) return true;
  if (/→\s*Language \(client override\):\s*Java\b/i.test(context)) return true;
  // Confirmed-choices arrow or bare answer
  if (/→\s*Java\b/i.test(context) && !/→\s*Spring/i.test(context)) return true;
  if (
    /which language should the health-check service use/i.test(context) &&
    /\bjava\b/i.test(context) &&
    !/\bspring(?:\s*boot)?\b/i.test(context.replace(/do\s+not\s+confirm\s+spring[\s\S]*?(?:\.|$)/gi, ' '))
  ) {
    return true;
  }
  return false;
}

function interviewNamedDotNetOnly(context: string): boolean {
  if (interviewChoseAspNet(context)) return false;
  return (
    /Language \(client override\):\s*\.NET only/i.test(context) ||
    (/→\s*\.NET\b/i.test(context) && !/→\s*ASP/i.test(context))
  );
}

/** True when the client actually answered a language / runtime question. */
function interviewConfirmedLanguage(context: string): boolean {
  if (/Language(?:\/framework)?\s*\(client override\)/i.test(context)) return true;
  if (
    /Health-check service language:\s*(Node\.js|Go|Python|Java|\.NET)\b/i.test(
      context
    )
  ) {
    return true;
  }
  if (/Language(?: for health-check[^:\n]*)?:\s*(Node\.js|Go|Python|Java|\.NET)\b/i.test(context)) {
    return true;
  }
  if (
    /→\s*(Node\.js|Go|Python|Java|\.NET|Spring(?:\s*Boot)?)\b/i.test(context)
  ) {
    return true;
  }
  if (
    /\b(next\.?js|node\.?js|express|fastapi|django|flask|golang)\b/i.test(
      context
    ) &&
    !/actually use|change (the )?(cloud|hosting)/i.test(context)
  ) {
    // Original prompt named a runtime (e.g. "Node.js API") — treat as confirmed signal
    return /deploy|api|service|app/i.test(context);
  }
  return false;
}

/** True when the client answered a data/cache question or named a DB in the prompt. */
function interviewConfirmedDatabase(context: string): boolean {
  if (/Data service\s*\(client override\)/i.test(context)) return true;
  if (/Data service:\s*(No data service|PostgreSQL|MySQL|Redis|MongoDB)/i.test(context)) {
    return true;
  }
  if (/Database:\s*(PostgreSQL|MySQL|Redis|MongoDB)/i.test(context)) {
    return true;
  }
  if (
    /→\s*(No data service|PostgreSQL|MySQL|Redis(?:\s*cache)?|MongoDB|Another service:)/i.test(
      context
    )
  ) {
    return true;
  }
  if (
    /\b(postgres(?:ql)?|mysql|mongodb|redis|cloud sql)\b/i.test(context) &&
    /deploy|with|database|rds|sql|data service/i.test(context)
  ) {
    return true;
  }
  return false;
}

function ensureAssumptionsSection(plan: string): string {
  if (/##\s*Assumptions\b/i.test(plan)) return plan;
  // Insert before Resources or at end of stack summary area
  if (/##\s*Resources to create\b/i.test(plan)) {
    return plan.replace(
      /(##\s*Resources to create\b)/i,
      '## Assumptions\n\n## Resources to create'
    );
  }
  return `${plan.trimEnd()}\n\n## Assumptions\n`;
}

function prependAssumption(plan: string, bullet: string): string {
  let out = ensureAssumptionsSection(plan);
  if (out.includes(bullet.slice(0, 40))) return out;
  return out.replace(
    /(##\s*Assumptions\s*\n)/i,
    `$1- ${bullet}\n`
  );
}

/** Rewrite or drop a markdown bullet/line matching `lineRe` inside a ## section. */
function mapSectionLines(
  plan: string,
  sectionHeading: RegExp,
  nextHeading: RegExp,
  mapLine: (line: string) => string | null
): string {
  const match = plan.match(sectionHeading);
  if (!match || match.index === undefined) return plan;
  const start = match.index + match[0].length;
  const rest = plan.slice(start);
  const next = rest.search(nextHeading);
  const body = next >= 0 ? rest.slice(0, next) : rest;
  const after = next >= 0 ? rest.slice(next) : '';
  const mapped = body
    .split('\n')
    .map((line) => {
      if (!line.trim() || !/^[-*]|\*\*|Runtime Stub|Database:|CI:|Health-check/i.test(line)) {
        // Still map content lines that mention Spring / defaults
        if (/spring\s*boot|DemoApplication|pom\.xml/i.test(line)) {
          return mapLine(line);
        }
        if (/Runtime Stub:|Database:|Health-check service language:/i.test(line)) {
          return mapLine(line);
        }
        return line;
      }
      return mapLine(line);
    })
    .filter((line): line is string => line !== null)
    .join('\n');
  return plan.slice(0, start) + mapped + after;
}

function stripSpringBootAsConfirmed(plan: string): string {
  let out = plan;

  // Stack summary / confirmed runtime lines
  out = out.replace(
    /^([-*]\s*)?Runtime Stub:\s*Java\s*\([^)]*Spring[^)]*\)[^\n]*/gim,
    '$1Runtime Stub: **Java** (language only — no framework confirmed; generate uses a minimal `/health` placeholder stub)'
  );
  out = out.replace(
    /^([-*]\s*)?Runtime Stub:\s*Java\s*\(Spring Boot[^)]*\)[^\n]*/gim,
    '$1Runtime Stub: **Java** (language only — framework not confirmed)'
  );
  out = out.replace(
    /Health-check service language:\s*Java\s*\([^)]*Spring[^)]*\)/gi,
    'Health-check service language: **Java** (framework not confirmed)'
  );

  // Never leave bare "Spring Boot" sounding confirmed (except Assumptions we add)
  out = out.replace(
    /\bJava\s*\(Spring Boot-based[^)]*\)/gi,
    'Java (language only; framework not confirmed)'
  );
  out = out.replace(
    /\bSpring Boot-based\b/gi,
    'Java-language (framework not confirmed)'
  );

  // File manifest — remove Spring Boot tree
  out = out.replace(
    /^[-*]\s*app\/src\/main\/java\/[^\n]*DemoApplication\.java[^\n]*\n?/gim,
    ''
  );
  out = out.replace(
    /^[-*]\s*app\/src\/main\/resources\/application\.properties[^\n]*\n?/gim,
    ''
  );
  out = out.replace(/^[-*]\s*app\/pom\.xml[^\n]*\n?/gim, '');
  out = out.replace(
    /^[-*]\s*[^\n]*DemoApplication\.java[^\n]*\n?/gim,
    ''
  );

  // Tools / implement lines that name Spring Boot as the product
  out = out.replace(
    /^[-*]\s*Java\s*\(Spring Boot\)\s*:[^\n]*/gim,
    '- Java (language only): minimal `/health` placeholder — Spring Boot was **not** selected'
  );
  out = out.replace(
    /^[-*]\s*[^\n]*minimal Java Spring Boot[^\n]*/gim,
    '- Emit Dockerfile + minimal `/health` stub for the Java **language** choice (framework not confirmed; Node/Python/Go stand-in acceptable with README honesty)'
  );
  out = out.replace(
    /Emit Dockerfile and a minimal Java Spring Boot[^\n]*/gi,
    'Emit Dockerfile + minimal `/health` stub (Java language only — Spring Boot not confirmed)'
  );
  out = out.replace(
    /build the Java application/gi,
    'build the health-check stub image'
  );

  // Remaining Spring Boot tokens outside Assumptions → demote wording
  out = out.replace(
    /\bSpring Boot\b(?!\s*(was\s+)?\*\*not\*\*| not (chosen|confirmed|selected))/gi,
    'Java (Spring Boot **not** confirmed)'
  );

  out = prependAssumption(
    out,
    'Java was selected as the **language** only — Spring Boot / `DemoApplication.java` / Maven Spring starters were **not** chosen. Any `/health` stub is a placeholder (Node/Python/Go or plain Java HTTP), not a confirmed framework.'
  );

  return out;
}

function demoteUnconfirmedRuntime(plan: string, context: string): string {
  if (interviewConfirmedLanguage(context) || interviewNamedJavaOnly(context)) {
    return plan;
  }
  let out = plan;
  out = mapSectionLines(
    out,
    /##\s*Confirmed requirements\b/i,
    /##\s+/i,
    (line) => {
      if (/Runtime Stub|Health-check service language|language:\s*(Node|Go|Python|Java)/i.test(line)) {
        return null; // drop from Confirmed
      }
      return line;
    }
  );
  out = out.replace(
    /^([-*]\s*)?Runtime Stub:\s*Node\.js[^\n]*/gim,
    '$1Runtime Stub: Node.js (**scaffold default** — language was not confirmed in the interview)'
  );
  out = out.replace(
    /^([-*]\s*)?Runtime Stub:\s*(Python|Go|Java|\.NET)[^\n]*/gim,
    '$1Runtime Stub: $2 (**scaffold default** — language was not confirmed in the interview)'
  );
  out = out.replace(
    /^([-*]\s*)?Language\/runtime stub:\s*Node\.js[^\n]*/gim,
    '$1Language/runtime stub: Node.js (**scaffold default** — language was not confirmed in the interview)'
  );
  out = prependAssumption(
    out,
    'Health-check **runtime was not confirmed** in the interview. Node.js (or the stub named in Stack summary) is a **default scaffold placeholder** — not a client-chosen language. Replace before production.'
  );
  return out;
}

function demoteUnconfirmedDatabase(plan: string, context: string): string {
  if (interviewConfirmedDatabase(context)) return plan;
  // Prompt was only "Deploy on AWS ECS" / cloud change — DB never asked
  const promptOnly =
    !/Confirmed choices:|Data service|→\s*(PostgreSQL|MySQL|Redis|MongoDB|No data)/i.test(
      context
    );
  if (!promptOnly && /\b(mysql|postgres|mongodb|redis)\b/i.test(context)) {
    return plan;
  }
  let out = plan;
  out = mapSectionLines(
    out,
    /##\s*Confirmed requirements\b/i,
    /##\s+/i,
    (line) => {
      if (/Data Storage|Database:\s*|Cloud SQL|RDS for/i.test(line)) {
        return null;
      }
      return line;
    }
  );
  out = out.replace(
    /^([-*]\s*)?Database:\s*PostgreSQL[^\n]*/gim,
    '$1Database: PostgreSQL (**scaffold default** — data service was not confirmed in the interview)'
  );
  out = out.replace(
    /^([-*]\s*)?Database:\s*[^\n]+/gim,
    (line) => {
      if (/\*\*scaffold default\*\*/i.test(line)) return line;
      if (/not confirmed|assumption/i.test(line)) return line;
      return line.replace(/\s*$/, ' (**scaffold default** — data service was not confirmed)');
    }
  );
  out = prependAssumption(
    out,
    'A **database was not confirmed** in the interview. PostgreSQL (or the engine named in Stack summary) is a **default generated scaffold** — not a client architectural decision. Choose No data service / another engine in a follow-up if needed.'
  );
  return out;
}

/** True when the client named a CI system. */
function interviewConfirmedCi(context: string): boolean {
  if (/CI\/CD system\s*\(client override\)/i.test(context)) return true;
  if (
    /CI\/CD system:\s*(GitHub Actions|GitLab CI|Jenkins|Azure DevOps|AWS CodePipeline|Google Cloud Build|OCI DevOps)\b/i.test(
      context
    )
  ) {
    return true;
  }
  if (
    /→\s*(GitHub Actions|GitLab CI|Jenkins|Azure DevOps|AWS CodePipeline|Google Cloud Build|OCI DevOps)\b/i.test(
      context
    )
  ) {
    return true;
  }
  const firstLines = context.split('\n').slice(0, 4).join(' ');
  return /\b(github actions|gitlab ci|jenkins|azure devops|codepipeline|cloud build|oci devops)\b/i.test(
    firstLines
  );
}

function demoteUnconfirmedCi(plan: string, context: string): string {
  if (interviewConfirmedCi(context)) return plan;
  let out = plan;
  out = mapSectionLines(
    out,
    /##\s*Confirmed requirements\b/i,
    /##\s+/i,
    (line) => {
      if (/Use GitLab|Use GitHub|CI\/CD System:|Jenkins|Azure DevOps|CodePipeline|Cloud Build|OCI DevOps/i.test(line)) {
        return null;
      }
      return line;
    }
  );
  out = out.replace(
    /^([-*]\s*)?CI:\s*GitLab CI(?:\/CD)?[^\n]*/gim,
    '$1CI: GitLab CI (**scaffold default** — CI system was not confirmed in the interview)'
  );
  out = out.replace(
    /^([-*]\s*)?CI:\s*(GitHub Actions|Jenkins|Azure DevOps|AWS CodePipeline|Google Cloud Build|OCI DevOps)[^\n]*/gim,
    '$1CI: $2 (**scaffold default** — CI system was not confirmed in the interview)'
  );
  out = prependAssumption(
    out,
    '**CI/CD was not confirmed** in the interview. The pipeline named in Stack summary is a **profile default scaffold** — not a finalized client CI decision. Re-pick CI in a follow-up if needed.'
  );
  return out;
}

/** True when plan/context is AWS (not Azure/GCP/Oracle). */
function planOrContextIsAws(plan: string, context: string): boolean {
  const blob = `${context}\n${plan}`;
  // Confirmed non-AWS cloud always wins — leaked "AWS ECS" / "RDS" / "ALB"
  // assumption bullets must not flip this (QA #25 Azure AKS + Redis).
  if (
    /Cloud(?:\s+Provider)?:\s*(Microsoft\s+)?Azure\b/i.test(blob) ||
    /Cloud:\s*(Microsoft\s+)?Azure\b/i.test(blob) ||
    /Cloud(?:\s+Provider)?:\s*(GCP|Google Cloud)\b/i.test(blob) ||
    /Cloud:\s*(GCP|Google Cloud)\b/i.test(blob) ||
    /Cloud(?:\s+Provider)?:\s*(Oracle|OCI)\b/i.test(blob) ||
    /Cloud:\s*(Oracle|OCI)\b/i.test(blob) ||
    /Hosting platform:\s*Azure Kubernetes/i.test(blob) ||
    /Hosting platform:\s*Azure Container Apps/i.test(blob) ||
    /Compute:\s*Azure Kubernetes/i.test(blob) ||
    /\bAzure Kubernetes Service\b/i.test(blob)
  ) {
    return false;
  }
  if (
    /\b(Azure Container Apps|Cloud Run|GKE|OKE)\b/i.test(blob) &&
    !/Cloud(?:\s+Provider)?:\s*AWS\b/i.test(blob) &&
    !/\bAmazon ECS\b|\bAmazon EKS\b/i.test(blob)
  ) {
    return false;
  }
  return /\bAWS\b|\bAmazon ECS\b|\bAmazon EKS\b|\bFargate\b/i.test(blob);
}

function planOrContextIsAzure(plan: string, context: string): boolean {
  const blob = `${context}\n${plan}`;
  return (
    /Cloud(?:\s+Provider)?:\s*(Microsoft\s+)?Azure\b/i.test(blob) ||
    /Cloud:\s*(Microsoft\s+)?Azure\b/i.test(blob) ||
    /Hosting platform:\s*Azure /i.test(blob) ||
    /\bAzure Kubernetes Service\b|\bAzure Container Apps\b|\bAKS\b/i.test(blob)
  );
}

/** Normalize GCP region strings into proper AWS regions when cloud is AWS. */
function sanitizeAwsRegion(plan: string, context: string): string {
  const blob = `${context}\n${plan}`;
  const isAws = /Cloud provider:\s*AWS/i.test(blob) || /\bAWS\b/i.test(blob) || /Amazon/i.test(blob);
  const isGcp = /Cloud provider:\s*Google/i.test(blob) || /Google Cloud/i.test(blob);
  if (!isAws || isGcp) return plan;

  let out = plan;
  out = out.replace(/\beurope-west1\b/gi, 'eu-west-1');
  out = out.replace(/\beurope-west3\b/gi, 'eu-central-1');
  out = out.replace(/\basia-south1\b/gi, 'ap-south-1');
  out = out.replace(/\bus-central1\b/gi, 'us-east-1');
  return out;
}

/** Purge database references from assumptions and stack summary when No Database is selected. */
function sanitizeNoDatabase(plan: string, context: string): string {
  const blob = `${context}\n${plan}`;
  const noDb = /No data service|No database|without a database|database:\s*none/i.test(blob);
  if (!noDb) return plan;

  let out = plan;
  out = out.replace(/^[-*]?\s*Database:\s*(?:PostgreSQL|MySQL|Redis|MongoDB)[^\n]*/gim, '- Database: No database');
  out = out.replace(/Data [Ss]ervice:\s*(?:PostgreSQL|MySQL|Redis|MongoDB)/gi, 'Data Service: No database');
  out = out.replace(/^[-*]\s*[^\n]*Per-environment databases[^\n]*\n?/gim, '');
  out = out.replace(/^[-*]\s*[^\n]*Secrets:[^\n]*DB connection strings[^\n]*\n?/gim, '');
  out = out.replace(/^[-*]\s*[^\n]*database credentials[^\n]*\n?/gim, '');
  out = out.replace(/^[-*]\s*[^\n]*PostgreSQL instance[^\n]*\n?/gim, '');
  out = out.replace(/^[-*]\s*[^\n]*Redis cache instance[^\n]*\n?/gim, '');
  return out;
}

/** Keep MongoDB as confirmed data service and avoid demoting to PostgreSQL. */
function sanitizeMongoDB(plan: string, context: string): string {
  const blob = `${context}\n${plan}`;
  const isMongo = /\bMongoDB\b/i.test(blob);
  if (!isMongo) return plan;

  let out = plan;
  out = out.replace(/MongoDB requested,\s*will scaffold a PostgreSQL stand-in[^\n]*/gi, 'MongoDB selected (Cosmos DB API / DocumentDB / MongoDB container)');
  out = out.replace(/scaffold a PostgreSQL stand-in/gi, 'scaffold a MongoDB-compatible service');
  return out;
}

/** Drop cross-cloud artifacts (AWS/Azure/GCP/OCI) from non-matching architectures (Akruti Step 4 Rules). */
function stripAwsAssumptionLeakage(plan: string, context: string): string {
  const blob = `${context}\n${plan}`;
  const isGcp = /Google Cloud|\bGCP\b|google_compute_|google_container_/i.test(blob);
  const isAzure = /Microsoft Azure|\bAzure\b|azurerm_/i.test(blob);
  const isOracle = /Oracle Cloud|\bOCI\b|oci_core_|oci_identity_/i.test(blob);
  const isAws = /AWS|Amazon|\baws_/i.test(blob) && !isGcp && !isAzure && !isOracle;

  let out = plan
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      // Match with or without markdown bullets
      if (
        /locked AWS ECS template|AWS Secrets Manager|Secrets Manager \(or SSM\)|HTTP:80 ALB|Attach ACM \+ HTTPS|ALB listener so `?terraform validate|not three RDS instances|Wire Secrets Manager/i.test(
          t
        )
      ) {
        if (!isAws) return false;
        if (/EKS|Kubernetes/i.test(blob) && /locked AWS ECS template/i.test(t)) return false;
      }
      if (
        /HTTPS intent:\s*Client confirmed Public with secure HTTPS/i.test(t) &&
        /Public without a custom domain/i.test(blob)
      ) {
        return false;
      }
      if (
        /Health-check runtime was not confirmed/i.test(t) &&
        /Node\.js|Python|Go|Java|\.NET/i.test(context)
      ) {
        return false;
      }
      if (isGcp && /Azure Key Vault|AWS Secrets Manager|HTTP ingress for AKS|OCI Vault|Application Gateway|Amazon EKS|Amazon ECR|Azure Container Registry|azurerm_/i.test(t)) {
        return false;
      }
      if (isAzure && /AWS Secrets Manager|OCI Vault|Amazon EKS|Amazon ECR|Oracle Container Registry|oci_core_|google_compute_/i.test(t)) {
        return false;
      }
      if (isOracle && /AWS Secrets Manager|Azure Key Vault|Amazon EKS|Azure Container Apps|Application Gateway|azurerm_|google_compute_/i.test(t)) {
        return false;
      }
      if (isAws && /Azure Key Vault|OCI Vault|GKE|AKS|Azure Container Apps|azurerm_|oci_core_|google_compute_/i.test(t)) {
        return false;
      }
      if (
        /Scaffold delivery vs access intent/i.test(t) &&
        /HTTP:80|ALB|ACM|Public without a custom domain/i.test(t)
      ) {
        if (!isAws) return false;
      }
      if (
        /Per-environment databases/i.test(t) &&
        /RDS instances/i.test(t)
      ) {
        if (!isAws) return false;
      }
      return true;
    })
    .join('\n');

  // Fix CI assumptions leakage (e.g. Jenkins/GitLab CI marked as not confirmed or OCI DevOps selected)
  if (/Jenkins/i.test(blob)) {
    out = out.replace(/^[-*]?\s*[^\n]*OCI DevOps was selected[^\n]*\n?/gim, '');
    out = out.replace(/^[-*]?\s*[^\n]*CI\/CD was not confirmed[^\n]*\n?/gim, '');
  }
  if (/GitLab CI/i.test(blob)) {
    out = out.replace(/^[-*]?\s*[^\n]*OCI DevOps was selected[^\n]*\n?/gim, '');
    out = out.replace(/^[-*]?\s*[^\n]*CI\/CD was not confirmed[^\n]*\n?/gim, '');
  }

  // Model sometimes copies the old sanitizer wording into Implement stage
  out = out.replace(
    /Apply client overrides\s*\([^)]*\);\s*treat runtime\/DB\/CI\/region defaults as Assumptions[^\n]*/gi,
    'Apply confirmed interview choices (cloud, compute, CI, region, environments, access, data service, language) into Terraform variables and Helm/CI config'
  );
  out = out.replace(
    /treat runtime\/DB\/CI\/region defaults as Assumptions[^\n]*/gi,
    'use confirmed interview answers for runtime, database, CI, and region'
  );
  return out;
}

/**
 * QA #7 — Align plan prose with what Approve & Generate actually emits.
 * AWS-specific honesty (HTTP:80 ALB, Secrets Manager) only when the stack is AWS.
 */
function honestScaffoldDelivery(plan: string, context: string): string {
  let out = plan;
  const isAws = planOrContextIsAws(plan, context);
  const oneEnv =
    /→\s*One environment\b/i.test(context) ||
    /Which environments do you need\s*\n\s*→\s*One environment\b/i.test(context) ||
    /Environments:\s*One environment\b/i.test(context);

  if (isAws) {
    // Architecture / Tools / Networking: do not promise ACM HTTPS as shipped.
    out = out.replace(
      /fronted by an Application Load Balancer \(ALB\) in public subnets for public access via HTTPS\.?/gi,
      'fronted by an Application Load Balancer (ALB) in public subnets for public access (scaffold ships **HTTP:80** for validate-safe TLS-free Terraform; attach ACM + HTTPS:443 before production)'
    );
    out = out.replace(
      /Handling public ingress, load balancing, and HTTPS termination\.?/gi,
      'Handling public ingress and load balancing (HTTP:80 in the locked scaffold; HTTPS termination is a follow-up with ACM)'
    );
    out = out.replace(
      /Set up ALB listener for HTTPS traffic and target groups for ECS services\.?/gi,
      'Set up ALB listener (**HTTP:80** in locked scaffold) and target groups for ECS services; document ACM + HTTPS:443 as a production follow-up'
    );
    out = out.replace(
      /AWS Application Load Balancer \(ALB\):\s*Internet-facing load balancer with a listener for HTTPS\.?/gi,
      'AWS Application Load Balancer (ALB): Internet-facing load balancer with an **HTTP:80** listener in the locked scaffold (HTTPS/ACM follow-up)'
    );

    out = out.replace(
      /^([-*]\s*)?TLS:\s*HTTPS will be terminated at the ALB using an AWS-managed certificate[^\n]*/gim,
      '$1TLS: Client asked for public access on the default LB hostname. **Approve & Generate emits HTTP:80** so `terraform validate` stays certificate-free. Attach ACM (or equivalent) + HTTPS:443 before production — do not treat HTTP:80 as the product choice.'
    );
    out = out.replace(
      /^([-*]\s*)?HTTPS will be (?:enabled|terminated)[^\n]*ACM[^\n]*/gim,
      '$1HTTPS/ACM is a **production follow-up**. The locked scaffold uses an HTTP:80 listener so validate stays certificate-free.'
    );

    out = out.replace(
      /^([-*]\s*)?Secrets Management:\s*AWS Secrets Manager will be used[^\n]*/gim,
      '$1Secrets: Locked scaffold uses Terraform `random_password` for the DB (state-backed). **AWS Secrets Manager wiring is a follow-up** — placeholders / SM resources are not required for the starting scaffold.'
    );
    out = out.replace(
      /AWS Secrets Manager will be used for database credentials[^\n]*/gi,
      'Database password is generated in Terraform (`random_password`) for the starting scaffold; wire AWS Secrets Manager before production'
    );
    out = out.replace(
      /^([-*]\s*)?Secrets:\s*Database credentials will be managed in AWS Secrets Manager[^\n]*/gim,
      '$1Secrets: Starting scaffold uses Terraform-managed DB password (`random_password`). Move credentials to AWS Secrets Manager before production.'
    );
    out = out.replace(
      /^([-*]\s*)?[^\n]*placeholder secret resources[^\n]*Secrets Manager[^\n]*/gim,
      '- Secrets: Terraform `random_password` for DB in the locked template; Secrets Manager integration is out of scope for the starting scaffold'
    );
    out = out.replace(
      /^([-*]\s*)?AWS Secrets Manager placeholders[^\n]*/gim,
      '$1DB password via Terraform `random_password` (Secrets Manager is a follow-up)'
    );
    out = out.replace(
      /Terraform will create placeholder secret resources[^\n]*/gi,
      'Terraform generates a DB password with `random_password` in the locked scaffold; Secrets Manager is a follow-up'
    );

    out = out.replace(
      /^([-*]\s*)?Database Environments:\s*Each environment[^\n]*dedicated RDS[^\n]*/gim,
      '$1Database environments: Separate **RDS per environment** is achieved by applying Terraform once per env with `environments/*.tfvars` (distinct `environment` name) — not a single apply that creates three databases, and not automatic Terraform workspaces unless you add a backend.'
    );

    // HA Postgres → Multi-AZ RDS instance ONLY (never Aurora / rds_cluster) — QA #23 100%
    const haPostgres =
      /PostgreSQL|postgres|High availability|Multi-AZ|aws_rds_cluster|Aurora|aws_db_instance/i.test(
        `${context}\n${out}`
      );
    if (haPostgres || /Database:\s*PostgreSQL/i.test(out)) {
      // Drop cluster resource lines entirely (do not leave duplicate db_instance lines)
      out = out.replace(
        /^[-*]\s*aws_rds_cluster[^\n]*\n?/gim,
        ''
      );
      out = out.replace(
        /^[-*]\s*aws_rds_cluster_instance[^\n]*\n?/gim,
        ''
      );
      out = out.replace(
        /^[-*]?\s*aws_rds_cluster\s*\([^\n]*\n?/gim,
        ''
      );
      out = out.replace(
        /^[-*]?\s*aws_rds_cluster_instance\s*\n?/gim,
        ''
      );
      out = out.replace(
        /^[-*]?\s*aws_db_instance[^\n]*if not using cluster[^\n]*\n?/gim,
        '- aws_db_instance (Amazon RDS PostgreSQL, Multi-AZ)\n'
      );
      out = out.replace(
        /aws_rds_cluster\s*&\s*aws_rds_cluster_instance/gi,
        'aws_db_instance (Multi-AZ Amazon RDS PostgreSQL)'
      );
      out = out.replace(/\baws_rds_cluster_instance\b/gi, 'aws_db_instance');
      out = out.replace(/\baws_rds_cluster\b/gi, 'aws_db_instance');
      out = out.replace(
        /\b(?:Amazon\s+)?Aurora PostgreSQL(?:\s+cluster)?\b/gi,
        'Amazon RDS PostgreSQL (Multi-AZ)'
      );
      out = out.replace(
        /\bRDS Aurora PostgreSQL(?:\s*\(Multi-AZ\))?/gi,
        'Amazon RDS PostgreSQL (Multi-AZ)'
      );
      out = out.replace(
        /Aurora PostgreSQL cluster for high availability/gi,
        'Multi-AZ Amazon RDS PostgreSQL instance (`aws_db_instance`) for high availability'
      );
      // Deduplicate consecutive identical aws_db_instance bullets
      out = out.replace(
        /((?:^|\n)[-*]?\s*aws_db_instance[^\n]*)(\n[-*]?\s*aws_db_instance[^\n]*)+/gi,
        '$1'
      );
      if (
        /Database:\s*PostgreSQL|PostgreSQL \(high availability\)|High availability/i.test(
          `${context}\n${out}`
        ) &&
        !/aws_db_instance/i.test(out)
      ) {
        out = out.replace(
          /(##\s*Resources to create[\s\S]*?Database:\s*\n)/i,
          '$1- aws_db_instance (Amazon RDS PostgreSQL, Multi-AZ)\n- aws_db_subnet_group\n'
        );
      }
    }

    const accessSecureHttps =
      /Public with secure HTTPS/i.test(context) ||
      /API Access:\s*Public with secure HTTPS/i.test(out);
    const accessPublicBasic =
      /Public without a custom domain/i.test(context) ||
      /API Access:\s*Public without a custom domain/i.test(out);

    // Never stamp wrong access goal (QA #23/#25)
    if (accessSecureHttps) {
      out = out.replace(
        /^[-*]?\s*[^\n]*Scaffold delivery vs access intent:[^\n]*Public without a custom domain[^\n]*\n?/gim,
        ''
      );
      out = out.replace(
        /^[-*]?\s*[^\n]*"Public without a custom domain"[^\n]*confirmed access[^\n]*\n?/gim,
        ''
      );
      out = prependAssumption(
        out,
        '**HTTPS intent:** Client confirmed **Public with secure HTTPS**. Locked scaffold may still emit an **HTTP:80** ALB listener so `terraform validate` stays certificate-free. Attach ACM + HTTPS:443 before production — do not treat HTTP:80 as the final product choice.'
      );
    } else if (accessPublicBasic) {
      out = prependAssumption(
        out,
        '**Scaffold delivery vs access intent:** "Public without a custom domain" is the confirmed access *goal*. Approve & Generate still emits an **HTTP:80** ALB listener so `terraform validate` stays certificate-free. Attach ACM + HTTPS:443 before production — do not treat HTTP:80 as the final product choice.'
      );
    } else {
      out = prependAssumption(
        out,
        '**Scaffold delivery vs access intent:** Public HTTPS access is the confirmed *goal* when selected. Approve & Generate still emits an **HTTP:80** ALB listener so `terraform validate` stays certificate-free. Attach ACM + HTTPS:443 before production — do not treat HTTP:80 as the final product choice.'
      );
    }

    out = prependAssumption(
      out,
      '**Secrets:** The locked AWS ECS template uses Terraform `random_password` for RDS — not AWS Secrets Manager resources. Wire Secrets Manager (or SSM) before production.'
    );
    out = prependAssumption(
      out,
      '**Per-environment databases:** Multi-env (dev/staging/prod) means separate `environments/*.tfvars` applies (or workspaces you add) — not three RDS instances from one apply unless you explicitly extend the module. **One environment** → a single `environments/development.tfvars` apply.'
    );
  } else {
    out = stripAwsAssumptionLeakage(out);
    const isAzure = planOrContextIsAzure(out, context);
    const accessSecureHttps =
      /Public with secure HTTPS/i.test(context) ||
      /API [Aa]ccess:\s*Public with secure HTTPS/i.test(out);
    const accessPublicBasic =
      /Public without a custom domain/i.test(context) ||
      /API [Aa]ccess:\s*Public without a custom domain/i.test(out);

    if (isAzure) {
      if (accessSecureHttps) {
        out = prependAssumption(
          out,
          '**HTTPS intent:** Client confirmed **Public with secure HTTPS**. Locked AKS/ACA scaffold still uses validate-safe **HTTP** ingress/listeners so `terraform validate` stays certificate-free. Attach Application Gateway / ingress TLS + custom domain before production — do not treat HTTP-only as the final product choice.'
        );
      } else if (accessPublicBasic) {
        out = prependAssumption(
          out,
          '**Scaffold delivery vs access intent:** "Public without a custom domain" is the confirmed access *goal*. Locked scaffold may emit HTTP-only ingress so `terraform validate` stays certificate-free; add TLS before production.'
        );
      }
      out = prependAssumption(
        out,
        '**Secrets:** Prefer **Azure Key Vault** references for Redis/DB connection strings before production — the locked template may use Terraform placeholders / `random_password` only (not AWS Secrets Manager).'
      );
      out = prependAssumption(
        out,
        '**Per-environment data:** Multi-env (dev/staging) means separate `environments/*.tfvars` applies (or workspaces you add) — not multiple Redis/DB instances from one apply unless you extend the module.'
      );
    } else if (accessSecureHttps || accessPublicBasic) {
      out = prependAssumption(
        out,
        accessSecureHttps
          ? '**HTTPS intent:** Client confirmed **Public with secure HTTPS**. Locked scaffold may still use HTTP-only listeners/ingress so `terraform validate` stays certificate-free. Attach managed TLS + custom domain before production.'
          : '**Scaffold delivery vs access intent:** Public access without a custom domain is the confirmed *goal*; add managed TLS before production if required.'
      );
    }
  }

  // Always: never demote confirmed interview picks in Implement stage wording
  out = out.replace(
    /Apply client overrides\s*\([^)]*\);\s*treat runtime\/DB\/CI\/region defaults as Assumptions[^\n]*/gi,
    'Apply confirmed interview choices (cloud, compute, CI, region, environments, access, data service, language) into Terraform variables and Helm/CI config'
  );

  // File manifest: locked Node stub is app/server.js, not src/app.js
  out = out.replace(/^[-*]\s*src\/app\.js[^\n]*\n?/gim, '- app/server.js (minimal Node `/health` stub)\n');
  out = out.replace(/^[-*]\s*src\/package\.json[^\n]*\n?/gim, '- app/package.json\n');
  out = out.replace(/^[-*]\s*src\/package-lock\.json[^\n]*\n?/gim, '- app/package-lock.json\n');
  out = out.replace(/^src\/(package(?:-lock)?\.json)\s*$/gim, 'app/$1');
  out = out.replace(
    /Emit Dockerfile and a minimal src\/app\.js[^\n]*/gi,
    'Emit Dockerfile and a minimal `app/server.js` Node.js `/health` stub with package.json/package-lock.json'
  );
  out = out.replace(/\bsrc\/app\.js\b/g, 'app/server.js');
  out = out.replace(/\bsrc\/package\.json\b/g, 'app/package.json');
  out = out.replace(/\bsrc\/package-lock\.json\b/g, 'app/package-lock.json');

  if (isAws) {
    out = out.replace(
      /Implement a rollback mechanism to revert to the previous stable task definition in case of deployment failure\. This will involve capturing the prior task definition ARN and updating the service to it upon job failure\.?/gi,
      'On deploy failure, the GitHub Actions workflow captures the prior ECS task definition ARN and runs `aws ecs update-service` to roll back, then waits for service stability.'
    );
  }

  // One environment selected — do not invent staging / production-like / multi-env var wording
  if (oneEnv) {
    out = out.replace(
      /\bOne\s*\(\s*development\s*\/\s*staging\s*\)/gi,
      'One environment (development)'
    );
    out = out.replace(
      /\bOne environment\s*\(\s*production-like\s*\)/gi,
      'One environment (development)'
    );
    out = out.replace(
      /Environments:\s*One\s*\(\s*development\s*\/\s*staging\s*\)/gi,
      'Environments: One environment (development)'
    );
    out = out.replace(
      /Environments:\s*One environment\s*\(defaulting to ['"]?dev['"]?\)/gi,
      'Environments: One environment (development)'
    );
    out = out.replace(
      /One environment\s*\(defaulting to ['"]?dev['"]?\)/gi,
      'One environment (development)'
    );
    out = out.replace(
      /One environment\s*\(development\s*\/\s*staging\s*\/\s*production[^)]*\)/gi,
      'One environment (development)'
    );
    out = out.replace(
      /Environments:\s*One environment\s*\(development\s*\/\s*staging\s*\/\s*production[^)]*\)/gi,
      'Environments: One environment (development)'
    );
    out = out.replace(
      /via\s+var\.environment/gi,
      'via environments/development.tfvars'
    );
    out = out.replace(
      /The single environment will be named\s+dev\b/gi,
      'The single environment uses `environments/development.tfvars` (environment = "development")'
    );
    out = out.replace(
      /single ['"]dev['"] environment/gi,
      'single development environment'
    );
  }

  // Azure DevOps CI — never leave GitHub Actions AWS Auth template lines
  if (
    /Azure DevOps/i.test(context) ||
    /CI\/CD System:\s*Azure DevOps/i.test(out) ||
    /CI:\s*Azure DevOps/i.test(out)
  ) {
    out = out.replace(
      /^[-*]\s*[^\n]*GitHub Actions for AWS Auth[^\n]*\n?/gim,
      ''
    );
    out = out.replace(
      /^[-*]\s*[^\n]*GitHub Actions[^\n]*OIDC[^\n]*AWS[^\n]*\n?/gim,
      ''
    );
  }

  return out;
}

/**
 * When OCI DevOps appears with AWS ECR/EKS (specifically on AWS cloud), rewrite OCIR → ECR.
 * BUT if the target cloud is Oracle, purge any accidental AWS ECR/EKS mentions and keep OCIR clean.
 */
function stripCrossCloudCiRegistryConflicts(
  plan: string,
  context: string
): string {
  const blob = `${context}\n${plan}`;
  const isOracleCloud =
    /Cloud provider(?:\s*\(client override\))?:\s*Oracle/i.test(context) ||
    /Cloud provider:\s*Oracle/i.test(blob) ||
    /\boracle cloud infrastructure\b/i.test(context);
  const isAwsCloud =
    /Cloud provider(?:\s*\(client override\))?:\s*AWS/i.test(context) ||
    /Cloud provider:\s*AWS/i.test(context);

  let out = plan;

  if (isOracleCloud && !isAwsCloud) {
    // Purge AWS / Azure leakage from Oracle OCI plans
    out = out.replace(/Oracle Container Registry\s*\(ECR\)/gi, 'Oracle Container Registry (OCIR)');
    out = out.replace(/Oracle Container Registry\s*\(AWS ECR\)/gi, 'Oracle Container Registry (OCIR)');
    out = out.replace(/Amazon Elastic Container Registry\s*\(ECR\)/gi, 'Oracle Container Registry (OCIR)');
    out = out.replace(/Amazon ECR/gi, 'Oracle Container Registry (OCIR)');
    out = out.replace(/Azure Key Vault/gi, 'OCI Vault');
    out = out.replace(/AWS Secrets Manager/gi, 'OCI Vault');
    out = out.replace(/Locked AKS\/ACA scaffold/gi, 'Locked OKE scaffold');
    out = out.replace(/CI\/registry consistency:\s*OCI DevOps was selected with an AWS compute\/registry stack[^\n]*/gi, '');
    return out;
  }

  const hasOciDevops = /\bOCI DevOps\b/i.test(blob);
  const hasAwsRegistryOrCompute =
    /\b(ECR|Amazon ECR|EKS|Amazon EKS|aws_ecr)\b/i.test(blob);
  if (!hasOciDevops || !hasAwsRegistryOrCompute || !isAwsCloud) return out;

  out = out.replace(/\bOCIR\b/g, 'ECR');
  out = out.replace(
    /Oracle Container Registry\s*\(OCIR\)/gi,
    'Amazon Elastic Container Registry (ECR)'
  );
  out = out.replace(
    /Oracle Container Registry/gi,
    'Amazon Elastic Container Registry (ECR)'
  );
  out = out.replace(
    /push(?:es|ing)?(?:\s+Docker)?\s+images?\s+to\s+OCIR/gi,
    'push images to ECR'
  );
  out = prependAssumption(
    out,
    '**CI/registry consistency:** OCI DevOps was selected with an AWS compute/registry stack (ECR/EKS). Image push targets **Amazon ECR** (not OCIR) so the pipeline matches Terraform. Confirm OCI→AWS credentials / OIDC before production.'
  );

  return out;
}

/**
 * Demote Spring Boot / ASP.NET from Confirmed when the client only chose Java / .NET,
 * and mark unasked runtime/DB as scaffold defaults (not Confirmed).
 */
export function sanitizePlanAgainstInterview(
  plan: string,
  interviewContext: string
): string {
  if (!plan?.trim()) return plan;
  const ctx = interviewContext || '';
  let out = plan;

  if (interviewNamedJavaOnly(ctx)) {
    out = stripSpringBootAsConfirmed(out);
  }

  if (interviewNamedDotNetOnly(ctx)) {
    // Avoid nesting: replacing ASP.NET → ".NET (ASP.NET not confirmed)" re-matches
    // the inner ASP.NET and becomes ".NET (.NET (ASP.NET not confirmed) not confirmed)".
    out = out.replace(
      /\.NET\s*\(\s*\.NET\s*\(\s*ASP\.NET[^)]*\)\s*not confirmed\s*\)/gi,
      '.NET (ASP.NET **not** confirmed)'
    );
    out = out.replace(
      /\bASP\.NET(?:\s+Core)?\b(?!\s*\([^)]*not\s+confirmed)/gi,
      'ASP.NET (**not** confirmed)'
    );
    out = out.replace(
      /^([-*]\s*)?Runtime Stub:\s*Node\.js[^\n]*/gim,
      '$1Runtime Stub: **.NET** (language only — ASP.NET **not** confirmed; Node `/health` stub is a build placeholder)'
    );
    out = out.replace(
      /^([-*]\s*)?Health-check service language:\s*\.NET(?!\s*\([^)]*not\s+confirmed\))[^\n]*/gim,
      '$1Health-check service language: **.NET** (framework not confirmed)'
    );

    // Clean up duplicate consecutive (not confirmed) or (framework not confirmed) strings
    out = out.replace(
      /\((?:framework|ASP\.NET)\s+not\s+confirmed\)\s*\((?:framework|ASP\.NET)\s+not\s+confirmed\)/gi,
      '(framework not confirmed)'
    );
    out = out.replace(
      /\(not confirmed\)\s*\(not confirmed\)/gi,
      '(not confirmed)'
    );

    // File manifesto must not invent a real .NET project when language-only
    out = out.replace(/^[-*]\s*app\/Program\.cs[^\n]*\n?/gim, '');
    out = out.replace(/^[-*]\s*app\/app\.csproj[^\n]*\n?/gim, '');
    out = out.replace(/^[-*]\s*Program\.cs[^\n]*\n?/gim, '');
    out = out.replace(
      /Emit Dockerfile and a minimal \.NET health-check application stub[^\n]*/gi,
      'Emit Dockerfile + minimal `/health` stub for the .NET **language** choice (ASP.NET not confirmed; Node/Python/Go stand-in with README honesty)'
    );
    out = out.replace(
      /A minimal \.NET Kestrel HTTP server will be provided[^\n]*/gi,
      'A minimal `/health` placeholder stub (Node/Python/Go) is emitted so image build passes — not a confirmed ASP.NET/Kestrel app'
    );
    if (!out.includes('.NET was selected as the **language** only')) {
      out = prependAssumption(
        out,
        '.NET was selected as the **language** only — ASP.NET was not chosen; any stub is a Node/Python/Go `/health` placeholder, not a confirmed framework.'
      );
    }
  }

  out = demoteUnconfirmedRuntime(out, ctx);
  out = demoteUnconfirmedDatabase(out, ctx);
  out = demoteUnconfirmedCi(out, ctx);
  out = honestScaffoldDelivery(out, ctx);
  out = stripCrossCloudCiRegistryConflicts(out, ctx);
  out = sanitizeGcpRegion(out, ctx);
  out = sanitizeAwsRegion(out, ctx);
  out = sanitizeNoDatabase(out, ctx);
  out = sanitizeMongoDB(out, ctx);

  return out;
}
