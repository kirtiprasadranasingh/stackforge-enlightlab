import React from 'react';

interface FormattedMessageProps {
  content: string;
  className?: string;
}

function cleanMessageContent(content: string): string {
  if (!content) return '';
  let cleaned = content;
  // 1. Remove <<<FILE ...>>> ... <<<END_FILE>>> blocks
  cleaned = cleaned.replace(/<<<FILE[\s\S]*?>>>[\s\S]*?<<<END_FILE>>>/g, '');
  cleaned = cleaned.replace(/<<<FILE[\s\S]*?>>>[\s\S]*?$/g, '');
  // 2. Remove workflow markers (including PLAN / QUESTIONS leftovers)
  cleaned = cleaned.replace(
    /<<<(STATUS|SUMMARY|WARNINGS|DELETE|PLAN|QUESTIONS)[^>]*>>>/g,
    ''
  );
  cleaned = cleaned.replace(/<<<END_[A-Z]+>>>/g, '');
  cleaned = cleaned.replace(/<<<+/g, '');
  cleaned = cleaned.replace(/>>>+/g, '');
  // 3. Remove markdown code blocks (infra bodies belong in the file viewer)
  cleaned = cleaned.replace(/```[a-zA-Z0-9_-]*\r?\n[\s\S]*?\r?\n```/g, '');
  cleaned = cleaned.replace(/```[a-zA-Z0-9_-]*\r?\n[\s\S]*?$/g, '');
  cleaned = cleaned.replace(/```/g, '');
  return cleaned.trim();
}

export function FormattedMessage({ content, className }: FormattedMessageProps) {
  const cleanedContent = cleanMessageContent(content);
  if (!cleanedContent) return null;

  const lines = cleanedContent.split('\n');
  const isUserBubble = className?.includes('text-white');

  return (
    <div
      className={`space-y-2 font-sans leading-relaxed text-[13px] break-words [overflow-wrap:anywhere] min-w-0 ${className || 'text-slate-700'}`}
    >
      {lines.map((line, idx) => {
        let trimmed = line.trim();
        if (trimmed === '') {
          return <div key={idx} className="h-1.5" />;
        }

        const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const headingText = parseInlineParts(headingMatch[2], isUserBubble);
          const headingClass =
            level === 1
              ? 'text-[15px] font-bold tracking-tight mt-1'
              : level === 2
                ? 'text-[14px] font-bold tracking-tight mt-1'
                : 'text-[13px] font-semibold mt-0.5';
          return (
            <p
              key={idx}
              className={`${headingClass} ${
                isUserBubble ? 'text-white' : 'text-slate-900'
              }`}
            >
              {headingText}
            </p>
          );
        }

        const numbered = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (numbered) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-0.5">
              <span
                className={`shrink-0 font-semibold tabular-nums w-4 text-right ${
                  isUserBubble ? 'text-white' : 'text-indigo-600'
                }`}
              >
                {numbered[1]}.
              </span>
              <span className="flex-1 min-w-0">
                {parseInlineParts(numbered[2], isUserBubble)}
              </span>
            </div>
          );
        }

        const isBullet = /^[*•\-]\s+/.test(trimmed);
        if (isBullet) {
          trimmed = trimmed.replace(/^[*•\-]\s+/, '');
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span
                className={`mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full ${
                  isUserBubble ? 'bg-white' : 'bg-indigo-500'
                }`}
              />
              <span className="flex-1 min-w-0">
                {parseInlineParts(trimmed, isUserBubble)}
              </span>
            </div>
          );
        }

        const answerArrow = trimmed.match(/^(→|->)\s+(.*)$/);
        if (answerArrow) {
          return (
            <div
              key={idx}
              className={`pl-5 text-[12px] ${
                isUserBubble ? 'text-indigo-100' : 'text-slate-600'
              }`}
            >
              <span className={isUserBubble ? 'text-white/80' : 'text-indigo-500'}>
                →{' '}
              </span>
              {parseInlineParts(answerArrow[2], isUserBubble)}
            </div>
          );
        }

        return (
          <p key={idx} className="min-w-0">
            {parseInlineParts(trimmed, isUserBubble)}
          </p>
        );
      })}
    </div>
  );
}

function parseInlineParts(text: string, isUserBubble?: boolean): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\b[A-Z][A-Z0-9_]{2,}\b)/g);
  return parts.map((part, pIdx) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong
          key={pIdx}
          className={`font-semibold ${
            isUserBubble ? 'text-white' : 'text-slate-900'
          }`}
        >
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={pIdx}
          className={`text-[11px] px-1 py-0.5 rounded font-mono ${
            isUserBubble
              ? 'bg-white/25 text-white'
              : 'bg-slate-100 text-slate-800 border border-slate-200/80'
          }`}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (/^[A-Z][A-Z0-9_]{2,}$/.test(part)) {
      if (isUserBubble) {
        return (
          <span key={pIdx} className="font-semibold text-white">
            {part}
          </span>
        );
      }
      return (
        <code
          key={pIdx}
          className="text-[11px] px-1 py-0.5 rounded font-mono bg-slate-100 text-slate-700 border border-slate-200/80"
        >
          {part}
        </code>
      );
    }
    return <span key={pIdx}>{part}</span>;
  });
}
