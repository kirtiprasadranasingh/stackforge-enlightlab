/**
 * Parse stdout from scripts/validate-scaffold.sh for README warnings.
 */

export interface ParsedValidationReport {
  /** Lines like "PASS  - terraform validate" */
  checkLines: string[];
  /** True when the script reported RESULT: FAILED or any FAIL line */
  failed: boolean;
  /** True when we have at least one PASS/FAIL/WARN/INFO check line */
  hasCheckLines: boolean;
  /** Body suitable for README fenced block */
  formattedBody: string;
}

const CHECK_LINE_RE = /^(PASS|FAIL|WARN|INFO)\s+-/;

export function parseValidationReport(rawOutput: string): ParsedValidationReport {
  const clean = rawOutput.replace(/\r/g, '').replace(/\u001b\[\d+m/g, '').trim();

  const sectionMatch = clean.match(
    /===== VALIDATION REPORT =====\s*([\s\S]*?)\s*={3,}/
  );
  const reportSection = sectionMatch ? sectionMatch[1].trim() : clean;

  const allLines = reportSection
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const checkLines = allLines.filter((l) => CHECK_LINE_RE.test(l));
  const failed =
    /\bRESULT:\s*FAILED\b/i.test(clean) ||
    checkLines.some((l) => l.startsWith('FAIL'));

  const formattedBody =
    checkLines.length > 0
      ? checkLines.join('\n')
      : allLines.filter((l) => !l.startsWith('Validating scaffold')).join('\n');

  return {
    checkLines,
    failed,
    hasCheckLines: checkLines.length > 0,
    formattedBody: formattedBody.trim(),
  };
}

/** True when the script produced a real validation report section */
export function isValidationMeaningful(rawOutput: string, parsed: ParsedValidationReport): boolean {
  if (parsed.hasCheckLines) return true;
  return rawOutput.includes('===== VALIDATION REPORT =====');
}

/** Only append README warning when validation actually failed with real report lines */
export function shouldAppendValidationWarning(
  rawOutput: string,
  parsed: ParsedValidationReport
): boolean {
  const hasFailOrWarn = parsed.checkLines.some(
    (l) => l.startsWith('FAIL') || l.startsWith('WARN')
  );
  return (
    isValidationMeaningful(rawOutput, parsed) &&
    parsed.failed &&
    hasFailOrWarn &&
    parsed.formattedBody.length > 0
  );
}

export function buildValidationReadmeNotice(parsed: ParsedValidationReport): string {
  return `\n\n---\n\n### ⚠️ Automated Validation Warning\nAutomated validation found issues that could not be auto-resolved:\n\n\`\`\`text\n${parsed.formattedBody}\n\`\`\`\n`;
}
