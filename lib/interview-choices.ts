import {
  adaptClarifyingQuestions,
  formatInterviewAnswerForPlan,
  parseClarifyingQuestion,
} from '@/lib/clarifying-questions';

export interface InterviewChoiceItem {
  label: string;
  value: string;
}

function prettifyAnswer(raw: string): string {
  return formatInterviewAnswerForPlan(raw)
    .replace(
      /^Keep the suggested cloud, hosting platform, and CI\/CD as proposed\.$/,
      'Keep suggested setup'
    )
    .replace(/^Cloud provider \(client override\):\s*/i, '')
    .replace(/^Hosting platform \(client override\):\s*/i, '')
    .replace(/^CI\/CD system \(client override\):\s*/i, '')
    .replace(/^Language \(client override\):\s*Java only\..*$/i, 'Java')
    .replace(/^Language\/framework \(client override\):\s*Spring Boot.*$/i, 'Spring Boot')
    .replace(/^Language \(client override\):\s*\.NET only\..*$/i, '.NET')
    .replace(/^Language \(client override\):\s*Node\.js\..*$/i, 'Node.js')
    .replace(/^Language \(client override\):\s*(Go|Python)\..*$/i, '$1')
    .replace(/^Data service \(client override\):\s*/i, '')
    .replace(/\s*Use this instead of[^.]*\./gi, '')
    .replace(/\s*Native CI must target[^.]*\./gi, '')
    .replace(/\s*Pair it with that provider[^.]*\./gi, '')
    .replace(/\s*Do NOT confirm[^.]*\./gi, '')
    .replace(/\s*Put any stub[^.]*\./gi, '')
    .replace(/\s*Prefer a minimal[^.]*\./gi, '')
    .replace(/\s*Minimal \/health stub[^.]*\./gi, '')
    .trim();
}

/** Structured interview answers for UI + plan prompt text. */
export function buildInterviewChoiceItems(
  questions: string[],
  answers: Record<number, string>
): InterviewChoiceItem[] {
  const effective = adaptClarifyingQuestions(questions, answers);
  const items: InterviewChoiceItem[] = [];

  effective.forEach((question, index) => {
    const raw = (answers[index] || '').trim();
    if (!raw) return;
    const label = parseClarifyingQuestion(question).prompt.replace(/\?$/, '');
    items.push({ label, value: prettifyAnswer(raw) });
  });

  return items;
}

/** Plain-text block sent to the plan model — keeps full override wording (not UI-prettified). */
export function formatInterviewAnswersForPlan(
  questions: string[],
  answers: Record<number, string>
): string {
  const effective = adaptClarifyingQuestions(questions, answers);
  const lines: string[] = [];
  let n = 0;

  effective.forEach((question, index) => {
    const raw = (answers[index] || '').trim();
    if (!raw) return;
    const label = parseClarifyingQuestion(question).prompt.replace(/\?$/, '');
    const value = formatInterviewAnswerForPlan(raw);
    if (!lines.length) lines.push('Confirmed choices:');
    n += 1;
    lines.push(`${n}. ${label}`);
    lines.push(`   → ${value}`);
  });
  return lines.join('\n');
}
