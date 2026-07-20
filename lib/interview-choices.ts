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
    .replace(/\s*Use this instead of[^.]*\./gi, '')
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

/** Plain-text block sent to the plan model (unchanged contract). */
export function formatInterviewAnswersForPlan(
  questions: string[],
  answers: Record<number, string>
): string {
  const items = buildInterviewChoiceItems(questions, answers);
  if (!items.length) return '';

  const lines = ['Confirmed choices:'];
  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.label}`);
    lines.push(`   → ${item.value}`);
  });
  return lines.join('\n');
}
