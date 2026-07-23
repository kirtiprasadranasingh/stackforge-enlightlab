/**
 * Deterministic plan cleanup so inventable frameworks never stay "confirmed"
 * when the interview only named a language (QA: Java → Spring Boot).
 */

/** Affirmative Spring Boot selection — ignore "do NOT confirm Spring Boot" wording. */
function interviewChoseSpringBoot(context: string): boolean {
  if (/Language\/framework \(client override\):\s*Spring/i.test(context)) {
    return true;
  }
  if (/→\s*Spring(\s*Boot)?\b/i.test(context)) return true;
  if (
    /\bspring(?:\s*boot)?\b/i.test(context) &&
    !/\bjava only\b/i.test(context) &&
    !/do\s+not\s+confirm\s+spring/i.test(context) &&
    !/spring boot (was )?not (chosen|confirmed|selected)/i.test(context)
  ) {
    return true;
  }
  return false;
}

function interviewChoseAspNet(context: string): boolean {
  if (/Language\/framework \(client override\):.*ASP/i.test(context)) return true;
  if (/→\s*ASP\.?NET/i.test(context)) return true;
  return (
    /\basp\.?\s*net\b/i.test(context) &&
    !/\.net only\b/i.test(context) &&
    !/do\s+not\s+confirm\s+asp/i.test(context)
  );
}

function interviewNamedJavaOnly(context: string): boolean {
  if (interviewChoseSpringBoot(context)) return false;
  return (
    /Language \(client override\):\s*Java only/i.test(context) ||
    (/\bjava\b/i.test(context) && !/\bspring(?:\s*boot)?\b/i.test(context))
  );
}

function interviewNamedDotNetOnly(context: string): boolean {
  if (interviewChoseAspNet(context)) return false;
  return (
    /Language \(client override\):\s*\.NET only/i.test(context) ||
    (/\.net\b|dotnet\b/i.test(context) && !/\basp\.?\s*net\b/i.test(context))
  );
}

/**
 * Demote Spring Boot / ASP.NET from Confirmed requirements when the client
 * only chose Java / .NET. Keeps stub details under Assumptions.
 */
export function sanitizePlanAgainstInterview(
  plan: string,
  interviewContext: string
): string {
  if (!plan?.trim()) return plan;
  const ctx = interviewContext || '';
  let out = plan;

  if (interviewNamedJavaOnly(ctx)) {
    out = out.replace(
      /\bSpring Boot-based\b/gi,
      'Java-language (framework not confirmed)'
    );
    out = out.replace(
      /\bSpring Boot\b(?!\s*\(not confirmed)/gi,
      'Java (Spring Boot not confirmed)'
    );
    out = out.replace(
      /\bDemoApplication\.java\b/gi,
      'minimal Java /health entry (placeholder)'
    );
    if (
      /##\s*Assumptions/i.test(out) &&
      !/Java was selected as the \*\*language\*\* only/i.test(out)
    ) {
      out = out.replace(
        /(##\s*Assumptions\s*\n)/i,
        `$1- Java was selected as the **language** only — Spring Boot was not chosen; any Java stub is a placeholder, not a confirmed framework.\n`
      );
    }
  }

  if (interviewNamedDotNetOnly(ctx)) {
    out = out.replace(
      /\bASP\.NET(?:\s+Core)?\b(?!\s*\(not confirmed)/gi,
      '.NET (ASP.NET not confirmed)'
    );
    if (/##\s*Assumptions/i.test(out) && !/ASP\.NET not confirmed/i.test(out)) {
      out = out.replace(
        /(##\s*Assumptions\s*\n)/i,
        `$1- .NET was selected as the **language** only — ASP.NET was not chosen; any stub is a placeholder, not a confirmed framework.\n`
      );
    }
  }

  return out;
}
