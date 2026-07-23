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
  if (
    /→\s*(No data service|PostgreSQL|MySQL|Redis(?:\s*cache)?|MongoDB|Another service:)/i.test(
      context
    )
  ) {
    return true;
  }
  if (
    /\b(postgres(?:ql)?|mysql|mongodb|redis|cloud sql)\b/i.test(context) &&
    /deploy|with|database|rds|sql/i.test(context)
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
    out = out.replace(
      /\bASP\.NET(?:\s+Core)?\b(?!\s*\(not confirmed)/gi,
      '.NET (ASP.NET not confirmed)'
    );
    out = prependAssumption(
      out,
      '.NET was selected as the **language** only — ASP.NET was not chosen; any stub is a placeholder, not a confirmed framework.'
    );
  }

  out = demoteUnconfirmedRuntime(out, ctx);
  out = demoteUnconfirmedDatabase(out, ctx);
  out = demoteUnconfirmedCi(out, ctx);

  return out;
}
